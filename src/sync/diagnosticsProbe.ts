import { pluralRu } from '@/lib/plural';
import { classifyPostgrestError } from './supabaseTransport';
import type { CheckStatus, CloudCheckContext, CloudClientLike, CloudQueryResult } from './diagnostics';

/**
 * Разбор ответов сервера для «Проверки облака» и пробная запись. Здесь нет ничего, что меняло бы данные пользователя:
 * в базу уходят только заведомо неверные строки, которые сервер обязан отклонить (см. runWriteProbes).
 */

export type StepResult = { status: CheckStatus; message: string };

export const SCHEMA_HINT = 'Выполните файл supabase/schema.sql в SQL Editor вашего проекта Finora';
export const RELOGIN = 'Выйдите (Настройки → Аккаунт → «Выйти») и войдите снова.';
const PAUSE_HINT = 'Если проект давно не открывали, Supabase мог его приостановить: откройте панель проекта и нажмите «Restore project».';

// ---------- разбор ответов ----------

export type Probe =
  | { kind: 'ok'; rows: unknown[] }
  | { kind: 'missing' | 'denied' | 'auth' | 'key' | 'network' | 'timeout' | 'columns' }
  | { kind: 'foreign'; message: string }
  | { kind: 'server'; status: number }
  | { kind: 'other'; code: string; message: string };

export const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
export const records = (n: number) => `${n} ${pluralRu(n, 'запись', 'записи', 'записей')}`;

export function short(s: string, max = 100): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Текст любой пойманной ошибки: у обычного объекта берём message, а не «[object Object]». */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'number' || typeof e === 'boolean') return String(e);
  if (typeof e === 'object' && e !== null) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim() !== '') return m;
  }
  return 'неизвестная ошибка';
}

const AUTH_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303', '28000']);
const MISSING_CODES = new Set(['42P01', 'PGRST205']);
/** Нет колонки: 42703 (select по несуществующей колонке) и PGRST204 (запись в несуществующую колонку). */
const COLUMN_CODES = new Set(['42703', 'PGRST204']);
const KEY_TEXT = /invalid api key|no api key|secret api key/i;

/** Любой ответ клиента (успех или ошибка) → одна из понятных категорий. */
export function probeOf(res: CloudQueryResult | null | undefined): Probe {
  if (typeof res !== 'object' || res === null) return { kind: 'foreign', message: '' };
  const status = typeof res.status === 'number' ? res.status : undefined;
  const err = res.error;
  if (!err) return Array.isArray(res.data) ? { kind: 'ok', rows: res.data } : { kind: 'foreign', message: '' };
  const code = text(err.code);
  const message = text(err.message);
  if (classifyPostgrestError(err, status).kind === 'network') return { kind: 'network' };
  if (status !== undefined && status >= 500) return { kind: 'server', status };
  if (KEY_TEXT.test(message) && (code === '' || status === 401 || status === 403)) return { kind: 'key' };
  if (MISSING_CODES.has(code)) return { kind: 'missing' };
  if (AUTH_CODES.has(code)) return { kind: 'auth' };
  if (COLUMN_CODES.has(code)) return { kind: 'columns' };
  if (code === 'PGRST125') return { kind: 'foreign', message };
  if (code === '42501' || status === 401 || status === 403) return { kind: 'denied' };
  if (code === '' && status !== 429) return { kind: 'foreign', message };
  return { kind: 'other', code, message };
}

export function probeOfThrown(e: unknown): Probe {
  if (classifyPostgrestError(e, undefined).kind === 'network') return { kind: 'network' };
  return { kind: 'other', code: '', message: errText(e) };
}

export const TIMED_OUT = Symbol('timed-out');

export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const PROBLEM_TEXT: Partial<Record<Probe['kind'], string>> = {
  timeout: 'сервер не ответил вовремя',
  network: 'нет связи',
  auth: 'сервер не принял ваш вход',
  key: 'сервер не принял ключ',
  columns: 'нет нужных колонок (схема в облаке не совпадает с приложением)',
};

/** Одной фразой: что не так с ответом по таблице. */
export function describeProblem(table: string, p: Probe): string {
  if (p.kind === 'other') return `${table}: ответ сервера «${short(p.message) || 'без текста'}»${p.code ? ` (код ${p.code})` : ''}`;
  if (p.kind === 'server') return `${table}: сервер ответил ошибкой ${p.status}`;
  return `${table}: ${PROBLEM_TEXT[p.kind] ?? 'непонятный ответ сервера'}`;
}

/** Сообщение шага «Связь с сервером» по ответу на первый запрос. */
export function serverResult(p: Probe, ctx: CloudCheckContext, where: string, secs: number): StepResult {
  const fail = (message: string): StepResult => ({ status: 'fail', message });
  switch (p.kind) {
    case 'network':
    case 'timeout':
      if (ctx.online === false) return fail('У устройства нет интернета. Подключитесь к сети и нажмите «Проверить» ещё раз.');
      return fail(
        p.kind === 'timeout'
          ? `Сервер${where} не ответил за ${secs} с. Проверьте интернет и повторите проверку. ${PAUSE_HINT}`
          : `Нет связи с сервером${where}. Проверьте интернет и адрес проекта: VITE_SUPABASE_URL должен совпадать с «Project URL» в Supabase (Project Settings → API). ${PAUSE_HINT}`,
      );
    case 'key':
      return fail(
        'Сервер отвечает, но не принимает ключ. Проверьте VITE_SUPABASE_ANON_KEY: нужен публичный ключ (anon или publishable) из Project Settings → API. Секретный ключ (service_role) вставлять нельзя. После исправления пересоберите приложение.',
      );
    case 'foreign': {
      const what = p.message.trimStart().startsWith('<') ? ' (получена веб-страница)' : p.message ? ` (ответ: «${short(p.message, 60)}»)` : '';
      return fail(
        `По адресу${where} отвечает не база Supabase${what}. Проверьте VITE_SUPABASE_URL: он должен выглядеть как https://abcdefgh.supabase.co, без «/rest/v1» на конце.`,
      );
    }
    case 'server':
      return fail(`Сервер${where} ответил ошибкой ${p.status}. Подождите минуту и повторите. ${PAUSE_HINT}`);
    case 'other':
      if (p.code !== '') return { status: 'ok', message: `Сервер${where} отвечает.` };
      return fail(`Неожиданный ответ при обращении к серверу${where}: «${short(p.message) || 'без текста'}». Подождите минуту и повторите проверку.`);
    default:
      return { status: 'ok', message: `Сервер${where} отвечает.` };
  }
}

// ---------- пробная запись ----------

/**
 * Одна пробная строка на таблицу. Строка нарушает РОВНО одно правило базы (rule), сервер обязан ответить 23514 именно с ним.
 * Отправляется через upsert (insert ... on conflict do update) — так же, как настоящая синхронизация: права на вставку и на
 * обновление проверяются до проверки строки, поэтому нехватка любого из них видна как 42501.
 * Если правила в базе нет, строка прошла бы: поэтому она сразу помечена удалённой (deleted_at) и приложению не видна.
 */
export interface WriteProbe {
  table: string;
  rule: string;
  build(id: string, stamp: string, makeId: () => string): Record<string, unknown>;
}

const common = (id: string, stamp: string) => ({ id, created_at: stamp, client_updated_at: stamp, device_id: 'cloud-check', deleted_at: stamp });

export const WRITE_PROBES: readonly WriteProbe[] = [
  // id чужой настройкам (настройки живут под id пользователя) — нарушает settings_id_is_user
  { table: 'settings', rule: 'settings_id_is_user', build: (id, stamp) => ({ ...common(id, stamp), base_currency: 'TJS', locale: 'ru', week_starts_on: 1, default_wallet_id: null }) },
  // пустое имя
  {
    table: 'wallets',
    rule: 'wallets_name_len',
    build: (id, stamp) => ({
      ...common(id, stamp), name: '', currency: 'TJS', kind: 'cash', opening_balance_minor: 0, color: '#000000', icon: 'x', sort_order: 0, archived_at: null,
    }),
  },
  {
    table: 'categories',
    rule: 'categories_name_len',
    build: (id, stamp) => ({ ...common(id, stamp), name: '', kind: 'expense', parent_id: null, color: '#000000', icon: 'x', sort_order: 0, archived_at: null }),
  },
  // сумма 0 (допустимы только от 1); кошелёк выдуман, но до ключей дело не доходит: правило суммы срабатывает раньше
  {
    table: 'transactions',
    rule: 'transactions_amount',
    build: (id, stamp, makeId) => ({
      ...common(id, stamp), kind: 'expense', wallet_id: makeId(), to_wallet_id: null, amount_minor: 0, to_amount_minor: null, category_id: null,
      occurred_on: '2026-01-01', note: '', base_currency: 'TJS', base_amount_minor: 0, fx_rate: null, fx_source: null,
    }),
  },
];

type WriteOutcome =
  | { kind: 'ok' }
  | { kind: 'created'; id: string }
  | { kind: 'otherRule'; rule: string }
  | { kind: 'code23'; code: string }
  | { kind: 'columns' }
  | { kind: 'problem'; probe: Probe };

const RULE_IN_MESSAGE = /check constraint "([^"]+)"/i;

function classifyWrite(p: WriteProbe, id: string, res: CloudQueryResult | typeof TIMED_OUT): WriteOutcome {
  if (res === TIMED_OUT) return { kind: 'problem', probe: { kind: 'timeout' } };
  if (typeof res !== 'object' || res === null) return { kind: 'problem', probe: { kind: 'foreign', message: '' } };
  if (!res.error) {
    const back = Array.isArray(res.data) ? (res.data[0] as { id?: unknown } | null | undefined)?.id : undefined;
    return { kind: 'created', id: typeof back === 'string' ? back : id };
  }
  const code = text(res.error.code);
  if (code === '23514') {
    // 23514 по ДРУГОМУ правилу (например, неверные часы телефона → *_ts_sane) не доказывает, что нужное правило работает
    const rule = RULE_IN_MESSAGE.exec(text(res.error.message))?.[1];
    return rule !== undefined && rule !== p.rule ? { kind: 'otherRule', rule } : { kind: 'ok' };
  }
  if (COLUMN_CODES.has(code)) return { kind: 'columns' };
  if (code.startsWith('23')) return { kind: 'code23', code };
  return { kind: 'problem', probe: probeOf(res) };
}

interface Issue {
  fail: boolean;
  /** Одинаковые проблемы разных таблиц склеиваются в одну фразу. */
  key: string;
  say: (tables: string) => string;
}

function issueOf(table: string, o: WriteOutcome): Issue | null {
  switch (o.kind) {
    case 'ok':
      return null;
    case 'created':
      return {
        fail: true,
        key: `created:${table}:${o.id}`,
        say: () =>
          `Проверка создала лишнюю строку в таблице ${table} (id: ${o.id}). Это значит, что защита от неверных данных в базе не работает. Строка помечена удалённой и в приложении не видна; удалите её в Supabase (Table Editor → ${table}) и выполните supabase/schema.sql заново.`,
      };
    case 'columns':
      return { fail: true, key: 'columns', say: (t) => `Схема в облаке не совпадает с приложением (нет нужной колонки: ${t}). ${SCHEMA_HINT}.` };
    case 'otherRule':
      return {
        fail: false,
        key: `rule:${o.rule}`,
        say: (t) =>
          `Запись разрешена, но сервер отклонил пробную строку другим правилом («${short(o.rule, 60)}», таблицы: ${t}), поэтому защиту нельзя считать проверенной. Проверьте дату и время на устройстве; если они верные, схема в облаке отличается от приложения. ${SCHEMA_HINT}.`,
      };
    case 'code23':
      return {
        fail: false,
        key: `c23:${o.code}`,
        say: (t) => `Запись разрешена, но сервер ответил кодом ${o.code} вместо ожидаемого 23514 (${t}). Возможно, схема в облаке отличается от приложения. ${SCHEMA_HINT}.`,
      };
    case 'problem':
      return problemIssue(o.probe);
  }
}

function problemIssue(p: Probe): Issue {
  switch (p.kind) {
    case 'denied':
      return {
        fail: true,
        key: 'denied',
        say: (t) =>
          `Нет прав записи (${t}). Синхронизации нужны и вставка, и обновление записей. Проверьте политики и права из supabase/schema.sql (раздел «Права и защита строк») и выполните файл заново.`,
      };
    case 'auth':
      return { fail: true, key: 'auth', say: () => `Сервер не видит вашего входа. ${RELOGIN}` };
    case 'network':
    case 'timeout':
      return { fail: true, key: 'down', say: () => 'Сервер не ответил на пробную запись. Проверьте интернет и повторите проверку.' };
    case 'missing':
      return { fail: true, key: 'missing', say: (t) => `Нет таблиц: ${t}. ${SCHEMA_HINT}.` };
    case 'server':
      return { fail: true, key: `server:${p.status}`, say: () => `Сервер ответил ошибкой ${p.status}. Подождите минуту и повторите.` };
    case 'other':
      return {
        fail: false,
        key: `other:${p.code}:${p.message}`,
        say: (t) =>
          `Неожиданный ответ сервера на пробную запись (${t})${p.code ? `, код ${p.code}` : ''}: «${short(p.message) || 'без текста'}». Приложите отчёт, когда будете обращаться за помощью.`,
      };
    default:
      return { fail: false, key: 'foreign', say: () => 'Сервер ответил на пробную запись непонятно. Повторите проверку.' };
  }
}

/** Итог шага «Запись данных» по результатам для таблиц (в порядке таблиц). */
function summarizeWrite(entries: readonly (readonly [string, WriteOutcome])[]): StepResult {
  const groups = new Map<string, { issue: Issue; tables: string[] }>();
  for (const [table, outcome] of entries) {
    const issue = issueOf(table, outcome);
    if (!issue) continue;
    const g = groups.get(issue.key);
    if (g) g.tables.push(table);
    else groups.set(issue.key, { issue, tables: [table] });
  }
  if (groups.size === 0) {
    return {
      status: 'ok',
      message: `Запись разрешена, защита данных работает: проверка нарочно отправила неверные строки в таблицы ${entries.map(([t]) => t).join(', ')}, сервер их отклонил. Ваши данные не менялись. Правка уже существующих записей не проверялась.`,
    };
  }
  const list = [...groups.values()].sort((a, b) => Number(b.issue.fail) - Number(a.issue.fail));
  return { status: list.some((g) => g.issue.fail) ? 'fail' : 'warn', message: list.map((g) => g.issue.say(g.tables.join(', '))).join(' ') };
}

export interface WriteProbeOptions {
  /** Таблицы, которые пробовать (чего в базе нет, туда не пишем). */
  tables: readonly string[];
  makeId: () => string;
  stamp: string;
  timeoutMs: number;
}

/** Отправляет по одной заведомо неверной строке в каждую таблицу и сводит ответы в один результат шага. */
export async function runWriteProbes(client: CloudClientLike, o: WriteProbeOptions): Promise<StepResult> {
  const probes = WRITE_PROBES.filter((p) => o.tables.includes(p.table));
  const entries = await Promise.all(
    probes.map(async (p): Promise<readonly [string, WriteOutcome]> => {
      let id = '';
      try {
        id = o.makeId();
        const res = await withTimeout(client.from(p.table).upsert(p.build(id, o.stamp, o.makeId), { onConflict: 'id' }), o.timeoutMs);
        return [p.table, classifyWrite(p, id, res)];
      } catch (e) {
        return [p.table, { kind: 'problem', probe: probeOfThrown(e) }];
      }
    }),
  );
  return summarizeWrite(entries);
}
