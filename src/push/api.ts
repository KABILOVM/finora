/**
 * Работа приложения с серверной частью напоминаний: таблицы reminder_settings и push_subscriptions (через клиент Supabase)
 * и функция send-reminders («Проверить уведомление»). Договор: src/push/contract.ts и supabase/schema.sql, раздел 9.
 *
 * Правила:
 *  - user_id в тело запроса НЕ кладём: его ставит сервер (auth.uid()), а политики RLS пускают только к своим строкам;
 *  - DELETE политиками запрещён: «отписаться» = выставить revoked_at;
 *  - данным ответа не верим вслепую: каждое поле проверяется по типу, мусор заменяется значением по умолчанию;
 *  - клиента нет (локальный режим) — понятный отказ, а не исключение; все функции исключений не бросают;
 *  - тексты ошибок — по-русски, без адреса push, ключей, почты и сырых английских сообщений сервера.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_REMINDER_SETTINGS,
  PUSH_TABLES,
  SEND_REMINDERS_FUNCTION,
  type PushSubscriptionInput,
  type ReminderSettings,
} from './contract';
import { TimeoutError, isOnline, isValidTimezone, withTimeout } from './util';

export type PushClient = Pick<SupabaseClient, 'from' | 'functions'>;

export type PushErrorKind =
  | 'no-cloud'
  | 'offline'
  | 'timeout'
  | 'auth'
  | 'no-tables'
  | 'denied'
  | 'server'
  | 'invalid'
  | 'function-missing'
  | 'not-configured'
  | 'rate-limited'
  | 'no-subscriptions';

export interface PushApiError {
  kind: PushErrorKind;
  /** Готовая фраза для человека. */
  message: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: PushApiError };

export const REQUEST_TIMEOUT_MS = 15_000;
export const TEST_TIMEOUT_MS = 25_000;

const TEXT: Record<PushErrorKind, string> = {
  'no-cloud': 'Напоминания работают только при входе в облако.',
  offline: 'Нет связи с сервером. Проверьте интернет и повторите.',
  timeout: 'Сервер не ответил вовремя. Повторите чуть позже.',
  auth: 'Сессия закончилась. Войдите заново.',
  'no-tables': 'На сервере ещё нет таблиц для напоминаний. Обратитесь к владельцу приложения: нужно обновить схему базы.',
  denied: 'У вашей учётной записи нет прав на напоминания. Обратитесь к владельцу приложения.',
  server: 'Сервер сейчас недоступен. Попробуйте позже.',
  invalid: 'Не удалось сохранить: данные выглядят неверно.',
  'function-missing': 'Серверная часть напоминаний ещё не установлена (функция send-reminders не развёрнута). Обратитесь к владельцу приложения.',
  'not-configured': 'На сервере не настроены ключи для напоминаний. Обратитесь к владельцу приложения.',
  'rate-limited': 'Слишком часто. Подождите минуту и повторите.',
  'no-subscriptions': 'Сервер не нашёл ни одного устройства, куда можно отправить уведомление. Включите напоминания на этом устройстве и повторите.',
};

export const fail = (kind: PushErrorKind, message?: string): { ok: false; error: PushApiError } => ({
  ok: false,
  error: { kind, message: message ?? TEXT[kind] },
});

const NO_CLOUD = fail('no-cloud');

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  context?: unknown;
}
const asLike = (e: unknown): ErrorLike => (typeof e === 'object' && e !== null ? (e as ErrorLike) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const NETWORK_TEXT = /failed to fetch|load failed|network ?error|networkerror|network request failed|fetch failed|abort|econn|enotfound/i;

/** HTTP-статус из ошибки supabase-js: сам status или context.status (Response внутри FunctionsHttpError). */
function statusOf(e: unknown, status?: number): number | undefined {
  if (typeof status === 'number') return status;
  const like = asLike(e);
  if (typeof like.status === 'number') return like.status;
  const ctx = asLike(like.context);
  return typeof ctx.status === 'number' ? ctx.status : undefined;
}

/** Ошибку PostgREST / сети / таймаута превращает в понятный отказ. Сырой текст сервера человеку не показываем. */
export function describeFailure(e: unknown, status?: number): { ok: false; error: PushApiError } {
  const like = asLike(e);
  const code = str(like.code);
  const st = statusOf(e, status);
  if (e instanceof TimeoutError || like.name === 'TimeoutError') return fail('timeout');
  if (
    e instanceof TypeError ||
    like.name === 'AbortError' ||
    like.name === 'FunctionsFetchError' ||
    st === 0 ||
    (st === undefined && code === '' && NETWORK_TEXT.test(str(like.message)))
  ) {
    return fail('offline');
  }
  if (st === 401 || code === 'PGRST301' || code === 'PGRST303' || code === '28000') return fail('auth');
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703') return fail('no-tables');
  if (code === '42501' || st === 403) return fail('denied');
  return fail('server');
}

/* ------------------------------ разбор данных сервера ------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt);

/** Строка reminder_settings → настройки. Чужие и неверные поля заменяются значениями по умолчанию. Не объект — null. */
export function parseSettingsRow(row: unknown): ReminderSettings | null {
  if (!isObj(row)) return null;
  const d = DEFAULT_REMINDER_SETTINGS;
  const hour = row.hour_local;
  return {
    enabled: bool(row.enabled, d.enabled),
    hourLocal: typeof hour === 'number' && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : d.hourLocal,
    timezone: isValidTimezone(row.timezone) ? row.timezone : d.timezone,
    remindPayments: bool(row.remind_payments, d.remindPayments),
    remindDebts: bool(row.remind_debts, d.remindDebts),
    remindDaily: bool(row.remind_daily, d.remindDaily),
    remindBudgets: bool(row.remind_budgets, d.remindBudgets),
    showDetails: bool(row.show_details, d.showDetails),
  };
}

/** Что менять в настройках → колонки таблицы. null — в изменении есть неверное значение (на сервер такое не шлём). */
export function settingsToColumns(patch: Partial<ReminderSettings>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const flag = (key: keyof ReminderSettings, col: string): boolean => {
    const v = patch[key];
    if (v === undefined) return true;
    if (typeof v !== 'boolean') return false;
    out[col] = v;
    return true;
  };
  if (!flag('enabled', 'enabled') || !flag('remindPayments', 'remind_payments') || !flag('remindDebts', 'remind_debts')) return null;
  if (!flag('remindDaily', 'remind_daily') || !flag('remindBudgets', 'remind_budgets') || !flag('showDetails', 'show_details')) return null;
  if (patch.hourLocal !== undefined) {
    if (typeof patch.hourLocal !== 'number' || !Number.isInteger(patch.hourLocal) || patch.hourLocal < 0 || patch.hourLocal > 23) return null;
    out.hour_local = patch.hourLocal;
  }
  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) return null;
    out.timezone = patch.timezone;
  }
  return out;
}

export interface StoredSubscription {
  deviceId: string;
  endpoint: string;
}

/** Строки push_subscriptions → список; строки без адреса или устройства отбрасываются. */
export function parseSubscriptionRows(rows: unknown): StoredSubscription[] {
  if (!Array.isArray(rows)) return [];
  const out: StoredSubscription[] = [];
  for (const r of rows) {
    if (!isObj(r) || typeof r.endpoint !== 'string' || typeof r.device_id !== 'string') continue;
    if (r.revoked_at !== null && r.revoked_at !== undefined) continue;
    out.push({ deviceId: r.device_id, endpoint: r.endpoint });
  }
  return out;
}

/** Подписка устройства → строка таблицы. null — подписка не подходит под ограничения таблицы (шлём только годное). */
export function subscriptionToRow(sub: PushSubscriptionInput, nowIso: string): Record<string, unknown> | null {
  const { deviceId, endpoint, p256dh, authSecret } = sub;
  const userAgent = typeof sub.userAgent === 'string' ? sub.userAgent.slice(0, 300) : '';
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length < 12 || endpoint.length > 2048) return null;
  if (typeof p256dh !== 'string' || p256dh.length < 20 || p256dh.length > 200) return null;
  if (typeof authSecret !== 'string' || authSecret.length < 8 || authSecret.length > 100) return null;
  if (typeof deviceId !== 'string' || deviceId.length < 1 || deviceId.length > 64) return null;
  return {
    device_id: deviceId,
    endpoint,
    p256dh,
    auth_secret: authSecret,
    user_agent: userAgent,
    last_seen_at: nowIso,
    revoked_at: null, // повторная подписка снимает прежнюю отписку
  };
}

/* ------------------------------ запросы ------------------------------ */

interface PgResult {
  data: unknown;
  error: { message?: unknown; code?: unknown } | null;
  status?: number;
}

async function exec(call: () => PromiseLike<PgResult>): Promise<ApiResult<unknown>> {
  if (!isOnline()) return fail('offline');
  try {
    const r = await withTimeout(call(), REQUEST_TIMEOUT_MS);
    if (r.error) return describeFailure(r.error, r.status);
    return { ok: true, value: r.data };
  } catch (e) {
    return describeFailure(e);
  }
}

const nowIso = (): string => new Date().toISOString();

/** Читает настройки напоминаний пользователя. value: null — строки ещё нет (значит, всё выключено). */
export async function readReminderSettings(client: PushClient | null): Promise<ApiResult<ReminderSettings | null>> {
  if (!client) return NO_CLOUD;
  const r = await exec(() => client.from(PUSH_TABLES.settings).select('*').maybeSingle() as unknown as PromiseLike<PgResult>);
  if (!r.ok) return r;
  return { ok: true, value: parseSettingsRow(r.value) };
}

/**
 * Сохраняет изменения настроек (upsert по user_id; колонки, которых нет в изменении, не трогаются).
 * Возвращает настройки КАК ИХ ПОДТВЕРДИЛ СЕРВЕР — интерфейс показывает именно их.
 */
export async function saveReminderSettings(client: PushClient | null, patch: Partial<ReminderSettings>): Promise<ApiResult<ReminderSettings>> {
  if (!client) return NO_CLOUD;
  const cols = settingsToColumns(patch);
  if (cols === null) return fail('invalid');
  const row = { ...cols, updated_at: nowIso() };
  const r = await exec(
    () => client.from(PUSH_TABLES.settings).upsert(row, { onConflict: 'user_id' }).select().single() as unknown as PromiseLike<PgResult>,
  );
  if (!r.ok) return r;
  const parsed = parseSettingsRow(r.value);
  return parsed ? { ok: true, value: parsed } : fail('server');
}

/** Список действующих (не отозванных) подписок пользователя на всех устройствах. */
export async function listActiveSubscriptions(client: PushClient | null): Promise<ApiResult<StoredSubscription[]>> {
  if (!client) return NO_CLOUD;
  const r = await exec(
    () => client.from(PUSH_TABLES.subscriptions).select('endpoint, device_id, revoked_at').is('revoked_at', null) as unknown as PromiseLike<PgResult>,
  );
  if (!r.ok) return r;
  return { ok: true, value: parseSubscriptionRows(r.value) };
}

/**
 * Сохраняет подписку устройства (upsert по user_id + endpoint; снимает прежнюю отписку).
 * Успех — только когда сервер ответил строкой с тем же адресом и без отписки.
 */
export async function saveSubscription(client: PushClient | null, sub: PushSubscriptionInput): Promise<ApiResult<true>> {
  if (!client) return NO_CLOUD;
  const row = subscriptionToRow(sub, nowIso());
  if (row === null) return fail('invalid', 'Браузер выдал подписку в неожиданном виде. Попробуйте ещё раз или обновите браузер.');
  const r = await exec(
    () =>
      client
        .from(PUSH_TABLES.subscriptions)
        .upsert(row, { onConflict: 'user_id,endpoint' })
        .select('endpoint, revoked_at')
        .single() as unknown as PromiseLike<PgResult>,
  );
  if (!r.ok) return r;
  const saved = r.value;
  if (!isObj(saved) || saved.endpoint !== sub.endpoint || (saved.revoked_at !== null && saved.revoked_at !== undefined)) return fail('server');
  return { ok: true, value: true };
}

/**
 * Отзывает подписки ЭТОГО устройства: все строки с его deviceId и строку с его текущим адресом (на случай, если id устройства
 * сменился). Другие устройства не трогает. value.remaining — сколько действующих подписок осталось у пользователя.
 */
export async function revokeDeviceSubscriptions(
  client: PushClient | null,
  device: { deviceId: string; endpoint: string | null },
): Promise<ApiResult<{ remaining: number }>> {
  if (!client) return NO_CLOUD;
  const patch = { revoked_at: nowIso() };
  const byDevice = await exec(
    () => client.from(PUSH_TABLES.subscriptions).update(patch).eq('device_id', device.deviceId).is('revoked_at', null) as unknown as PromiseLike<PgResult>,
  );
  if (!byDevice.ok) return byDevice;
  if (device.endpoint !== null) {
    const byEndpoint = await exec(
      () => client.from(PUSH_TABLES.subscriptions).update(patch).eq('endpoint', device.endpoint).is('revoked_at', null) as unknown as PromiseLike<PgResult>,
    );
    if (!byEndpoint.ok) return byEndpoint;
  }
  const left = await listActiveSubscriptions(client);
  if (!left.ok) return left;
  return { ok: true, value: { remaining: left.value.length } };
}

/** Отзывает у этого устройства все подписки, кроме текущей (после смены адреса: старый уже мёртвый). Ошибки молча игнорирует. */
export async function revokeOtherEndpointsOfDevice(client: PushClient | null, deviceId: string, keepEndpoint: string): Promise<boolean> {
  if (!client) return false;
  const r = await exec(
    () =>
      client
        .from(PUSH_TABLES.subscriptions)
        .update({ revoked_at: nowIso() })
        .eq('device_id', deviceId)
        .neq('endpoint', keepEndpoint)
        .is('revoked_at', null) as unknown as PromiseLike<PgResult>,
  );
  return r.ok;
}

/* ------------------------------ «Проверить уведомление» ------------------------------ */

function bodyOf(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

/** Просит серверную функцию отправить пробное сообщение на подписки ЭТОГО пользователя. value.sent — на сколько устройств ушло. */
export async function sendTestReminder(client: PushClient | null): Promise<ApiResult<{ sent: number }>> {
  if (!client) return NO_CLOUD;
  if (!isOnline()) return fail('offline');
  let res: { data: unknown; error: unknown };
  try {
    res = await withTimeout(
      client.functions.invoke(SEND_REMINDERS_FUNCTION, { body: { action: 'test' } }) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
      TEST_TIMEOUT_MS,
    );
  } catch (e) {
    return describeFailure(e);
  }
  if (res.error) return describeFunctionFailure(res.error);
  const body = bodyOf(res.data);
  if (!isObj(body) || typeof body.ok !== 'boolean') return fail('server');
  if (!body.ok) return fail('server', 'Сервер не смог отправить уведомление. Попробуйте позже.');
  const sent = typeof body.sent === 'number' && Number.isFinite(body.sent) && body.sent > 0 ? Math.floor(body.sent) : 0;
  return sent > 0 ? { ok: true, value: { sent } } : fail('no-subscriptions');
}

function describeFunctionFailure(error: unknown): { ok: false; error: PushApiError } {
  const like = asLike(error);
  const st = statusOf(error);
  if (like.name === 'FunctionsFetchError' || error instanceof TypeError) return fail('offline');
  if (st === 404) return fail('function-missing');
  if (st === 401 || st === 403) return fail('auth');
  if (st === 429) return fail('rate-limited');
  if (st === 500) return fail('not-configured');
  if (like.name === 'FunctionsRelayError') return fail('server');
  return describeFailure(error);
}
