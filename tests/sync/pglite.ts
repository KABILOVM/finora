import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { TABLE_SPECS, type PulledRow, type SyncTableName, type WireRow } from '@/sync/tables';
import { TransportError, type SyncTransport } from '@/sync/transport';

/**
 * Настоящий Postgres (PGlite) вместо Supabase: заглушки auth и роли + supabase/schema.sql ЦЕЛИКОМ.
 * PgliteTransport ведёт себя как PostgREST: push — один оператор insert ... on conflict (id) do update на всю пачку.
 */

export const SCHEMA_PATH = fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url));

export function readSchemaSql(): string {
  return readFileSync(SCHEMA_PATH, 'utf8');
}

/** То, что в настоящем Supabase есть «из коробки»: auth.users, auth.uid(), роли и доступ к схемам. */
const SUPABASE_STUBS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Как в настоящем Supabase: новые таблицы/функции/счётчики в public по умолчанию доступны всем трём ролям.
-- Схема обязана сама отобрать лишнее (иначе у authenticated остался бы DELETE).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type PgRole = 'anon' | 'authenticated' | 'service_role';
export interface Actor {
  role: PgRole;
  /** Содержимое JWT-поля sub (id пользователя); null/'' = токена нет. */
  sub: string | null;
}

/**
 * Ошибка Postgres → TransportError.
 * 28000 → 'auth'; 23xxx и 42501 → 'rejected'; прочее → 'server'.
 * Отступление от буквы договора: классы 22xxx (мусор в значении: не число, не uuid, переполнение) и 21000 (две строки
 * с одним id в одной пачке) тоже 'rejected' — PostgREST отвечает на них кодом 400, и повтор тех же данных не поможет,
 * а 'server' (повторять) заклинил бы очередь отправки на отравленной записи навсегда.
 */
export function toTransportError(e: unknown): TransportError {
  if (e instanceof TransportError) return e;
  const message = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return new TransportError('server', message);
  if (code === '28000') return new TransportError('auth', message, code);
  if (code.startsWith('23') || code.startsWith('22') || code === '42501' || code === '21000') {
    return new TransportError('rejected', message, code);
  }
  return new TransportError('server', message, code);
}

/** Выполнить fn в транзакции от имени роли и пользователя (как PostgREST: set local role + request.jwt.claim.sub). */
async function inActor<T>(db: PGlite, who: Actor, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.sub ?? '']);
    await tx.exec(`set local role ${who.role}`);
    return fn(tx);
  });
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (ident: string): string => `"${ident}"`;

export class PgliteTransport implements SyncTransport {
  /** userId = null — клиент без входа (роль anon). beforeOp — подготовка перед каждым вызовом (завести пользователя). */
  constructor(
    private readonly db: PGlite,
    private readonly userId: string | null,
    private readonly beforeOp?: () => Promise<void>,
  ) {}

  private actor(): Actor {
    return this.userId === null ? { role: 'anon', sub: null } : { role: 'authenticated', sub: this.userId };
  }

  async pull(table: SyncTableName, afterSeq: number, limit: number): Promise<PulledRow[]> {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new RangeError(`afterSeq: ${afterSeq}`);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`limit: ${limit}`);
    try {
      await this.beforeOp?.();
      const remote = TABLE_SPECS[table].remote;
      // to_jsonb: числа — числами, время — строками ISO, как отдаёт PostgREST (а не как их разбирает драйвер).
      const res = await inActor(this.db, this.actor(), (tx) =>
        tx.query<{ j: PulledRow }>(
          `select to_jsonb(t) as j from public.${remote} t where t.server_seq > $1 order by t.server_seq limit $2`,
          [afterSeq, limit],
        ),
      );
      return res.rows.map((r) => r.j);
    } catch (e) {
      throw toTransportError(e);
    }
  }

  async push(table: SyncTableName, rows: WireRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      await this.beforeOp?.();
      // Колонки — объединение ключей присланных строк (так делает PostgREST); в do update — все, кроме id.
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const bad = cols.find((c) => !IDENT.test(c));
      if (bad !== undefined) throw new TransportError('rejected', `недопустимое имя колонки: ${bad}`, '42703');
      const list = cols.map(q).join(', ');
      const updates = cols.filter((c) => c !== 'id').map((c) => `${q(c)} = excluded.${q(c)}`);
      const remote = TABLE_SPECS[table].remote;
      const sql =
        `insert into public.${remote} (${list}) ` +
        `select ${list} from jsonb_populate_recordset(null::public.${remote}, $1::jsonb) ` +
        `on conflict (id) ${updates.length > 0 ? `do update set ${updates.join(', ')}` : 'do nothing'}`;
      // Один оператор на всю пачку: ошибка в любой строке откатывает всё.
      await inActor(this.db, this.actor(), (tx) => tx.query(sql, [JSON.stringify(rows)]));
    } catch (e) {
      throw toTransportError(e);
    }
  }
}

export interface PgliteServer {
  db: PGlite;
  /** Клиент от имени пользователя (пользователь заводится в auth.users при первом обращении). */
  transportFor(userId: string): PgliteTransport;
  /** Клиент без входа (роль anon). */
  signedOutTransport(): PgliteTransport;
  now(): Date;
  /** Все строки таблицы в обход RLS (суперпользователь), по возрастанию server_seq. */
  adminRows(table: SyncTableName): Promise<Record<string, unknown>[]>;
  /** SQL от имени роли/пользователя в одной транзакции. Ошибка Postgres пробрасывается как есть (с полем code). */
  as<T>(who: Actor, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  addUser(userId: string): Promise<void>;
  /** Применить supabase/schema.sql целиком (можно сколько угодно раз подряд). */
  applySchema(): Promise<void>;
  close(): Promise<void>;
}

/** Поднимает PGlite, ставит заглушки Supabase и применяет схему ДВАЖДЫ подряд (проверка идемпотентности). */
export async function createPgliteServer(): Promise<PgliteServer> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);
  const sql = readSchemaSql();
  await db.exec(sql);
  await db.exec(sql);

  const known = new Set<string>();
  const addUser = async (userId: string): Promise<void> => {
    if (known.has(userId)) return;
    await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [userId]);
    known.add(userId);
  };

  return {
    db,
    transportFor: (userId) => new PgliteTransport(db, userId, () => addUser(userId)),
    signedOutTransport: () => new PgliteTransport(db, null),
    now: () => new Date(),
    async adminRows(table) {
      const res = await db.query<{ j: Record<string, unknown> }>(
        `select to_jsonb(t) as j from public.${TABLE_SPECS[table].remote} t order by t.server_seq`,
      );
      return res.rows.map((r) => r.j);
    },
    as: (who, fn) => inActor(db, who, fn),
    addUser,
    async applySchema() {
      await db.exec(readSchemaSql());
    },
    close: () => db.close(),
  };
}
