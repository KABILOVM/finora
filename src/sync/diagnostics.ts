import { newId } from '@/db/ids';
import { secretKeyMessage } from './diagnosticsKey';
import {
  RELOGIN,
  SCHEMA_HINT,
  TIMED_OUT,
  describeProblem,
  errText,
  probeOf,
  probeOfThrown,
  records,
  runWriteProbes,
  serverResult,
  short,
  text,
  withTimeout,
  WRITE_PROBES,
  type Probe,
  type StepResult,
} from './diagnosticsProbe';
import { SYNC_TABLES, TABLE_SPECS } from './tables';

/**
 * «Проверка облака»: по шагам говорит владельцу, что в облаке настроено правильно, а что нет, и что делать.
 * Ничего не пишет в данные пользователя: права записи проверяются заведомо НЕВЕРНЫМИ строками (по одной в каждую таблицу
 * синхронизации, через upsert, как пишет настоящая синхронизация), которые сервер обязан отклонить.
 * Чего проверка снаружи доказать не может (включена ли защита строк RLS, есть ли политика правки), сказано в README.
 * supabase-js здесь не импортируется: достаточно узкого интерфейса CloudClientLike (настоящий клиент ему подходит).
 * Разбор ответов и пробная запись — в diagnosticsProbe.ts, вид ключа — в diagnosticsKey.ts.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export type CheckStepId = 'server' | 'session' | 'schema' | 'read' | 'write' | 'rates' | 'local';

export interface CheckStep {
  id: CheckStepId;
  title: string;
  status: CheckStatus;
  /** Простыми словами: что получилось и что сделать. */
  message: string;
}

// ---------- минимальный клиент ----------

export interface CloudQueryError {
  message?: unknown;
  code?: unknown;
}
export interface CloudQueryResult {
  data?: unknown;
  error?: CloudQueryError | null;
  status?: number;
}
export interface CloudQuery extends PromiseLike<CloudQueryResult> {
  /** У supabase-js есть; нужен, чтобы проверка не ждала повторов запроса и отвечала быстро. */
  retry?(enabled: boolean): CloudQuery;
}
export interface CloudSelect {
  limit(count: number): CloudQuery;
  /** Нужен, чтобы «самые свежие» брались сервером, а не угадывались по первым строкам. */
  order(column: string, options?: { ascending?: boolean }): { limit(count: number): CloudQuery };
}
export interface CloudClientLike {
  from(table: string): {
    select(columns: string): CloudSelect;
    /** Как у настоящей синхронизации: insert ... on conflict (id) do update. */
    upsert(values: Record<string, unknown>, options?: { onConflict?: string }): CloudQuery;
  };
  auth: {
    getSession(): PromiseLike<{
      data?: { session?: { user?: { id?: unknown } | null } | null } | null;
      error?: { message?: unknown } | null;
    }>;
  };
}

export interface CloudCheckContext {
  /** Чьи данные открыты на экране. */
  userId: string;
  /** Адрес проекта (Project URL). */
  url: string;
  /** Приложение само считает вход подтверждённым (не «открыто по сохранённым данным»). */
  hasSession: boolean;
  /** Сколько локальных записей ждут отправки. */
  pending: number;
  /** Сколько записей сервер отверг (карантин). */
  quarantined: number;
  /** Была ли хотя бы одна успешная синхронизация. */
  everSynced?: boolean;
  /** false — у устройства нет интернета (navigator.onLine). */
  online?: boolean;
  /** Ключ из настроек сборки (VITE_SUPABASE_ANON_KEY): нужен только чтобы заметить секретный ключ. В сообщения и отчёт не попадает. */
  apiKey?: string;
}

export interface CloudCheckOptions {
  /** Предел одного шага, мс. По умолчанию 10 000. */
  timeoutMs?: number;
  now?: () => Date;
  newId?: () => string;
  /** Вызывается по мере готовности шагов (чтобы экран показывал ход проверки). */
  onStep?: (step: CheckStep) => void;
}

export const CHECK_TIMEOUT_MS = 10_000;

const TITLES: Record<CheckStepId, string> = {
  server: 'Связь с сервером',
  session: 'Вход в аккаунт',
  schema: 'Таблицы в базе',
  read: 'Чтение данных',
  write: 'Запись данных',
  rates: 'Курсы валют на сервере',
  local: 'Данные на этом устройстве',
};

const USER_TABLES: string[] = SYNC_TABLES.map((t) => TABLE_SPECS[t].remote);
const RATES_TABLE = 'exchange_rates';
const ALL_TABLES = [...USER_TABLES, RATES_TABLE];
const READ_LIMIT = 50;
const RATES_LIMIT = 10;

/** Колонки, которые читает настоящая синхронизация: если какой-то нет, схема в облаке старая или чужая. */
const READ_COLUMNS = new Map<string, string>(
  SYNC_TABLES.map((t) => [TABLE_SPECS[t].remote, [...TABLE_SPECS[t].columns.map((c) => c.column), 'user_id', 'server_seq', 'server_updated_at'].join(',')]),
);
const RATES_COLUMNS = 'as_of,source,fetched_at';

function hostOf(url: unknown): string {
  try {
    return typeof url === 'string' ? new URL(url).host : '';
  } catch {
    return '';
  }
}

// ---------- запуск проверки ----------

/**
 * Идёт по шагам сверху вниз; шаг, который нельзя выполнить из-за прежней ошибки, помечается «skip».
 * Не бросает исключений: любой сбой шага превращается в понятное сообщение. Возвращает шаги в порядке выполнения.
 */
export async function runCloudCheck(client: CloudClientLike, context: CloudCheckContext, options: CloudCheckOptions = {}): Promise<CheckStep[]> {
  const ctx: CloudCheckContext = { userId: '', url: '', hasSession: false, pending: NaN, quarantined: NaN, ...(typeof context === 'object' ? context : null) };
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : CHECK_TIMEOUT_MS;
  const secs = Math.max(1, Math.round(timeoutMs / 1000));
  const makeId = options.newId ?? newId;
  const now = options.now ?? (() => new Date());
  const host = hostOf(ctx.url);
  const where = host ? ` ${host}` : '';
  const steps: CheckStep[] = [];

  const emit = (id: CheckStepId, r: StepResult): CheckStatus => {
    const s: CheckStep = { id, title: TITLES[id], status: r.status, message: r.message };
    steps.push(s);
    try {
      options.onStep?.(s);
    } catch {
      // слушатель не должен ломать проверку
    }
    return r.status;
  };
  const skip = (ids: CheckStepId[], why: string) => ids.forEach((id) => emit(id, { status: 'skip', message: `Пропущено: ${why}` }));

  /** Шаг целиком: любой сбой и зависание превращаются в сообщение, а не в исключение. */
  const step = async (id: CheckStepId, fn: () => Promise<StepResult>): Promise<CheckStatus> => {
    try {
      const out = await withTimeout(fn(), timeoutMs);
      if (out !== TIMED_OUT) return emit(id, out);
      return emit(id, { status: 'fail', message: `Шаг не уложился в ${secs} с: сервер не ответил. Проверьте интернет и повторите проверку.` });
    } catch (e) {
      return emit(id, { status: 'fail', message: `Не удалось выполнить шаг (${short(errText(e))}). Повторите проверку.` });
    }
  };

  // Чтение таблицы выполняется один раз за проверку; результат используют несколько шагов.
  const reads = new Map<string, Promise<Probe>>();
  const read = (table: string): Promise<Probe> => {
    let p = reads.get(table);
    if (!p) {
      const isRates = table === RATES_TABLE;
      p = (async (): Promise<Probe> => {
        try {
          // курсы — новейшие вперёд (как читает приложение): иначе «последняя дата» берётся из случайных старых строк
          const sel = client.from(table).select(isRates ? RATES_COLUMNS : (READ_COLUMNS.get(table) ?? 'id,user_id'));
          const q = isRates ? sel.order('as_of', { ascending: false }).limit(RATES_LIMIT) : sel.limit(READ_LIMIT);
          const res = await withTimeout(typeof q.retry === 'function' ? q.retry(false) : q, timeoutMs);
          return res === TIMED_OUT ? { kind: 'timeout' } : probeOf(res);
        } catch (e) {
          return probeOfThrown(e);
        }
      })();
      reads.set(table, p);
    }
    return p;
  };
  const readMany = async (tables: string[]): Promise<Map<string, Probe>> =>
    new Map(await Promise.all(tables.map(async (t) => [t, await read(t)] as const)));

  /** (ж) Локальные данные: чистая функция от ctx, сеть не нужна. Всегда последний шаг. */
  const finish = (): CheckStep[] => {
    const valid = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
    if (!valid(ctx.pending) || !valid(ctx.quarantined)) {
      emit('local', { status: 'skip', message: 'Не удалось узнать, сколько записей ждёт отправки.' });
    } else if (ctx.quarantined > 0) {
      const more = ctx.pending > 0 ? ` Ещё ждут отправки: ${records(ctx.pending)}.` : '';
      emit('local', {
        status: 'warn',
        message: `Сервер не принял ${records(ctx.quarantined)} (они остались на устройстве). Откройте раздел «Синхронизация» и нажмите «Повторить»; если не поможет, отправьте этот отчёт тому, кто настраивал облако.${more}`,
      });
    } else if (ctx.pending > 0) {
      emit('local', { status: 'ok', message: `Ждут отправки: ${records(ctx.pending)}. Они уйдут сами, пока приложение открыто, или нажмите «Синхронизировать сейчас».` });
    } else {
      emit('local', { status: 'ok', message: 'Нет записей, которые ждут отправки, и нет отвергнутых сервером.' });
    }
    return steps;
  };

  // ---- (а) сервер достижим ----
  let reachable = false;
  await step('server', async () => {
    if (!client || typeof client.from !== 'function') {
      return { status: 'fail', message: 'Облако не подключено: нет настроек VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.' };
    }
    const conn = serverResult(await read('settings'), ctx, where, secs);
    reachable = conn.status !== 'fail';
    // Секретный ключ в сборке — утечка полного доступа к базе, даже если всё остальное работает.
    const danger = secretKeyMessage(ctx.apiKey);
    if (danger === null) return conn;
    return { status: 'fail', message: reachable ? danger : `${danger} ${conn.message}` };
  });
  // Связи нет — дальше идти нечего. Опасный ключ при рабочей связи остальные шаги не отменяет.
  if (!reachable) {
    skip(['session', 'schema', 'read', 'write', 'rates'], 'сначала нужна связь с сервером (см. «Связь с сервером»).');
    return finish();
  }

  // ---- (б) вход выполнен, сессия принадлежит этому пользователю ----
  const sessionStatus = await step('session', async () => {
    let res: Awaited<ReturnType<CloudClientLike['auth']['getSession']>> | typeof TIMED_OUT;
    try {
      res = await withTimeout(client.auth.getSession(), timeoutMs);
    } catch (e) {
      return { status: 'fail', message: `Не удалось прочитать вход (${short(errText(e))}). ${RELOGIN}` };
    }
    if (res === TIMED_OUT) return { status: 'fail', message: `Приложение не смогло проверить вход за ${secs} с. Проверьте интернет и повторите.` };
    if (res?.error) return { status: 'fail', message: `Не удалось прочитать вход (${short(text(res.error.message)) || 'без пояснения'}). ${RELOGIN}` };
    const sid = res?.data?.session?.user?.id;
    if (typeof sid !== 'string' || sid === '') {
      return { status: 'fail', message: `${ctx.hasSession ? 'Сессия закончилась или была сброшена.' : 'Вход не выполнен.'} ${RELOGIN}` };
    }
    if (sid !== ctx.userId) return { status: 'fail', message: `Сессия на сервере принадлежит другому пользователю, чем данные на экране. ${RELOGIN}` };
    if ((await read('settings')).kind === 'auth') {
      return { status: 'fail', message: `Сервер не принимает ваш вход: сессия просрочена или отозвана. ${RELOGIN}` };
    }
    if (!ctx.hasSession) {
      return { status: 'warn', message: 'Сессия в порядке, но приложение ещё не подтвердило вход (возможно, оно открылось без сети). Закройте Finora и откройте заново.' };
    }
    return { status: 'ok', message: 'Вход выполнен, сессия принадлежит вам.' };
  });
  if (sessionStatus === 'fail') {
    skip(['schema', 'read', 'write', 'rates'], 'сначала нужно войти (см. «Вход в аккаунт»).');
    return finish();
  }

  // ---- (в) схема применена: все таблицы на месте ----
  await step('schema', async () => {
    const probes = await readMany(ALL_TABLES);
    const missing = ALL_TABLES.filter((t) => probes.get(t)?.kind === 'missing');
    if (missing.length > 0) {
      return { status: 'fail', message: `${SCHEMA_HINT} (Supabase → SQL Editor → New query → вставить файл → Run). Не найдены таблицы: ${missing.join(', ')}.` };
    }
    const noColumns = ALL_TABLES.filter((t) => probes.get(t)?.kind === 'columns');
    if (noColumns.length > 0) {
      return { status: 'fail', message: `Таблицы есть, но в них нет нужных колонок: ${noColumns.join(', ')}. Схема в облаке не совпадает с приложением. ${SCHEMA_HINT}.` };
    }
    const bad = ALL_TABLES.find((t) => !['ok', 'denied', 'auth'].includes(probes.get(t)?.kind ?? ''));
    if (bad) return { status: 'fail', message: `Не удалось проверить таблицы. ${describeProblem(bad, probes.get(bad) as Probe)}. Повторите проверку.` };
    return { status: 'ok', message: `Все ${ALL_TABLES.length} таблиц на месте: ${ALL_TABLES.join(', ')}.` };
  });

  // ---- (г) права чтения: свои строки видны, чужих нет ----
  await step('read', async () => {
    const all = await readMany(USER_TABLES);
    const tables = USER_TABLES.filter((t) => all.get(t)?.kind !== 'missing');
    if (tables.length === 0) return { status: 'skip', message: 'Пропущено: таблиц нет (см. «Таблицы в базе»).' };
    const foreign = tables.filter((t) => {
      const p = all.get(t);
      return p?.kind === 'ok' && p.rows.some((r) => text((r as { user_id?: unknown } | null)?.user_id) !== '' && (r as { user_id: unknown }).user_id !== ctx.userId);
    });
    if (foreign.length > 0) {
      return {
        status: 'fail',
        message: `ОПАСНО: сервер показывает вам чужие записи (${foreign.join(', ')}). Защита строк (RLS) настроена неверно. Не вносите данные, выполните supabase/schema.sql заново и повторите проверку.`,
      };
    }
    const denied = tables.filter((t) => all.get(t)?.kind === 'denied');
    if (denied.length > 0) {
      return { status: 'fail', message: `Нет прав на чтение: ${denied.join(', ')}. Проверьте права и политики из supabase/schema.sql (раздел «Права и защита строк») и выполните файл заново.` };
    }
    const other = tables.find((t) => all.get(t)?.kind !== 'ok');
    if (other) return { status: 'fail', message: `Не удалось прочитать данные. ${describeProblem(other, all.get(other) as Probe)}.` };
    const settings = all.get('settings');
    if (settings?.kind === 'ok' && settings.rows.length === 0 && ctx.everSynced === true && ctx.pending === 0 && ctx.quarantined === 0) {
      return {
        status: 'warn',
        message:
          'Таблицы читаются, но сервер не показывает ни одной вашей записи в settings, хотя приложение считает, что всё отправлено. Возможно, неверны политики чтения (выполните supabase/schema.sql заново) или база была очищена.',
      };
    }
    // Честно: «чужих не видно» одинаково и при включённой защите строк, и при выключенной, если других пользователей с данными нет.
    return {
      status: 'ok',
      message: 'Ваши данные читаются, чужих записей не видно. Включена ли защита строк (RLS), эта проверка подтвердить не может: см. в README «Как убедиться, что чужие данные закрыты».',
    };
  });

  // ---- (д) права записи: в каждую таблицу уходит заведомо неверная строка, сервер обязан её отклонить ----
  await step('write', async () => {
    // чего в базе нет, туда не пишем (об этом скажет шаг «Таблицы в базе»)
    const present: string[] = [];
    for (const p of WRITE_PROBES) if ((await read(p.table)).kind !== 'missing') present.push(p.table);
    if (present.length === 0) return { status: 'skip', message: 'Пропущено: таблиц для записи нет (см. «Таблицы в базе»).' };
    return runWriteProbes(client, { tables: present, makeId, stamp: now().toISOString(), timeoutMs });
  });

  // ---- (е) курсы валют ----
  await step('rates', async () => {
    const p = await read(RATES_TABLE);
    if (p.kind === 'missing') return { status: 'skip', message: `Пропущено: таблицы ${RATES_TABLE} нет (см. «Таблицы в базе»).` };
    if (p.kind === 'denied') {
      return { status: 'warn', message: 'Нет прав читать курсы на сервере. Курсы всё равно придут с публичных источников, но лучше выполнить supabase/schema.sql заново.' };
    }
    if (p.kind !== 'ok') return { status: 'fail', message: `Не удалось прочитать курсы. ${describeProblem(RATES_TABLE, p)}.` };
    if (p.rows.length === 0) {
      return {
        status: 'warn',
        message: 'Таблица курсов пуста. Курсы будут приходить с публичных источников: серверная функция fetch-rates не развёрнута — это не обязательно.',
      };
    }
    const dates = p.rows.map((r) => text((r as { as_of?: unknown } | null)?.as_of).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const last = dates.at(-1);
    return { status: 'ok', message: `Курсы на сервере читаются (${records(p.rows.length)}${last ? `, последняя дата ${last}` : ''}).` };
  });

  return finish();
}

// ---------- итог и отчёт ----------

/** Общий итог: ошибка важнее замечания, замечание важнее «всё хорошо». «Пропущено» без ошибок тоже считается замечанием. */
export function overallStatus(steps: readonly CheckStep[]): 'ok' | 'warn' | 'fail' {
  if (steps.some((s) => s.status === 'fail')) return 'fail';
  if (steps.some((s) => s.status === 'warn' || s.status === 'skip')) return 'warn';
  return 'ok';
}

export const STATUS_MARK: Record<CheckStatus, string> = { ok: '✔', warn: '⚠', fail: '✖', skip: '–' };
export const OVERALL_TEXT = { ok: 'всё в порядке', warn: 'есть замечания', fail: 'есть ошибки' } as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Текст для копирования: итог и по строке на шаг. Без паролей, ключей и почты. */
export function formatReport(steps: readonly CheckStep[], options: { now?: Date; host?: string } = {}): string {
  const d = options.now ?? new Date();
  const when = Number.isNaN(d.getTime())
    ? 'время неизвестно'
    : `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
  const lines = [`Проверка облака Finora, ${when}`, `Итог: ${OVERALL_TEXT[overallStatus(steps)]}`];
  if (options.host) lines.push(`Сервер: ${options.host}`);
  lines.push('');
  for (const s of steps) lines.push(`${STATUS_MARK[s.status]} ${s.title}: ${s.message}`);
  return lines.join('\n');
}
