import type { Transaction } from '@electric-sql/pglite';
import type { PgliteServer } from '../../tests/sync/pglite';

/**
 * Подмена PostgREST + сервера авторизации поверх НАСТОЯЩЕГО supabase/schema.sql в PGlite. Нужна, чтобы функция send-reminders
 * ходила в базу своим настоящим кодом (createPostgrestStore): неверное имя колонки, фильтр или таблицы тут ломает запрос
 * так же, как на живом Supabase. Только для тестов.
 *
 * Умеет ровно то, что нужно функции:
 *  GET    /rest/v1/<таблица>?select=a,b&колонка=eq|neq|gt|gte|lt|lte.X | is.null | not.is.null | in.(a,b)&order=к.asc,к.desc&limit=N&offset=N
 *  POST   /rest/v1/<таблица>?on_conflict=a,b&select=a   Prefer: resolution=ignore-duplicates|merge-duplicates, return=representation|minimal
 *  PATCH  /rest/v1/<таблица>?фильтры   (тело — объект)      DELETE /rest/v1/<таблица>?фильтры
 *  GET    /auth/v1/user   (токен пользователя из makeJwt: проверяется срок и наличие пользователя)
 * Ключ: заголовок apikey обязан равняться serviceKey; если есть Authorization, то только «Bearer <serviceKey>» (роль service_role).
 * Как у настоящего PostgREST: ответ ограничен maxRows строками (1000), даже если просили больше; неизвестная колонка — 400.
 */

export interface PgrestCall {
  method: string;
  table: string;
  query: string;
}

export interface PgrestEmulator {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  log: PgrestCall[];
  setMaxRows(n: number): void;
  /** Следующие n запросов (к таблице table, если указана) получают этот статус без обращения к базе. */
  failNext(status: number, times?: number, table?: string): void;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (ident: string): string => `"${ident}"`;
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);

const json = (status: number, body: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const apiError = (status: number, code: string, message: string): Response => json(status, { code, details: null, hint: null, message });

function statusFor(code: string): number {
  if (code === '23503' || code === '23505') return 409;
  if (code === '42501') return 403;
  if (code === '42P01') return 404;
  return code.startsWith('22') || code.startsWith('23') || code.startsWith('42') ? 400 : 500;
}

class BadRequest extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createPgrestEmulator(server: PgliteServer, opts: { base: string; serviceKey: string; maxRows?: number }): PgrestEmulator {
  const base = opts.base.replace(/\/+$/, '');
  let maxRows = opts.maxRows ?? 1000;
  const log: PgrestCall[] = [];
  const failures: Array<{ status: number; table?: string }> = [];
  let columns: Map<string, Map<string, string>> | null = null;

  async function columnsOf(table: string): Promise<Map<string, string>> {
    if (columns === null) {
      const res = await server.db.query<{ table_name: string; column_name: string; data_type: string }>(
        `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`,
      );
      columns = new Map();
      for (const r of res.rows) {
        const map = columns.get(r.table_name) ?? new Map<string, string>();
        map.set(r.column_name, r.data_type);
        columns.set(r.table_name, map);
      }
    }
    const cols = columns.get(table);
    if (!cols) throw new BadRequest('PGRST205', `Could not find the table 'public.${table}' in the schema cache`);
    return cols;
  }

  const col = (cols: Map<string, string>, name: string): string => {
    if (!IDENT.test(name) || !cols.has(name)) throw new BadRequest('42703', `column ${name} does not exist`);
    return q(name);
  };

  /** Фильтры из адреса → условие where и параметры. */
  function where(params: URLSearchParams, cols: Map<string, string>, args: unknown[]): string {
    const conds: string[] = [];
    for (const [key, value] of params.entries()) {
      if (RESERVED.has(key)) continue;
      const c = col(cols, key);
      // драйвер PGlite принимает для boolean только настоящие true/false, а PostgREST — текст из адреса
      const typed = (raw: string): unknown => (cols.get(key) === 'boolean' ? raw === 'true' : raw);
      const dot = value.indexOf('.');
      const op = dot < 0 ? value : value.slice(0, dot);
      const rest = dot < 0 ? '' : value.slice(dot + 1);
      const ops: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      if (ops[op]) {
        args.push(typed(rest));
        conds.push(`${c} ${ops[op]} $${args.length}`);
      } else if (op === 'is' && ['null', 'true', 'false'].includes(rest)) {
        conds.push(`${c} is ${rest}`);
      } else if (op === 'not' && rest === 'is.null') {
        conds.push(`${c} is not null`);
      } else if (op === 'in' && /^\(.*\)$/.test(rest)) {
        const items = rest.slice(1, -1).split(',').map((s) => s.replace(/^"(.*)"$/, '$1'));
        if (items.length === 0 || items.some((s) => s === '')) throw new BadRequest('PGRST100', 'пустое значение в in.()');
        conds.push(`${c} in (${items.map((it) => (args.push(typed(it)), `$${args.length}`)).join(', ')})`);
      } else {
        throw new BadRequest('PGRST100', `неизвестный оператор в ${key}=${value.slice(0, 20)}`);
      }
    }
    return conds.length > 0 ? ` where ${conds.join(' and ')}` : '';
  }

  const projection = (params: URLSearchParams, cols: Map<string, string>): string => {
    const sel = params.get('select');
    if (!sel || sel === '*') return '*';
    return sel.split(',').map((c) => col(cols, c.trim())).join(', ');
  };

  async function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return server.as({ role: 'service_role', sub: null }, fn);
  }

  async function rest(req: Request, url: URL, table: string): Promise<Response> {
    const cols = await columnsOf(table);
    const params = url.searchParams;
    const prefer = req.headers.get('prefer') ?? '';
    const args: unknown[] = [];

    if (req.method === 'GET') {
      const cond = where(params, cols, args);
      const order = (params.get('order') ?? '')
        .split(',')
        .filter((s) => s !== '')
        .map((s) => {
          const [c = '', dir = 'asc'] = s.split('.');
          if (dir !== 'asc' && dir !== 'desc') throw new BadRequest('PGRST100', 'порядок сортировки');
          return `${col(cols, c)} ${dir}`;
        });
      const asked = params.has('limit') ? Number(params.get('limit')) : maxRows;
      if (!Number.isInteger(asked) || asked < 0) throw new BadRequest('PGRST100', 'limit');
      const offset = Number(params.get('offset') ?? '0');
      const sql =
        `select to_jsonb(r) as j from (select ${projection(params, cols)} from public.${q(table)}${cond}` +
        `${order.length > 0 ? ` order by ${order.join(', ')}` : ''} limit ${Math.min(asked, maxRows)} offset ${Number.isInteger(offset) ? offset : 0}) r`;
      const res = await run((tx) => tx.query<{ j: unknown }>(sql, args));
      return json(200, res.rows.map((r) => r.j));
    }

    if (req.method === 'POST') {
      const body: unknown = await req.json();
      const rows = Array.isArray(body) ? body : [body];
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r as object)))];
      for (const k of keys) if (!cols.has(k)) throw new BadRequest('PGRST204', `Could not find the '${k}' column of '${table}' in the schema cache`);
      const list = keys.map(q).join(', ');
      const conflict = (params.get('on_conflict') ?? '').split(',').filter((s) => s !== '');
      let tail = '';
      if (prefer.includes('resolution=ignore-duplicates')) tail = ` on conflict (${conflict.map((c) => col(cols, c)).join(', ')}) do nothing`;
      else if (prefer.includes('resolution=merge-duplicates')) {
        const set = keys.filter((k) => !conflict.includes(k)).map((k) => `${q(k)} = excluded.${q(k)}`);
        tail = ` on conflict (${conflict.map((c) => col(cols, c)).join(', ')}) do update set ${set.join(', ')}`;
      }
      const insert = `insert into public.${q(table)} (${list}) select ${list} from jsonb_populate_recordset(null::public.${q(table)}, $1::jsonb)${tail}`;
      if (prefer.includes('return=representation')) {
        const sql = `with ins as (${insert} returning *) select to_jsonb(x) as j from (select ${projection(params, cols)} from ins) x`;
        const res = await run((tx) => tx.query<{ j: unknown }>(sql, [JSON.stringify(rows)]));
        return json(201, res.rows.map((r) => r.j));
      }
      await run((tx) => tx.query(insert, [JSON.stringify(rows)]));
      return json(201, undefined);
    }

    if (req.method === 'PATCH') {
      const body = (await req.json()) as Record<string, unknown>;
      const sets = Object.keys(body).map((k) => (args.push(body[k]), `${col(cols, k)} = $${args.length}`));
      const cond = where(params, cols, args);
      await run((tx) => tx.query(`update public.${q(table)} set ${sets.join(', ')}${cond}`, args));
      return json(204, undefined);
    }

    if (req.method === 'DELETE') {
      const cond = where(params, cols, args);
      await run((tx) => tx.query(`delete from public.${q(table)}${cond}`, args));
      return json(204, undefined);
    }
    return apiError(405, 'PGRST117', 'метод не поддерживается');
  }

  async function authUser(req: Request): Promise<Response> {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
    const parts = token.split('.');
    if (parts.length !== 3) return json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    try {
      const claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown };
      if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return json(401, { code: 401, error_code: 'bad_jwt', msg: 'token is expired' });
      if (typeof claims.sub !== 'string') return json(401, { code: 401, error_code: 'bad_jwt', msg: 'missing sub' });
      const found = await server.db.query('select 1 from auth.users where id = $1', [claims.sub]);
      if (found.rows.length === 0) return json(403, { code: 403, error_code: 'user_not_found', msg: 'user not found' });
      return json(200, { id: claims.sub, aud: 'authenticated', role: 'authenticated' });
    } catch {
      return json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    }
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!url.href.startsWith(base)) return apiError(404, 'PGRST125', 'неизвестный адрес');
    const path = url.pathname;
    const key = req.headers.get('apikey');
    const auth = req.headers.get('authorization');
    if (path === '/auth/v1/user') {
      if (key !== opts.serviceKey) return json(401, { message: 'Invalid API key' });
      return authUser(req);
    }
    const m = /^\/rest\/v1\/([^/]+)$/.exec(path);
    if (!m) return apiError(404, 'PGRST125', 'неизвестный адрес');
    log.push({ method: req.method, table: m[1] as string, query: url.search });
    if (key !== opts.serviceKey || (auth !== null && auth !== `Bearer ${opts.serviceKey}`)) return json(401, { message: 'Invalid API key' });
    // Новый секретный ключ (не JWT) в Authorization PostgREST отвергает: «Expected 3 parts in JWT»
    if (auth !== null && !/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(opts.serviceKey)) return apiError(401, 'PGRST301', 'Expected 3 parts in JWT; got 1');
    const at = failures.findIndex((f) => f.table === undefined || f.table === m[1]);
    if (at >= 0) return apiError((failures.splice(at, 1)[0] as { status: number }).status, 'XX000', 'сбой по заказу теста');
    try {
      return await rest(req, url, m[1] as string);
    } catch (e) {
      if (e instanceof BadRequest) return apiError(400, e.code, e.message);
      const code = (e as { code?: unknown }).code;
      if (typeof code === 'string') return apiError(statusFor(code), code, (e as Error).message);
      throw e;
    }
  }

  return {
    fetch: async (url, init) => handle(new Request(url, init)),
    log,
    setMaxRows(n) {
      maxRows = n;
    },
    failNext(status, times = 1, table) {
      for (let i = 0; i < times; i++) failures.push({ status, table });
    },
  };
}
