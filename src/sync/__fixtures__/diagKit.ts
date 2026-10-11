import { runCloudCheck, type CheckStep, type CheckStepId, type CloudCheckContext, type CloudCheckOptions, type CloudClientLike, type CloudQuery, type CloudQueryResult } from '../diagnostics';

/** Поддельный клиент облака для тестов «Проверки облака»: каждый ответ задаётся вручную, сети нет. */

export const U = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER = '22222222-2222-4222-8222-222222222222';
export const PROJECT_URL = 'https://abcdefgh.supabase.co';
export const HOST = 'abcdefgh.supabase.co';

/** Ответ: готовый результат, вечное зависание или исключение при обращении. */
export type Reply = CloudQueryResult | 'hang' | { throws: unknown } | { later: Promise<CloudQueryResult> };

export const rows = (list: unknown[] = []): CloudQueryResult => ({ data: list, error: null, status: 200 });
export const fail = (code: string, message: string, status: number): CloudQueryResult => ({ data: null, error: { code, message }, status });
/** Как supabase-js отвечает при обрыве сети: статус 0 и текст ошибки fetch. */
export const NETWORK: CloudQueryResult = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 };
/** Правило, которое нарушает пробная строка каждой таблицы (как в настоящем schema.sql). */
export const PROBE_RULE: Record<string, string> = {
  settings: 'settings_id_is_user',
  wallets: 'wallets_name_len',
  categories: 'categories_name_len',
  transactions: 'transactions_amount',
};
/** Так Postgres отклоняет пробную строку таблицы. */
export const checkViolation = (table: string, rule: string = PROBE_RULE[table] ?? `${table}_x`): CloudQueryResult =>
  fail('23514', `new row for relation "${table}" violates check constraint "${rule}"`, 400);
export const NO_TABLE = fail('PGRST205', "Could not find the table 'public.x' in the schema cache", 404);
export const DENIED = fail('42501', 'permission denied for table x', 403);

export type SessionReply = { user?: { id?: unknown } | null } | null | 'hang' | { throws: unknown } | { error: string };

export interface Script {
  /** Ответ select по таблице; чего нет — отвечает «всё хорошо». */
  tables?: Record<string, Reply>;
  /** Ответ на пробную запись (upsert): один на все таблицы или свой для каждой; по умолчанию сервер отклоняет строку правилом 23514. */
  upsert?: Reply | ((table: string) => Reply);
  session?: SessionReply;
}

export interface Calls {
  selects: { table: string; columns: string; limit: number; order?: { column: string; ascending: boolean } }[];
  upserts: { table: string; row: Record<string, unknown>; options?: { onConflict?: string } }[];
  /** Сколько раз у запроса выключили повторы (retry(false)). */
  retriesOff: number;
}

const isThrow = (r: unknown): r is { throws: unknown } => typeof r === 'object' && r !== null && 'throws' in r;
const isLater = (r: unknown): r is { later: Promise<CloudQueryResult> } => typeof r === 'object' && r !== null && 'later' in r;

/** Ответ, который приходит только после open(): чтобы тест мог рассмотреть экран «идёт проверка». */
export function gate(): { reply: Reply; open(result?: CloudQueryResult): void } {
  let open: (r: CloudQueryResult) => void = () => undefined;
  const later = new Promise<CloudQueryResult>((resolve) => {
    open = resolve;
  });
  return { reply: { later }, open: (result = rows([{ id: U, user_id: U }])) => open(result) };
}

export function query(reply: Reply, calls?: Calls): CloudQuery {
  const q = {
    retry(enabled: boolean) {
      if (!enabled && calls) calls.retriesOff++;
      return q;
    },
    then(onFulfilled?: (v: CloudQueryResult) => unknown, onRejected?: (e: unknown) => unknown) {
      const p: Promise<CloudQueryResult> =
        reply === 'hang'
          ? new Promise(() => undefined)
          : isThrow(reply)
            ? Promise.reject(reply.throws)
            : isLater(reply)
              ? reply.later
              : Promise.resolve(reply);
      return p.then(onFulfilled, onRejected);
    },
  };
  return q as unknown as CloudQuery;
}

/** Нормальные ответы нормального облака. */
export const HEALTHY: Record<string, Reply> = {
  settings: rows([{ id: U, user_id: U }]),
  wallets: rows([{ id: 'w1', user_id: U }]),
  categories: rows([{ id: 'c1', user_id: U }]),
  transactions: rows([]),
  exchange_rates: rows([
    { as_of: '2026-10-09', source: 'nbt', fetched_at: '2026-10-09T05:30:00Z' },
    { as_of: '2026-10-10', source: 'nbt', fetched_at: '2026-10-10T05:30:00Z' },
  ]),
};

export function fakeCloud(script: Script = {}): { client: CloudClientLike; calls: Calls } {
  const calls: Calls = { selects: [], upserts: [], retriesOff: 0 };
  const tables = { ...HEALTHY, ...script.tables };
  const session: SessionReply = script.session === undefined ? { user: { id: U } } : script.session;
  const client: CloudClientLike = {
    from: (table) => ({
      select: (columns) => ({
        limit: (limit) => {
          calls.selects.push({ table, columns, limit });
          return query(tables[table] ?? NO_TABLE, calls);
        },
        order: (column, options) => ({
          limit: (limit) => {
            calls.selects.push({ table, columns, limit, order: { column, ascending: options?.ascending ?? true } });
            return query(tables[table] ?? NO_TABLE, calls);
          },
        }),
      }),
      upsert: (row, options) => {
        calls.upserts.push({ table, row, options });
        const reply = 'upsert' in script ? script.upsert : checkViolation;
        return query(typeof reply === 'function' ? reply(table) : (reply as Reply), calls);
      },
    }),
    auth: {
      getSession: () => {
        if (session === 'hang') return new Promise(() => undefined);
        if (isThrow(session)) return Promise.reject(session.throws);
        if (session !== null && 'error' in session) return Promise.resolve({ data: { session: null }, error: { message: session.error } });
        return Promise.resolve({ data: { session }, error: null });
      },
    },
  };
  return { client, calls };
}

export const ctxOf = (patch: Partial<CloudCheckContext> = {}): CloudCheckContext => ({
  userId: U,
  url: PROJECT_URL,
  hasSession: true,
  pending: 0,
  quarantined: 0,
  ...patch,
});

/** Запустить проверку и вернуть шаги по id. */
export async function check(script: Script = {}, ctx: Partial<CloudCheckContext> = {}, options: CloudCheckOptions = {}) {
  const { client, calls } = fakeCloud(script);
  const steps = await runCloudCheck(client, ctxOf(ctx), { newId: () => 'probe-id-1', ...options });
  const by = Object.fromEntries(steps.map((s) => [s.id, s])) as Record<CheckStepId, CheckStep>;
  return { steps, by, calls };
}
