// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { SYNC_TABLES, TABLE_SPECS, toWire } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { runConformance } from './conformance';
import { makeCategory, makeSettings, makeTransaction, makeUserId, makeWallet } from './factories';
import { createPgliteServer, type Actor, type PgliteServer } from './pglite';

let server: PgliteServer;
beforeAll(async () => {
  server = await createPgliteServer(); // внутри схема применяется дважды подряд (идемпотентность)
}, 120_000);
afterAll(async () => {
  await server.close();
});

runConformance('PGlite', async () => ({
  transportFor: (userId) => server.transportFor(userId),
  now: () => server.now(),
  adminRows: (table) => server.adminRows(table),
  signedOutTransport: () => server.signedOutTransport(),
}));

const HOUR = 3_600_000;
const user = (sub: string | null): Actor => ({ role: 'authenticated', sub });
const walletSql =
  `insert into public.wallets (id, created_at, client_updated_at, device_id, name, currency, kind, opening_balance_minor, color, icon, sort_order) ` +
  `values ($1, now(), now() - interval '1 hour', 'dev', 'W', 'TJS', 'cash', 0, '#fff', 'w', 1)`;

async function sqlError(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  if (e === null) throw new Error('ожидалась ошибка SQL, но её не было');
  const { code, message } = e as { code?: string; message: string };
  return { code: code ?? '', message };
}

/** Выполнить в транзакции, которая всегда откатывается (чтобы временные изменения схемы не просочились в другие тесты). */
async function rolledBack<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await server.db.transaction(async (tx) => {
    out = await fn(tx);
    await tx.rollback();
  });
  return out as T;
}

async function asInTx(tx: Transaction, who: Actor): Promise<void> {
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.sub ?? '']);
  await tx.exec(`set local role ${who.role}`);
}

async function adminRow(table: 'wallets' | 'transactions' | 'settings' | 'categories', id: string): Promise<Record<string, unknown>> {
  const row = (await server.adminRows(table)).find((r) => r['id'] === id);
  if (!row) throw new Error(`нет строки ${table}/${id}`);
  return row;
}

/** Пользователь с одним своим кошельком, созданным прямым SQL от его имени. */
async function userWithWallet(): Promise<{ userId: string; walletId: string }> {
  const userId = makeUserId();
  const walletId = makeWallet().id;
  await server.addUser(userId);
  await server.as(user(userId), (tx) => tx.query(walletSql, [walletId]));
  return { userId, walletId };
}

describe('схема: структура', () => {
  const TYPE: Record<string, string> = { uuid: 'uuid', text: 'text', int: 'bigint', num: 'numeric', ts: 'timestamp with time zone', date: 'date' };

  it.each(SYNC_TABLES)('11. контракт колонок TABLE_SPECS (%s): все колонки есть, типы совместимы, лишних нет', async (table) => {
    const spec = TABLE_SPECS[table];
    const res = await server.db.query<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null }>(
      `select column_name, data_type, is_nullable, numeric_precision, numeric_scale
         from information_schema.columns where table_schema = 'public' and table_name = $1`,
      [spec.remote],
    );
    const actual = new Map(res.rows.map((r) => [r.column_name, r]));
    const expected = [...spec.columns.map((c) => c.column), 'user_id', 'server_seq', 'server_updated_at'];
    expect([...actual.keys()].sort()).toEqual([...expected].sort());
    for (const c of spec.columns) {
      const r = actual.get(c.column);
      expect(r?.data_type, `${table}.${c.column}`).toBe(TYPE[c.type]);
      expect(r?.is_nullable, `${table}.${c.column} nullable`).toBe(c.nullable ? 'YES' : 'NO');
      if (c.type === 'num') expect([r?.numeric_precision, r?.numeric_scale]).toEqual([20, 10]);
    }
    expect(actual.get('user_id')).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(actual.get('server_seq')).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    expect(actual.get('server_updated_at')).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
  });

  it('двойное (и тройное) применение схемы: объекты не дублируются, данные на месте', async () => {
    const snapshot = async () =>
      (
        await server.db.query<Record<string, number>>(
          `select (select count(*) from pg_policies where schemaname = 'public')::int as policies,
                  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and not t.tgisinternal)::int as triggers,
                  (select count(*) from pg_indexes where schemaname = 'public')::int as indexes,
                  (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public')::int as constraints`,
        )
      ).rows[0];
    const before = await snapshot();
    expect(before).toMatchObject({ policies: 13, triggers: 4 }); // 3 политики × 4 таблицы + 1 у курсов; по триггеру на таблицу
    const { userId } = await userWithWallet();
    await server.applySchema();
    await server.applySchema();
    expect(await snapshot()).toEqual(before);
    expect(await server.transportFor(userId).pull('wallets', 0, 10)).toHaveLength(1);
  });

  it('индексы: (user_id, server_seq) на каждой таблице и (user_id, occurred_on desc) у операций', async () => {
    const res = await server.db.query<{ tablename: string; indexdef: string }>(`select tablename, indexdef from pg_indexes where schemaname = 'public'`);
    for (const t of SYNC_TABLES) {
      expect(res.rows.some((r) => r.tablename === t && r.indexdef.includes('(user_id, server_seq)')), t).toBe(true);
    }
    expect(res.rows.some((r) => r.tablename === 'transactions' && r.indexdef.includes('(user_id, occurred_on DESC)'))).toBe(true);
  });
});

describe('RLS и права напрямую в SQL', () => {
  it('RLS включён на всех таблицах; политик и прав на DELETE нет', async () => {
    const rls = await server.db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    for (const name of [...SYNC_TABLES, 'exchange_rates']) expect(rls.rows.find((r) => r.relname === name)?.relrowsecurity, name).toBe(true);
    const del = await server.db.query(`select 1 from pg_policies where schemaname = 'public' and cmd in ('DELETE', 'ALL')`);
    expect(del.rows).toEqual([]);
    for (const t of SYNC_TABLES) {
      const p = await server.db.query<{ d: boolean; s: boolean; i: boolean; u: boolean; anon: boolean }>(
        `select has_table_privilege('authenticated', $1, 'DELETE') as d, has_table_privilege('authenticated', $1, 'SELECT') as s,
                has_table_privilege('authenticated', $1, 'INSERT') as i, has_table_privilege('authenticated', $1, 'UPDATE') as u,
                has_table_privilege('anon', $1, 'SELECT') or has_table_privilege('public', $1, 'SELECT') as anon`,
        [`public.${t}`],
      );
      expect(p.rows[0], t).toEqual({ d: false, s: true, i: true, u: true, anon: false });
    }
  });

  it('10. DELETE и TRUNCATE запрещены ролью authenticated; anon не читает и не пишет', async () => {
    const { userId, walletId } = await userWithWallet();
    for (const t of SYNC_TABLES) {
      expect((await sqlError(server.as(user(userId), (tx) => tx.query(`delete from public.${t}`)))).code, `delete ${t}`).toBe('42501');
      expect((await sqlError(server.as(user(userId), (tx) => tx.exec(`truncate public.${t}`)))).code, `truncate ${t}`).toBe('42501');
      expect((await sqlError(server.as({ role: 'anon', sub: null }, (tx) => tx.query(`select * from public.${t}`)))).code, `anon select ${t}`).toBe('42501');
    }
    expect((await sqlError(server.as({ role: 'anon', sub: null }, (tx) => tx.query(walletSql, [makeWallet().id])))).code).toBe('42501');
    expect((await adminRow('wallets', walletId))['deleted_at']).toBeNull();
  });

  it('без sub в токене: строк не видно, записать нельзя (28000)', async () => {
    await userWithWallet();
    expect((await server.as(user(null), (tx) => tx.query('select id from public.wallets'))).rows).toEqual([]);
    expect((await sqlError(server.as(user(null), (tx) => tx.query(walletSql, [makeWallet().id])))).code).toBe('28000');
  });

  it('с чужим sub: чужие строки не видны и не меняются; запись под чужим именем невозможна', async () => {
    const A = await userWithWallet();
    const B = makeUserId();
    await server.addUser(B);
    expect((await server.as(user(B), (tx) => tx.query('select id from public.wallets where id = $1', [A.walletId]))).rows).toEqual([]);
    const upd = await server.as(user(B), (tx) => tx.query(`update public.wallets set name = 'Взлом', client_updated_at = now() where id = $1`, [A.walletId]));
    expect(upd.affectedRows).toBe(0);
    expect((await adminRow('wallets', A.walletId))['name']).toBe('W');
    // B пытается вставить строку «от имени A»: user_id всё равно станет B
    const forged = makeWallet().id;
    await server.as(user(B), (tx) =>
      tx.query(`insert into public.wallets (id, user_id, created_at, client_updated_at, device_id, name, currency, kind, opening_balance_minor, color, icon, sort_order)
                values ($1, $2, now(), now(), 'dev', 'F', 'TJS', 'cash', 0, '', '', 0)`, [forged, A.userId]),
    );
    expect((await adminRow('wallets', forged))['user_id']).toBe(B);
  });

  it('RLS держит и без триггера: with check не даёт вставить/перенести строку чужому пользователю', async () => {
    const A = await userWithWallet();
    const B = await userWithWallet();
    const cols = `(id, user_id, created_at, client_updated_at, device_id, name, currency, kind, opening_balance_minor, color, icon, sort_order, server_seq, server_updated_at)`;
    const ins = await rolledBack(async (tx) => {
      await tx.exec('alter table public.wallets disable trigger sync_guard'); // под суперпользователем
      await asInTx(tx, user(B.userId));
      return sqlError(tx.query(`insert into public.wallets ${cols} values ($1, $2, now(), now(), 'd', 'n', 'TJS', 'cash', 0, '', '', 0, 1, now())`, [makeWallet().id, A.userId]));
    });
    expect(ins.code).toBe('42501');
    expect(ins.message).toMatch(/row-level security/);
    const upd = await rolledBack(async (tx) => {
      await tx.exec('alter table public.wallets disable trigger sync_guard');
      await asInTx(tx, user(B.userId));
      return sqlError(tx.query(`update public.wallets set user_id = $2 where id = $1`, [B.walletId, A.userId]));
    });
    expect(upd.code).toBe('42501');
    expect(upd.message).toMatch(/row-level security/);
    expect((await adminRow('wallets', B.walletId))['user_id']).toBe(B.userId);
  });
});

describe('SECURITY DEFINER триггер', () => {
  it('search_path пуст, схема private закрыта, прямой вызов функции и счётчика запрещён', async () => {
    const meta = await server.db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where oid = 'private.sync_guard'::regproc`,
    );
    expect(meta.rows[0]?.prosecdef).toBe(true);
    expect(meta.rows[0]?.proconfig?.some((c) => /^search_path=("")?$/.test(c))).toBe(true);
    const priv = await server.db.query<Record<string, boolean>>(
      `select has_schema_privilege('authenticated', 'private', 'USAGE') as a_schema, has_schema_privilege('anon', 'private', 'USAGE') as n_schema,
              has_function_privilege('authenticated', 'private.sync_guard()', 'EXECUTE') as a_fn, has_function_privilege('anon', 'private.sync_guard()', 'EXECUTE') as n_fn,
              has_sequence_privilege('authenticated', 'private.sync_seq', 'USAGE') as a_seq, has_sequence_privilege('anon', 'private.sync_seq', 'USAGE') as n_seq`,
    );
    expect(Object.values(priv.rows[0] ?? {}).every((v) => v === false)).toBe(true);
    const { userId } = await userWithWallet();
    expect((await sqlError(server.as(user(userId), (tx) => tx.query(`select nextval('private.sync_seq')`)))).code).toBe('42501');
    expect((await sqlError(server.as(user(userId), (tx) => tx.query(`select private.sync_guard()`)))).code).toBe('42501');
  });

  it('подмена функций через search_path пользователя не действует на триггер', async () => {
    const userId = makeUserId();
    await server.addUser(userId);
    const id = makeWallet().id;
    const res = await rolledBack(async (tx) => {
      await tx.exec(`
        create schema evil;
        create function evil.clock_timestamp() returns timestamptz language sql as $$ select timestamptz '1999-01-01 00:00:00+00' $$;
        create function evil.nextval(regclass) returns bigint language sql as $$ select 424242::bigint $$;
        grant usage on schema evil to authenticated;
        grant execute on all functions in schema evil to authenticated;`);
      await asInTx(tx, user(userId));
      await tx.exec('set local search_path = evil, public, pg_catalog');
      // контроль: в этой сессии подмена действует (иначе тест ничего не доказывает)
      const control = await tx.query<{ c: Date }>('select clock_timestamp() as c');
      await tx.query(walletSql, [id]);
      const row = await tx.query<{ server_seq: number | bigint; server_updated_at: Date }>('select server_seq, server_updated_at from public.wallets where id = $1', [id]);
      return { control: control.rows[0]?.c, row: row.rows[0] };
    });
    expect(res.control?.getUTCFullYear()).toBe(1999);
    expect(Number(res.row?.server_seq)).not.toBe(424242);
    expect(res.row?.server_updated_at.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it('запись идёт под замком (в PGlite одно соединение, гонку не воспроизвести — проверяем сам замок и его снятие)', async () => {
    const userId = makeUserId();
    await server.addUser(userId);
    const held = await rolledBack(async (tx) => {
      await asInTx(tx, user(userId));
      await tx.query(walletSql, [makeWallet().id]);
      const r = await tx.query<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory'`);
      return r.rows[0]?.n;
    });
    expect(held).toBe(1);
    const after = await server.db.query<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory'`);
    expect(after.rows[0]?.n).toBe(0); // замок снят вместе с транзакцией
  });

  it('прямые UPDATE: user_id и id менять нельзя; server_seq не подделать; устаревшее молча игнорируется; created_at не меняется', async () => {
    const { userId, walletId } = await userWithWallet();
    const row0 = await adminRow('wallets', walletId);
    const run = (sql: string, params: unknown[]) => server.as(user(userId), (tx) => tx.query(sql, params));

    const e1 = await sqlError(run(`update public.wallets set user_id = $2 where id = $1`, [walletId, makeUserId()]));
    expect([e1.code, e1.message]).toEqual(['42501', expect.stringContaining('user_id')]);
    const e2 = await sqlError(run(`update public.wallets set id = $2 where id = $1`, [walletId, makeWallet().id]));
    expect(e2.code).toBe('42501');

    const stale = await run(`update public.wallets set name = 'Старое', client_updated_at = now() - interval '2 hours' where id = $1`, [walletId]);
    expect(stale.affectedRows).toBe(0);
    expect(await adminRow('wallets', walletId)).toEqual(row0);

    const ok = await run(`update public.wallets set name = 'Новое', server_seq = 999999999, created_at = timestamptz '2001-01-01 00:00:00+00', client_updated_at = now() where id = $1`, [walletId]);
    expect(ok.affectedRows).toBe(1);
    const row1 = await adminRow('wallets', walletId);
    expect(row1['name']).toBe('Новое');
    expect(row1['created_at']).toBe(row0['created_at']);
    expect(row1['server_seq']).not.toBe(999999999);
    expect(Number(row1['server_seq'])).toBeGreaterThan(Number(row0['server_seq']));

    // метка на год вперёд при прямой правке тоже зажимается (через upsert её уже зажал бы триггер вставки)
    const future = await run(`update public.wallets set name = 'Будущее', client_updated_at = now() + interval '1 year' where id = $1`, [walletId]);
    expect(future.affectedRows).toBe(1);
    expect(Date.parse(String((await adminRow('wallets', walletId))['client_updated_at']))).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });
});

describe('поведение сервера, специфичное для Postgres', () => {
  const stamps = (offsetMs: number) => {
    const t = new Date(Date.now() + offsetMs).toISOString();
    return { createdAt: t, clientUpdatedAt: t };
  };

  it('created_at из будущего тоже зажимается; номера server_seq общие для всех таблиц', async () => {
    const userId = makeUserId();
    const t = server.transportFor(userId);
    const future = stamps(365 * 24 * HOUR);
    const w = makeWallet(future);
    const c = makeCategory(stamps(-HOUR));
    const s = makeSettings(userId, stamps(-HOUR));
    await t.push('settings', [toWire('settings', s)]);
    await t.push('wallets', [toWire('wallets', w)]);
    await t.push('categories', [toWire('categories', c)]);
    expect(Date.parse(String((await adminRow('wallets', w.id))['created_at']))).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    const seqs = [(await adminRow('settings', s.id)), (await adminRow('wallets', w.id)), (await adminRow('categories', c.id))].map((r) => Number(r['server_seq']));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
  });

  it('правка не меняет created_at строки', async () => {
    const t = server.transportFor(makeUserId());
    const w = makeWallet({ ...stamps(-2 * HOUR) });
    await t.push('wallets', [toWire('wallets', w)]);
    await t.push('wallets', [toWire('wallets', { ...w, name: 'Другое', createdAt: new Date(Date.now() - HOUR).toISOString(), clientUpdatedAt: new Date(Date.now() - 60_000).toISOString() })]);
    const stored = await adminRow('wallets', w.id);
    expect(stored['name']).toBe('Другое');
    expect(Date.parse(String(stored['created_at']))).toBe(Date.parse(w.createdAt));
  });

  it('мусор в значениях отвергается как «rejected»: NaN в курсе, -infinity во времени, дробная и гигантская сумма', async () => {
    const userId = makeUserId();
    const t = server.transportFor(userId);
    const w = makeWallet(stamps(-HOUR));
    await t.push('wallets', [toWire('wallets', w)]);
    const tx = toWire('transactions', makeTransaction({ ...stamps(-HOUR), walletId: w.id }));
    const bad: Array<Record<string, string | number>> = [
      { fx_rate: 'NaN' },
      { client_updated_at: '-infinity' },
      { client_updated_at: '1970-01-01T00:00:00Z' },
      { amount_minor: 12.5 },
      { amount_minor: 1e30 },
      { occurred_on: 'не дата' },
      { id: 'не-uuid' },
    ];
    for (const patch of bad) {
      const err = await t.push('transactions', [{ ...tx, ...patch }]).then(() => null, (e: unknown) => e);
      expect(err, JSON.stringify(patch)).toBeInstanceOf(TransportError);
      expect((err as TransportError).kind, JSON.stringify(patch)).toBe('rejected');
    }
    // 'infinity' не ломает выдачу: зажимается до «сейчас + 5 минут»
    const inf = { ...tx, id: makeTransaction().id, client_updated_at: 'infinity', created_at: 'infinity' };
    await t.push('transactions', [inf]);
    const stored = await adminRow('transactions', String(inf.id));
    expect(Date.parse(String(stored['client_updated_at']))).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    expect(await t.pull('transactions', 0, 10)).toHaveLength(1);
  });

  it('две строки с одним id в одной пачке: пачка отвергается целиком (так же ответит и PostgREST)', async () => {
    const t = server.transportFor(makeUserId());
    const a = toWire('wallets', makeWallet(stamps(-HOUR)));
    const dup = { ...a, name: 'Копия' };
    const err = await t.push('wallets', [a, dup]).then(() => null, (e: unknown) => e);
    expect((err as TransportError).kind).toBe('rejected');
    expect(await t.pull('wallets', 0, 10)).toEqual([]);
  });

  it('удаление пользователя каскадно удаляет все его данные (и не застревает на внешних ключах)', async () => {
    const userId = makeUserId();
    const t = server.transportFor(userId);
    const w1 = makeWallet(stamps(-HOUR));
    const w2 = makeWallet(stamps(-HOUR));
    const c = makeCategory(stamps(-HOUR));
    await t.push('settings', [toWire('settings', makeSettings(userId, stamps(-HOUR)))]);
    await t.push('wallets', [toWire('wallets', w1), toWire('wallets', w2)]);
    await t.push('categories', [toWire('categories', c)]);
    await t.push('transactions', [
      toWire('transactions', makeTransaction({ ...stamps(-HOUR), walletId: w1.id, categoryId: c.id })),
      toWire('transactions', makeTransaction({ ...stamps(-HOUR), kind: 'transfer', walletId: w1.id, toWalletId: w2.id })),
    ]);
    for (const table of SYNC_TABLES) expect((await server.adminRows(table)).filter((r) => r['user_id'] === userId), table).not.toHaveLength(0);
    await server.db.query('delete from auth.users where id = $1', [userId]);
    for (const table of SYNC_TABLES) expect((await server.adminRows(table)).filter((r) => r['user_id'] === userId), table).toEqual([]);
  });
});

describe('курсы валют (exchange_rates)', () => {
  const insert = `insert into public.exchange_rates (as_of, source, pivot, per_unit, fetched_at) values ($1, $2, $3, $4::jsonb, now())`;
  const rates = JSON.stringify({ USD: 1, TJS: 0.09 });
  const day = () => `2030-01-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;

  it('service_role пишет и обновляет, authenticated только читает, anon не видит ничего', async () => {
    const asOf = day();
    const src = `test-${makeUserId()}`;
    const service: Actor = { role: 'service_role', sub: null };
    await server.as(service, (tx) => tx.query(insert, [asOf, src, 'USD', rates]));
    await server.as(service, (tx) => tx.query(`update public.exchange_rates set pivot = 'EUR' where as_of = $1 and source = $2`, [asOf, src]));

    const userId = makeUserId();
    const seen = await server.as(user(userId), (tx) => tx.query<{ pivot: string }>('select pivot from public.exchange_rates where source = $1', [src]));
    expect(seen.rows).toEqual([{ pivot: 'EUR' }]);
    expect((await sqlError(server.as(user(userId), (tx) => tx.query(insert, [asOf, `${src}-2`, 'USD', rates])))).code).toBe('42501');
    expect((await sqlError(server.as(user(userId), (tx) => tx.query(`update public.exchange_rates set pivot = 'RUB'`)))).code).toBe('42501');
    expect((await sqlError(server.as(user(userId), (tx) => tx.query('delete from public.exchange_rates')))).code).toBe('42501');
    expect((await sqlError(server.as({ role: 'anon', sub: null }, (tx) => tx.query('select * from public.exchange_rates')))).code).toBe('42501');
  });

  it('даже при выданных правах запись authenticated блокирует RLS (политик на запись нет)', async () => {
    const asOf = day();
    const src = `rls-${makeUserId()}`;
    await server.as({ role: 'service_role', sub: null }, (tx) => tx.query(insert, [asOf, src, 'USD', rates]));
    const res = await rolledBack(async (tx) => {
      await tx.exec('grant insert, update, delete on public.exchange_rates to authenticated');
      await asInTx(tx, user(makeUserId()));
      const upd = await tx.query(`update public.exchange_rates set pivot = 'RUB' where source = $1`, [src]);
      const del = await tx.query(`delete from public.exchange_rates where source = $1`, [src]);
      const ins = await sqlError(tx.query(insert, [asOf, `${src}-2`, 'USD', rates]));
      return { upd: upd.affectedRows, del: del.affectedRows, ins };
    });
    expect(res.upd).toBe(0);
    expect(res.del).toBe(0);
    expect(res.ins.code).toBe('42501');
    expect(res.ins.message).toMatch(/row-level security/);
  });

  it('проверки данных: опорная валюта — три заглавные буквы, per_unit — объект', async () => {
    const service: Actor = { role: 'service_role', sub: null };
    const e1 = await sqlError(server.as(service, (tx) => tx.query(insert, [day(), 'bad-pivot', 'usd', rates])));
    const e2 = await sqlError(server.as(service, (tx) => tx.query(insert, [day(), 'bad-units', 'USD', '[1, 2]'])));
    expect([e1.code, e2.code]).toEqual(['23514', '23514']);
  });
});
