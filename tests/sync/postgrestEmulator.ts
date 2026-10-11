import { TABLE_SPECS } from '@/sync/tables';
import type { PgRole, PgliteServer } from './pglite';

/**
 * Мини-эмулятор PostgREST в виде функции fetch поверх PGlite с НАСТОЯЩИМ supabase/schema.sql.
 * Через него настоящий supabase-js (createClient(url, key, { global: { fetch } })) ходит в настоящую схему:
 * проверяются и построение запросов, и разбор кодов ответов, и триггеры/ограничения/RLS.
 *
 * Что умеет (ровно то, что нужно синхронизации):
 *  GET  /rest/v1/<таблица>?select=*&server_seq=gt.N&order=server_seq.asc&limit=M
 *  POST /rest/v1/<таблица>?on_conflict=id   с заголовком Prefer: resolution=merge-duplicates[,return=minimal]
 * Вход: JWT из Authorization: Bearer (без проверки подписи! в тестах JWT делает makeJwt). Нет токена или роль anon → роль anon.
 * Коды ответов как у PostgREST: 23503/23505 → 409, остальные 23xxx и 22xxx → 400, 42501 → 403 (401 для анонима),
 * 28xxx → 403, просроченный токен → 401 PGRST301, неизвестная таблица → 404 PGRST205, неизвестная колонка → 400 PGRST204.
 * Не умеет: фильтры кроме server_seq, select не по *, PATCH/DELETE (в приложении их нет), проверку подписи JWT.
 */

export interface RequestLog {
  method: string;
  table: string;
  query: string;
  /** sub из JWT или null. */
  user: string | null;
  role: PgRole;
  /** Тело POST: сколько строк. */
  rows: number;
}

export interface PostgrestEmulator {
  fetch: typeof fetch;
  /** Адрес, который надо передать в createClient. */
  url: string;
  log: RequestLog[];
  /** Следующие n запросов не доходят (fetch бросает TypeError, как при обрыве сети). */
  failNetwork(times?: number): void;
  /** Следующие n запросов получают готовый HTTP-ответ, база не трогается. */
  failHttp(status: number, body?: unknown, times?: number): void;
  /** Следующие n запросов ВЫПОЛНЯЮТСЯ в базе, но ответ теряется (fetch бросает TypeError). */
  loseResponse(times?: number): void;
  /** Задержка ответа, мс. */
  setLatency(ms: number): void;
}

const b64url = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** JWT без подписи (эмулятор подпись не проверяет). */
export function makeJwt(claims: { sub?: string; role?: string; exp?: number }): string {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ role: 'authenticated', ...claims })}.`;
}

interface Auth {
  role: PgRole;
  sub: string | null;
  expired: boolean;
  invalid: boolean;
}

function readAuth(headers: Headers): Auth {
  const raw = headers.get('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(raw)?.[1];
  if (!token) return { role: 'anon', sub: null, expired: false, invalid: false };
  const parts = token.split('.');
  if (parts.length !== 3) return { role: 'anon', sub: null, expired: false, invalid: true };
  try {
    const claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown; role?: unknown; exp?: unknown };
    const expired = typeof claims.exp === 'number' && claims.exp * 1000 < Date.now();
    const role: PgRole = claims.role === 'anon' ? 'anon' : claims.role === 'service_role' ? 'service_role' : 'authenticated';
    return { role, sub: typeof claims.sub === 'string' && claims.sub !== '' ? claims.sub : null, expired, invalid: false };
  } catch {
    return { role: 'anon', sub: null, expired: false, invalid: true };
  }
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });

const pgrst = (status: number, code: string, message: string, details: string | null = null): Response =>
  json(status, { code, details, hint: null, message });

/** Статус HTTP по SQLSTATE — таблица PostgREST (в части, которая нам встречается). */
function statusFor(code: string, authed: boolean): number {
  if (code === '42501') return authed ? 403 : 401;
  if (code === '23503' || code === '23505') return 409;
  if (code === '42P01') return 404;
  if (code.startsWith('28')) return 403;
  if (code.startsWith('08') || code.startsWith('53')) return 503;
  if (/^(09|25|2D|38|39|3B|40|54|55|57|58|F0|HV|XX)/.test(code) || code === 'P0002') return 500;
  return 400;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (ident: string): string => `"${ident}"`;

export function createPostgrestEmulator(server: PgliteServer, opts: { url?: string } = {}): PostgrestEmulator {
  const url = opts.url ?? 'http://postgrest.test';
  const log: RequestLog[] = [];
  const netFails = { n: 0 };
  const httpFails: Array<{ status: number; body: unknown }> = [];
  const lost = { n: 0 };
  let latency = 0;
  /** «Кэш схемы» PostgREST: колонки таблиц. */
  let columns: Map<string, Set<string>> | null = null;

  async function schemaColumns(): Promise<Map<string, Set<string>>> {
    if (columns) return columns;
    const res = await server.db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    columns = new Map();
    for (const r of res.rows) {
      const set = columns.get(r.table_name) ?? new Set<string>();
      set.add(r.column_name);
      columns.set(r.table_name, set);
    }
    return columns;
  }

  const knownTables = new Set<string>(Object.values(TABLE_SPECS).map((s) => s.remote));

  async function handle(req: Request): Promise<{ response: Response; afterApply: boolean }> {
    const u = new URL(req.url);
    const m = /^\/rest\/v1\/([^/]+)$/.exec(u.pathname);
    const auth = readAuth(req.headers);
    const table = m?.[1] ?? '';
    const entry: RequestLog = { method: req.method, table, query: u.search, user: auth.sub, role: auth.role, rows: 0 };
    log.push(entry);

    if (!m) return { response: pgrst(404, 'PGRST125', `Invalid path specified in request URL`), afterApply: false };
    if (auth.invalid) return { response: pgrst(401, 'PGRST301', 'JWSError JWSInvalidSignature'), afterApply: false };
    if (auth.expired) return { response: pgrst(401, 'PGRST301', 'JWT expired'), afterApply: false };
    if (!knownTables.has(table)) {
      return { response: pgrst(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`), afterApply: false };
    }
    const authed = auth.role !== 'anon';
    if (auth.sub !== null && authed) await server.addUser(auth.sub); // в настоящем Supabase пользователь уже есть в auth.users
    const actor = { role: auth.role, sub: auth.sub };

    try {
      if (req.method === 'GET') return { response: await select(u, table, actor), afterApply: false };
      if (req.method === 'POST') {
        const body = await req.text();
        let rows: unknown;
        try {
          rows = JSON.parse(body);
        } catch {
          return { response: pgrst(400, 'PGRST102', 'Empty or invalid json'), afterApply: false };
        }
        const list = Array.isArray(rows) ? rows : [rows];
        if (!list.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))) {
          return { response: pgrst(400, 'PGRST102', 'All object keys must match'), afterApply: false };
        }
        entry.rows = list.length;
        return { response: await upsert(u, table, actor, list as Array<Record<string, unknown>>, req.headers.get('prefer') ?? ''), afterApply: true };
      }
      return { response: pgrst(405, 'PGRST117', `Unsupported HTTP method: ${req.method}`), afterApply: false };
    } catch (e) {
      const err = e as { code?: unknown; message?: unknown; detail?: unknown; hint?: unknown };
      const code = typeof err.code === 'string' ? err.code : 'XX000';
      const body = { code, details: typeof err.detail === 'string' ? err.detail : null, hint: typeof err.hint === 'string' ? err.hint : null, message: String(err.message ?? 'error') };
      return { response: json(statusFor(code, authed), body, code === '42501' && !authed ? { 'www-authenticate': 'Bearer' } : {}), afterApply: true };
    }
  }

  async function select(u: URL, table: string, actor: { role: PgRole; sub: string | null }): Promise<Response> {
    let after: number | null = null;
    let limit: number | null = null;
    let ascending = true;
    for (const [key, value] of u.searchParams) {
      if (key === 'select') {
        if (value !== '*') return pgrst(400, 'PGRST100', 'эмулятор поддерживает только select=*');
      } else if (key === 'server_seq') {
        const f = /^gt\.(\d+)$/.exec(value);
        if (!f) return pgrst(400, 'PGRST100', 'эмулятор поддерживает только server_seq=gt.N');
        after = Number(f[1]);
      } else if (key === 'order') {
        if (value !== 'server_seq.asc' && value !== 'server_seq.desc') return pgrst(400, 'PGRST100', 'эмулятор поддерживает только order=server_seq.asc|desc');
        ascending = value.endsWith('.asc');
      } else if (key === 'limit') {
        if (!/^\d+$/.test(value)) return pgrst(400, 'PGRST100', 'limit: ожидалось число');
        limit = Number(value);
      } else {
        return pgrst(400, 'PGRST100', `эмулятор не поддерживает параметр ${key}`);
      }
    }
    const where = after === null ? '' : 'where t.server_seq > $1';
    const params = after === null ? [] : [after];
    const sql = `select to_jsonb(t) as j from public.${table} t ${where} order by t.server_seq ${ascending ? 'asc' : 'desc'}${limit === null ? '' : ` limit ${limit}`}`;
    const res = await server.as(actor, (tx) => tx.query<{ j: unknown }>(sql, params));
    const rows = res.rows.map((r) => r.j);
    return json(200, rows, { 'content-range': rows.length === 0 ? '*/*' : `0-${rows.length - 1}/*` });
  }

  async function upsert(
    u: URL,
    table: string,
    actor: { role: PgRole; sub: string | null },
    rows: Array<Record<string, unknown>>,
    prefer: string,
  ): Promise<Response> {
    const known = (await schemaColumns()).get(table) ?? new Set<string>();
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    for (const c of cols) {
      if (!IDENT.test(c) || !known.has(c)) return pgrst(400, 'PGRST204', `Could not find the '${c}' column of '${table}' in the schema cache`);
    }
    if (cols.length === 0) return json(201, undefined);
    const onConflict = u.searchParams.get('on_conflict');
    const merge = /resolution=merge-duplicates/.test(prefer);
    const list = cols.map(q).join(', ');
    let conflict = '';
    if (merge) {
      if (onConflict !== 'id') return pgrst(400, 'PGRST100', 'эмулятор поддерживает только on_conflict=id');
      const updates = cols.filter((c) => c !== 'id').map((c) => `${q(c)} = excluded.${q(c)}`);
      conflict = updates.length > 0 ? `on conflict (id) do update set ${updates.join(', ')}` : 'on conflict (id) do nothing';
    }
    const sql = `insert into public.${table} (${list}) select ${list} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) ${conflict}`;
    await server.as(actor, (tx) => tx.query(sql, [JSON.stringify(rows)]));
    return json(201, undefined);
  }

  const emulatedFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    if (netFails.n > 0) {
      netFails.n--;
      throw new TypeError('Failed to fetch');
    }
    const forced = httpFails.shift();
    if (forced) return json(forced.status, forced.body);
    const signal = init?.signal ?? req.signal;
    if (signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const { response, afterApply } = await handle(req);
    if (latency > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, latency);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      });
    }
    if (lost.n > 0 && afterApply) {
      lost.n--;
      throw new TypeError('Failed to fetch');
    }
    return response;
  }) as typeof fetch;

  return {
    fetch: emulatedFetch,
    url,
    log,
    failNetwork: (times = 1) => void (netFails.n += times),
    failHttp: (status, body = { message: 'forced' }, times = 1) => void httpFails.push(...Array.from({ length: times }, () => ({ status, body }))),
    loseResponse: (times = 1) => void (lost.n += times),
    setLatency: (ms) => void (latency = ms),
  };
}
