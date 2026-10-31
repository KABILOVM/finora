import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { expect, test } from '@playwright/test';
import { ROOT } from './helpers';

/* ---------------------------------------------------------------------------------------------
 * Права в облаке: supabase/schema.sql целиком в настоящем Postgres (PGlite) с ролями anon / authenticated / service_role,
 * как их выставляет Supabase (включая «новым таблицам по умолчанию выдаются все права»). Каждое нападение — запрос
 * от имени роли и пользователя, как делает PostgREST. НЕ живой Supabase: политики Auth и настройки проекта не проверяются.
 * ------------------------------------------------------------------------------------------- */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const STUBS = `
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
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

let db: PGlite;

type Who = { role: 'anon' | 'authenticated' | 'service_role'; sub?: string };

/** Выполнить запрос от имени роли; вернуть строки или код ошибки Postgres (сообщение). Транзакция всегда откатывается. */
async function run(who: Who, sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number } | { error: string; code: string }> {
  try {
    let out: { rows: Record<string, unknown>[]; rowCount: number } | undefined;
    await db.transaction(async (tx: Transaction) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.sub ?? '']);
      await tx.exec(`set local role ${who.role}`);
      const r = await tx.query<Record<string, unknown>>(sql, params);
      out = { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
      await tx.rollback();
    });
    return out ?? { rows: [], rowCount: 0 };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return { error: err.message ?? String(e), code: err.code ?? '' };
  }
}

/** То же, но результат сохраняется (commit), чтобы подготовить данные. */
async function commit(who: Who, sql: string, params: unknown[] = []): Promise<void> {
  await db.transaction(async (tx: Transaction) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.sub ?? '']);
    await tx.exec(`set local role ${who.role}`);
    await tx.query(sql, params);
  });
}

const TABLES = ['settings', 'wallets', 'categories', 'debts', 'budgets', 'recurring_rules', 'transactions', 'shopping_items', 'savings_goals'] as const;
const WALLET_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-10-10T10:00:00Z';

const walletInsert = (id: string, name = 'Кошелёк', extra = '') =>
  `insert into public.wallets (id, created_at, client_updated_at, device_id, name, currency, kind, opening_balance_minor, color, icon, sort_order ${extra ? ',' + extra.split('=')[0] : ''})
   values ('${id}', '${NOW}', '${NOW}', 'dev', '${name}', 'TJS', 'cash', 0, '#fff', 'x', 0 ${extra ? ',' + extra.split('=')[1] : ''})`;

test.describe('schema.sql: права и RLS (PGlite)', () => {
  test.beforeEach(({ browserName: _b }, info) => test.skip(info.project.name !== 'desktop', 'не зависит от устройства'));
  test.beforeAll(async () => {
    db = new PGlite();
    await db.exec(STUBS);
    await db.exec(readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8'));
    await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}')`);
    await commit({ role: 'authenticated', sub: A }, walletInsert(WALLET_A, 'Кошелёк A'));
  });
  test.afterAll(async () => {
    await db?.close();
  });

  test('anon (ключ приложения без входа) не читает и не пишет ничего, включая курсы', async () => {
    for (const t of [...TABLES, 'exchange_rates']) {
      const r = await run({ role: 'anon' }, `select * from public.${t}`);
      expect('error' in r && r.code, `anon select ${t}`).toBe('42501');
    }
    const ins = await run({ role: 'anon' }, walletInsert('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    expect('error' in ins && ins.code).toBe('42501');
  });

  test('authenticated: DELETE и TRUNCATE запрещены на всех таблицах; курсы только читать', async () => {
    for (const t of TABLES) {
      const d = await run({ role: 'authenticated', sub: A }, `delete from public.${t}`);
      expect('error' in d && d.code, `delete ${t}`).toBe('42501');
      const tr = await run({ role: 'authenticated', sub: A }, `truncate public.${t}`);
      expect('error' in tr && tr.code, `truncate ${t}`).toBe('42501');
    }
    const sel = await run({ role: 'authenticated', sub: A }, `select * from public.exchange_rates`);
    expect('error' in sel).toBe(false);
    for (const sql of [
      `insert into public.exchange_rates values ('2026-10-10','evil','TJS','{"USD":1}', now())`,
      `update public.exchange_rates set per_unit = '{}'`,
      `delete from public.exchange_rates`,
    ]) {
      const r = await run({ role: 'authenticated', sub: A }, sql);
      expect('error' in r && r.code, sql).toBe('42501');
    }
  });

  test('схема private закрыта: счётчик, журнал меток и функции недоступны ни anon, ни authenticated', async () => {
    for (const who of [{ role: 'anon' }, { role: 'authenticated', sub: A }] as Who[]) {
      for (const sql of [
        `select nextval('private.sync_seq')`,
        `select * from private.sync_future_stamps`,
        `select private.sync_guard()`,
        `select private.sync_stamp('${A}', 'wallets', '${WALLET_A}', 'd', now(), now())`,
        `create table private.x (a int)`,
      ]) {
        const r = await run(who, sql);
        expect('error' in r, `${who.role}: ${sql}`).toBe(true);
      }
    }
  });

  test('каталог: у всех таблиц public включена RLS; anon без прав; authenticated без delete/truncate; функций в public нет', async () => {
    const noRls = await db.query<{ relname: string }>(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
    expect(noRls.rows).toEqual([]);
    const privs = await db.query<{ t: string; anon_any: boolean; auth_del: boolean; auth_trunc: boolean }>(`
      select c.relname as t,
        has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger') as anon_any,
        has_table_privilege('authenticated', c.oid, 'delete') as auth_del,
        has_table_privilege('authenticated', c.oid, 'truncate') as auth_trunc
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r'`);
    expect(privs.rows.length).toBe(13); // 9 таблиц синхронизации + курсы валют + подписки, настройки напоминаний, журнал отправленного
    for (const r of privs.rows) expect(r, r.t).toMatchObject({ anon_any: false, auth_del: false, auth_trunc: false });
    // anon не имеет ни одного отдельного права
    const anonAny = await db.query<{ t: string }>(`select c.relname as t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (${['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'].map((p) => `has_table_privilege('anon', c.oid, '${p}')`).join(' or ')})`);
    expect(anonAny.rows).toEqual([]);
    const fns = await db.query<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`);
    expect(fns.rows, 'функции в public доступны через RPC всем ролям').toEqual([]);
    const secdef = await db.query<{ proname: string; cfg: string[] | null }>(`select p.proname, p.proconfig as cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosecdef`);
    for (const f of secdef.rows) expect((f.cfg ?? []).join(','), `SECURITY DEFINER ${f.proname} без search_path`).toMatch(/search_path=("")?$|search_path=""/);
  });

  test('чужие данные: B не читает, не правит и не перезаписывает строки A (в том числе через upsert) и не ссылается на чужие кошельки', async () => {
    const asB: Who = { role: 'authenticated', sub: B };
    const read = await run(asB, `select id from public.wallets`);
    expect('rows' in read && read.rows).toEqual([]);
    const upd = await run(asB, `update public.wallets set name = 'ВЗЛОМ' where id = '${WALLET_A}'`);
    expect('rowCount' in upd && upd.rowCount).toBe(0);
    const ups = await run(asB, `${walletInsert(WALLET_A, 'ВЗЛОМ')} on conflict (id) do update set name = excluded.name, client_updated_at = '2099-01-01', device_id = 'zzz'`);
    expect('error' in ups, 'upsert поверх чужой строки обязан упасть').toBe(true);
    const stillA = await run({ role: 'authenticated', sub: A }, `select name, user_id from public.wallets where id = '${WALLET_A}'`);
    expect('rows' in stillA && stillA.rows).toEqual([{ name: 'Кошелёк A', user_id: A }]);
    // операция B с кошельком A: составной внешний ключ не даёт сослаться на чужой кошелёк
    const tx = await run(asB, `insert into public.transactions (id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, occurred_on, note, base_currency, base_amount_minor)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${NOW}', '${NOW}', 'd', 'expense', '${WALLET_A}', 100, '2026-10-10', '', 'TJS', 100)`);
    expect('error' in tx && tx.code).toBe('23503');
  });

  test('user_id от клиента игнорируется: строка B с user_id = A всё равно принадлежит B', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await commit({ role: 'authenticated', sub: B }, walletInsert(id, 'Свой B', 'user_id=\'' + A + '\''));
    const owner = await db.query<{ user_id: string }>(`select user_id from public.wallets where id = '${id}'`);
    expect(owner.rows).toEqual([{ user_id: B }]);
    const asA = await run({ role: 'authenticated', sub: A }, `select id from public.wallets where id = '${id}'`);
    expect('rows' in asA && asA.rows).toEqual([]);
  });

  test('метка из далёкого будущего зажимается до «сейчас + 5 минут»; id и user_id менять нельзя', async () => {
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await commit({ role: 'authenticated', sub: A }, walletInsert(id, 'Будущее').replace(`'${NOW}', '${NOW}', 'dev'`, `'${NOW}', '2099-12-31T00:00:00Z', 'dev'`));
    const r = await db.query<{ over: boolean }>(`select client_updated_at > now() + interval '6 minutes' as over from public.wallets where id = '${id}'`);
    expect(r.rows).toEqual([{ over: false }]);
    const ch = await run({ role: 'authenticated', sub: A }, `update public.wallets set user_id = '${B}' where id = '${WALLET_A}'`);
    expect('error' in ch, 'смена user_id').toBe(true);
    const ch2 = await run({ role: 'authenticated', sub: A }, `update public.wallets set id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' where id = '${WALLET_A}'`);
    expect('error' in ch2, 'смена id').toBe(true);
  });

  test('настройки: id обязан равняться id пользователя (нельзя занять чужую строку настроек)', async () => {
    const bad = await run({ role: 'authenticated', sub: B }, `insert into public.settings (id, created_at, client_updated_at, device_id, base_currency, locale, week_starts_on)
      values ('${A}', '${NOW}', '${NOW}', 'd', 'TJS', 'ru', 1)`);
    expect('error' in bad).toBe(true);
  });

  test('ограничения: имя кошелька > 80 символов и заметка > 500 символов отвергаются сервером', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const longName = await run(asA, walletInsert('99999999-9999-4999-8999-999999999999', 'я'.repeat(81)));
    expect('error' in longName && longName.code).toBe('23514');
    const note = await run(asA, `insert into public.transactions (id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, occurred_on, note, base_currency, base_amount_minor)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', '${NOW}', '${NOW}', 'd', 'expense', '${WALLET_A}', 100, '2026-10-10', repeat('я', 501), 'TJS', 100)`);
    expect('error' in note && note.code).toBe('23514');
  });

  test('color и icon в wallets/categories ограничены по длине на сервере (клиент режет по 32 символа, сервер должен тоже)', async () => {
    // Вошедший пользователь может отправить в color мегабайты: это раздувает базу и каждую выборку (для 5 друзей — мелкая, но дыра).
    const r = await run({ role: 'authenticated', sub: A }, `${walletInsert('88888888-8888-4888-8888-888888888888', 'Раздутый').replace("'#fff', 'x'", "repeat('c', 1000000), 'x'")} returning length(color) as n`);
    expect('error' in r, 'сервер принял color длиной 1 000 000 символов').toBe(true);
  });

  test('длина color, icon, fx_source: предел принимается (в символах, эмодзи считается за один), на символ больше — отказ 23514 именно по этому ограничению', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const cat = (id: string, color: string, icon: string) =>
      `insert into public.categories (id, created_at, client_updated_at, device_id, name, kind, color, icon, sort_order)
       values ('${id}', '${NOW}', '${NOW}', 'dev', 'Кат', 'expense', '${color}', '${icon}', 0)`;
    const tx = (id: string, fxSource: string) =>
      `insert into public.transactions (id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, occurred_on, note, base_currency, base_amount_minor, fx_rate, fx_source)
       values ('${id}', '${NOW}', '${NOW}', 'dev', 'expense', '${WALLET_A}', 100, '2026-10-10', '', 'TJS', 100, 1, '${fxSource}')`;
    const wallet = (id: string, color: string, icon: string) => walletInsert(id, 'Предел').replace("'#fff', 'x'", `'${color}', '${icon}'`);
    const id = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
    const cases: Array<[string, string, string]> = [
      ['wallets_color_len', wallet(id(1), 'c'.repeat(33), 'x'), wallet(id(2), '😀'.repeat(33), 'x')],
      ['wallets_icon_len', wallet(id(3), '#fff', 'i'.repeat(33)), wallet(id(4), '#fff', '😀'.repeat(33))],
      ['categories_color_len', cat(id(5), 'c'.repeat(33), 'tag'), cat(id(6), '😀'.repeat(33), 'tag')],
      ['categories_icon_len', cat(id(7), '#fff', 'i'.repeat(33)), cat(id(8), '#fff', '😀'.repeat(33))],
      ['transactions_fx_source_len', tx(id(9), 'x'.repeat(17)), tx(id(10), '😀'.repeat(17))],
    ];
    for (const [name, ascii, emoji] of cases) {
      for (const sql of [ascii, emoji]) {
        const r = await run(asA, sql);
        expect('error' in r && r.code, name).toBe('23514');
        expect('error' in r && r.error, name).toContain(name);
      }
    }
    const ok: string[] = [
      wallet(id(11), 'c'.repeat(32), 'i'.repeat(32)),
      wallet(id(12), '😀'.repeat(32), '😀'.repeat(32)),
      cat(id(13), 'c'.repeat(32), 'i'.repeat(32)),
      cat(id(14), '😀'.repeat(32), '😀'.repeat(32)),
      tx(id(15), 'x'.repeat(16)),
      tx(id(16), '😀'.repeat(16)),
      tx(id(17), 'same'),
    ];
    for (const sql of ok) {
      const r = await run(asA, sql);
      expect('error' in r ? r.error : 'ok', sql.replace(/\s+/g, ' ').slice(0, 80)).toBe('ok');
    }
  });
  test('каталог: политик ровно 34 (select / insert / update × 11 своих таблиц + 1 select у курсов), политик на delete и «для всех» нет', async () => {
    const pol = await db.query<{ tablename: string; cmd: string; roles: string }>(`select tablename, cmd, roles::text as roles from pg_policies where schemaname = 'public'`);
    expect(pol.rows).toHaveLength(34);
    for (const t of [...TABLES, 'push_subscriptions', 'reminder_settings']) expect(pol.rows.filter((p) => p.tablename === t).map((p) => p.cmd).sort(), t).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    expect(pol.rows.filter((p) => p.tablename === 'push_log'), 'журнал отправленного: политик нет, доступ только у service_role').toEqual([]);
    expect(pol.rows.filter((p) => p.tablename === 'exchange_rates').map((p) => p.cmd)).toEqual(['SELECT']);
    expect(pol.rows.every((p) => p.roles === '{authenticated}')).toBe(true);
  });

  test('этап 2: долги, бюджеты и регулярные платежи A недоступны B (чтение, правка, upsert), а составные ключи не дают сослаться на чужое', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const asB: Who = { role: 'authenticated', sub: B };
    const DEBT_A = '11111111-0000-4000-8000-000000000001';
    const RULE_A = '11111111-0000-4000-8000-000000000002';
    const BUDGET_A = '11111111-0000-4000-8000-000000000003';
    const debt = (id: string, who = 'Рустам') =>
      `insert into public.debts (id, created_at, client_updated_at, device_id, direction, counterparty, principal_minor, currency, opened_on, note)
       values ('${id}', '${NOW}', '${NOW}', 'dev', 'lent', '${who}', 100000, 'TJS', '2026-09-01', '')`;
    const rule = (id: string, wallet: string, extra = '') =>
      `insert into public.recurring_rules (id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, note, frequency, interval_n, start_on, auto_post ${extra ? ',' + extra.split('=')[0] : ''})
       values ('${id}', '${NOW}', '${NOW}', 'dev', 'expense', '${wallet}', 5000, '', 'monthly', 1, '2026-10-01', 0 ${extra ? ',' + extra.split('=')[1] : ''})`;
    const budget = (id: string) =>
      `insert into public.budgets (id, created_at, client_updated_at, device_id, amount_minor, currency, period) values ('${id}', '${NOW}', '${NOW}', 'dev', 100000, 'TJS', 'month')`;
    await commit(asA, debt(DEBT_A));
    await commit(asA, rule(RULE_A, WALLET_A, `debt_id='${DEBT_A}'`));
    await commit(asA, budget(BUDGET_A));

    for (const t of ['debts', 'budgets', 'recurring_rules']) {
      const seen = await run(asB, `select id from public.${t}`);
      expect('rows' in seen && seen.rows, `B читает ${t}`).toEqual([]);
      const upd = await run(asB, `update public.${t} set client_updated_at = now() where id in ('${DEBT_A}', '${RULE_A}', '${BUDGET_A}')`);
      expect('rowCount' in upd && upd.rowCount, `B правит ${t}`).toBe(0);
    }
    const take = await run(asB, `${debt(DEBT_A, 'ВЗЛОМ')} on conflict (id) do update set counterparty = excluded.counterparty, client_updated_at = '2099-01-01', device_id = 'zzz'`);
    expect('error' in take, 'upsert поверх чужого долга обязан упасть').toBe(true);
    const still = await run(asA, `select counterparty from public.debts where id = '${DEBT_A}'`);
    expect('rows' in still && still.rows).toEqual([{ counterparty: 'Рустам' }]);

    // составные внешние ключи: B не может сослаться на кошелёк, долг и платёж A
    const foreignWallet = await run(asB, rule('22222222-0000-4000-8000-000000000001', WALLET_A));
    expect('error' in foreignWallet && foreignWallet.code, 'платёж B с кошельком A').toBe('23503');
    const txCols = `(id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, occurred_on, note, base_currency, base_amount_minor, debt_id, recurring_rule_id)`;
    const WALLET_B = 'bbbbbbbb-0000-4000-8000-000000000001';
    await commit(asB, walletInsert(WALLET_B, 'Кошелёк B'));
    const tx = (id: string, debtId: string | null, ruleId: string | null) =>
      `insert into public.transactions ${txCols} values ('${id}', '${NOW}', '${NOW}', 'd', 'expense', '${WALLET_B}', 100, '2026-10-10', '', 'TJS', 100, ${debtId ? `'${debtId}'` : 'null'}, ${ruleId ? `'${ruleId}'` : 'null'})`;
    const withDebt = await run(asB, tx('22222222-0000-4000-8000-000000000002', DEBT_A, null));
    expect('error' in withDebt && withDebt.code, 'операция B с долгом A').toBe('23503');
    const withRule = await run(asB, tx('22222222-0000-4000-8000-000000000003', null, RULE_A));
    expect('error' in withRule && withRule.code, 'операция B с платежом A').toBe('23503');
    const budgetCat = await run(asB, `insert into public.budgets (id, created_at, client_updated_at, device_id, category_id, amount_minor, currency, period)
      values ('22222222-0000-4000-8000-000000000004', '${NOW}', '${NOW}', 'd', '99999999-0000-4000-8000-000000000009', 100, 'TJS', 'month')`);
    expect('error' in budgetCat && budgetCat.code, 'бюджет с несуществующей категорией').toBe('23503');
    // свой долг и своя операция с долгом — можно
    await commit(asB, debt('22222222-0000-4000-8000-000000000005', 'Свой'));
    const own = await run(asB, tx('22222222-0000-4000-8000-000000000006', '22222222-0000-4000-8000-000000000005', null));
    expect('error' in own ? own.error : 'ok').toBe('ok');
  });

  test('список покупок: чужие позиции недоступны (чтение, правка, upsert), ограничения отвергаются по имени, купленная и корзина принимаются', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const asB: Who = { role: 'authenticated', sub: B };
    const id = (n: number) => `44444444-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const cols = `(id, created_at, client_updated_at, device_id, name, qty_milli, unit, price_minor, checked_at, purchased_at, transaction_id)`;
    const item = (n: number, o: { name?: string; qty?: number; unit?: string; price?: number | null; checked?: boolean; bought?: boolean; tx?: boolean } = {}) =>
      `insert into public.shopping_items ${cols} values ('${id(n)}', '${NOW}', '${NOW}', 'd', '${o.name ?? 'Молоко'}', ${o.qty ?? 2000}, '${o.unit ?? 'l'}', ${o.price === undefined ? 'null' : o.price}, ${o.checked ? `'${NOW}'` : 'null'}, ${o.bought ? `'${NOW}'` : 'null'}, ${o.tx ? `'${id(900)}'` : 'null'})`;
    await commit(asA, item(1));
    const seen = await run(asB, `select id from public.shopping_items`);
    expect('rows' in seen && seen.rows, 'B читает покупки A').toEqual([]);
    const upd = await run(asB, `update public.shopping_items set client_updated_at = now() where id = '${id(1)}'`);
    expect('rowCount' in upd && upd.rowCount, 'B правит покупки A').toBe(0);
    const take = await run(asB, `${item(1, { name: 'ВЗЛОМ' })} on conflict (id) do update set name = excluded.name, client_updated_at = '2099-01-01', device_id = 'zzz'`);
    expect('error' in take, 'upsert поверх чужой позиции обязан упасть').toBe(true);
    const still = await run(asA, `select name from public.shopping_items where id = '${id(1)}'`);
    expect('rows' in still && still.rows).toEqual([{ name: 'Молоко' }]);
    const del = await run(asA, `delete from public.shopping_items where id = '${id(1)}'`);
    expect('error' in del, 'удалять позиции нельзя никому').toBe(true);

    const cases: Array<[string, string]> = [
      ['shopping_items_name_len', item(2, { name: '' })],
      ['shopping_items_name_len', item(3, { name: 'я'.repeat(81) })],
      ['shopping_items_qty', item(4, { qty: 0 })],
      ['shopping_items_qty', item(5, { qty: 1_000_000_001 })],
      ['shopping_items_unit', item(6, { unit: 'kgs' })],
      ['shopping_items_price', item(7, { price: -1, checked: true })],
      ['shopping_items_price', item(8, { price: 1_000_000_000_000_001, checked: true })],
      ['shopping_items_state_shape', item(9, { price: 100 })], // цена без отметки
      ['shopping_items_state_shape', item(10, { checked: true })], // отметка без цены
      ['shopping_items_purchase_shape', item(11, { price: 100, checked: true, bought: true })], // куплена без чека
      ['shopping_items_purchase_shape', item(12, { price: 100, checked: true, tx: true })], // чек без покупки
    ];
    for (const [name, sql] of cases) {
      const r = await run(asA, sql);
      expect('error' in r && r.code, name).toBe('23514');
      expect('error' in r && r.error, name).toContain(name);
    }
    for (const [n, o] of [
      [20, { price: 0, checked: true }],
      [21, { name: 'Хлеб', qty: 3000, unit: 'pcs' }],
      [22, { qty: 1_000_000_000, price: 1_000_000_000_000_000, checked: true, bought: true, tx: true }],
    ] as const) {
      const r = await run(asA, item(n, o));
      expect('error' in r ? r.error : 'ok', `позиция ${n}`).toBe('ok');
    }
  });

  test('цели накопления: чужие цели недоступны, ограничения отвергаются по имени, чужой кошелёк нельзя привязать', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const asB: Who = { role: 'authenticated', sub: B };
    const id = (n: number) => `55555555-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const WALLET_B = id(800);
    await commit(asB, walletInsert(WALLET_B, 'Копилка B'));
    const cols = `(id, created_at, client_updated_at, device_id, name, target_minor, currency, due_on, wallet_id, archived_at)`;
    const goal = (n: number, o: { name?: string; target?: number; currency?: string; due?: string; wallet?: string | null; archived?: string } = {}) =>
      `insert into public.savings_goals ${cols} values ('${id(n)}', '${NOW}', '${NOW}', 'd', '${o.name ?? 'Отпуск'}', ${o.target ?? 500000}, '${o.currency ?? 'TJS'}', '${o.due ?? '2026-12-31'}', ${o.wallet === undefined || o.wallet === null ? 'null' : `'${o.wallet}'`}, ${o.archived ? `'${o.archived}'` : 'null'})`;
    await commit(asA, goal(1));
    const seen = await run(asB, `select id from public.savings_goals`);
    expect('rows' in seen && seen.rows, 'B читает цели A').toEqual([]);
    const upd = await run(asB, `update public.savings_goals set client_updated_at = now() where id = '${id(1)}'`);
    expect('rowCount' in upd && upd.rowCount, 'B правит цели A').toBe(0);
    const take = await run(asB, `${goal(1, { name: 'ВЗЛОМ' })} on conflict (id) do update set name = excluded.name, client_updated_at = '2099-01-01', device_id = 'zzz'`);
    expect('error' in take, 'upsert поверх чужой цели обязан упасть').toBe(true);
    const still = await run(asA, `select name from public.savings_goals where id = '${id(1)}'`);
    expect('rows' in still && still.rows).toEqual([{ name: 'Отпуск' }]);
    const del = await run(asA, `delete from public.savings_goals where id = '${id(1)}'`);
    expect('error' in del, 'удалять цели нельзя никому').toBe(true);
    const anon = await run({ role: 'anon' }, `select id from public.savings_goals`);
    expect('error' in anon && anon.code, 'anon читает цели').toBe('42501');

    const cases: Array<[string, string]> = [
      ['savings_goals_name_len', goal(2, { name: '' })],
      ['savings_goals_name_len', goal(3, { name: 'я'.repeat(61) })],
      ['savings_goals_name_len', goal(4, { name: '😀'.repeat(61) })],
      ['savings_goals_target', goal(5, { target: 0 })],
      ['savings_goals_target', goal(6, { target: -1 })],
      ['savings_goals_target', goal(7, { target: 1_000_000_000_000_001 })],
      ['savings_goals_currency_fmt', goal(8, { currency: 'tjs' })],
      ['savings_goals_due_on', goal(9, { due: '1999-12-31' })],
      ['savings_goals_due_on', goal(10, { due: '2100-01-02' })],
      ['savings_goals_ts_sane', goal(11, { archived: '1990-01-01T00:00:00Z' })],
    ];
    for (const [name, sql] of cases) {
      const r = await run(asA, sql);
      expect('error' in r && r.code, name).toBe('23514');
      expect('error' in r && r.error, name).toContain(name);
    }
    // кошелёк другого пользователя и несуществующий: нарушение составного внешнего ключа
    for (const [n, wallet] of [[12, WALLET_B], [13, id(999)]] as const) {
      const r = await run(asA, goal(n, { wallet }));
      expect('error' in r && r.code, `кошелёк ${wallet}`).toBe('23503');
      expect('error' in r && r.error).toContain('savings_goals_wallet_fk');
    }
    // свой кошелёк, границы и пустая ссылка — можно
    await commit(asA, walletInsert(id(801), 'Копилка A'));
    for (const [n, o] of [
      [20, { wallet: id(801) }],
      [21, { name: 'я'.repeat(60), target: 1, due: '2000-01-01' }],
      [22, { name: '😀'.repeat(60), target: 1_000_000_000_000_000, due: '2100-01-01', archived: NOW }],
    ] as const) {
      const r = await run(asA, goal(n, o));
      expect('error' in r ? r.error : 'ok', `цель ${n}`).toBe('ok');
    }
  });

  test('«обязательная» категория и категория долга: значения по умолчанию, границы отвергаются по имени', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const id = (n: number) => `66666666-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const cat = (n: number, extra = '') =>
      `insert into public.categories (id, created_at, client_updated_at, device_id, name, kind, color, icon, sort_order ${extra ? ',' + extra.split('=')[0] : ''})
       values ('${id(n)}', '${NOW}', '${NOW}', 'd', 'Аренда', 'expense', '#fff', 'x', 0 ${extra ? ',' + extra.split('=')[1] : ''})`;
    const debt = (n: number, category?: string) =>
      `insert into public.debts (id, created_at, client_updated_at, device_id, direction, counterparty, principal_minor, currency, opened_on, note ${category === undefined ? '' : ', category'})
       values ('${id(n)}', '${NOW}', '${NOW}', 'd', 'lent', 'Имя', 1, 'TJS', '2026-09-01', '' ${category === undefined ? '' : `, '${category}'`})`;
    // без колонки (старое приложение) — значения по умолчанию
    await commit(asA, cat(1));
    await commit(asA, debt(2));
    const defaults = await db.query<{ essential: string | number; category: string }>(
      `select (select essential from public.categories where id = '${id(1)}') as essential, (select category from public.debts where id = '${id(2)}') as category`,
    );
    expect(defaults.rows[0]).toEqual({ essential: 0, category: '' });
    for (const [name, sql] of [
      ['categories_essential', cat(3, 'essential=2')],
      ['categories_essential', cat(4, 'essential=-1')],
      ['debts_category_len', debt(5, 'я'.repeat(41))],
      ['debts_category_len', debt(6, '😀'.repeat(41))],
    ] as const) {
      const r = await run(asA, sql);
      expect('error' in r && r.code, name).toBe('23514');
      expect('error' in r && r.error, name).toContain(name);
    }
    for (const [n, sql] of [
      [7, cat(7, 'essential=1')],
      [8, cat(8, 'essential=0')],
      [9, debt(9, 'я'.repeat(40))],
      [10, debt(10, '😀'.repeat(40))],
    ] as const) {
      const r = await run(asA, sql);
      expect('error' in r ? r.error : 'ok', `запись ${n}`).toBe('ok');
    }
    // пустое (NULL) значение колонок отвергается: они not null
    const nullEssential = await run(asA, cat(11, 'essential=null'));
    expect('error' in nullEssential && nullEssential.code, 'essential = null').toBe('23502');
  });

  test('этап 2: ограничения долгов, бюджетов и платежей отвергаются по имени; комиссия перевода принимается', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const id = (n: number) => `33333333-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const WALLET_A2 = id(900);
    await commit(asA, walletInsert(WALLET_A2, 'Второй A'));
    const cases: Array<[string, string]> = [
      ['debts_counterparty_len', `insert into public.debts (id, created_at, client_updated_at, device_id, direction, counterparty, principal_minor, currency, opened_on, note) values ('${id(1)}', '${NOW}', '${NOW}', 'd', 'lent', '', 1, 'TJS', '2026-09-01', '')`],
      ['debts_direction', `insert into public.debts (id, created_at, client_updated_at, device_id, direction, counterparty, principal_minor, currency, opened_on, note) values ('${id(2)}', '${NOW}', '${NOW}', 'd', 'gift', 'Имя', 1, 'TJS', '2026-09-01', '')`],
      ['debts_principal', `insert into public.debts (id, created_at, client_updated_at, device_id, direction, counterparty, principal_minor, currency, opened_on, note) values ('${id(3)}', '${NOW}', '${NOW}', 'd', 'lent', 'Имя', 0, 'TJS', '2026-09-01', '')`],
      ['debts_due_on', `insert into public.debts (id, created_at, client_updated_at, device_id, direction, counterparty, principal_minor, currency, opened_on, due_on, note) values ('${id(4)}', '${NOW}', '${NOW}', 'd', 'lent', 'Имя', 1, 'TJS', '2026-09-01', '2100-01-02', '')`],
      ['budgets_amount', `insert into public.budgets (id, created_at, client_updated_at, device_id, amount_minor, currency, period) values ('${id(5)}', '${NOW}', '${NOW}', 'd', 0, 'TJS', 'month')`],
      ['budgets_period', `insert into public.budgets (id, created_at, client_updated_at, device_id, amount_minor, currency, period) values ('${id(6)}', '${NOW}', '${NOW}', 'd', 1, 'TJS', 'week')`],
      ['recurring_rules_interval_n', `insert into public.recurring_rules (id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, note, frequency, interval_n, start_on, auto_post) values ('${id(7)}', '${NOW}', '${NOW}', 'd', 'expense', '${WALLET_A}', 1, '', 'monthly', 0, '2026-10-01', 0)`],
      ['recurring_rules_end_on', `insert into public.recurring_rules (id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, note, frequency, interval_n, start_on, end_on, auto_post) values ('${id(8)}', '${NOW}', '${NOW}', 'd', 'expense', '${WALLET_A}', 1, '', 'monthly', 1, '2026-10-01', '2026-09-30', 0)`],
      ['recurring_rules_transfer_shape', `insert into public.recurring_rules (id, created_at, client_updated_at, device_id, kind, wallet_id, to_wallet_id, to_amount_minor, amount_minor, note, frequency, interval_n, start_on, auto_post) values ('${id(9)}', '${NOW}', '${NOW}', 'd', 'transfer', '${WALLET_A}', '${WALLET_A}', 1, 1, '', 'monthly', 1, '2026-10-01', 0)`],
      ['recurring_rules_plain_shape', `insert into public.recurring_rules (id, created_at, client_updated_at, device_id, kind, wallet_id, to_amount_minor, amount_minor, note, frequency, interval_n, start_on, auto_post) values ('${id(10)}', '${NOW}', '${NOW}', 'd', 'expense', '${WALLET_A}', 5, 1, '', 'monthly', 1, '2026-10-01', 0)`],
      ['recurring_rules_auto_post', `insert into public.recurring_rules (id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, note, frequency, interval_n, start_on, auto_post) values ('${id(11)}', '${NOW}', '${NOW}', 'd', 'expense', '${WALLET_A}', 1, '', 'monthly', 1, '2026-10-01', 2)`],
      ['transactions_transfer_shape', `insert into public.transactions (id, created_at, client_updated_at, device_id, kind, wallet_id, to_wallet_id, amount_minor, to_amount_minor, occurred_on, note, base_currency, base_amount_minor) values ('${id(12)}', '${NOW}', '${NOW}', 'd', 'transfer', '${WALLET_A}', '${WALLET_A}', 1, 1, '2026-10-10', '', 'TJS', 0)`],
    ];
    for (const [name, sql] of cases) {
      const r = await run(asA, sql);
      expect('error' in r && r.code, name).toBe('23514');
      expect('error' in r && r.error, name).toContain(name);
    }
    // перевод с долгом: нельзя (transactions_debt_shape)
    const DEBT_OWN = id(20);
    await commit(asA, `insert into public.debts (id, created_at, client_updated_at, device_id, direction, counterparty, principal_minor, currency, opened_on, note) values ('${DEBT_OWN}', '${NOW}', '${NOW}', 'd', 'lent', 'Свой', 1, 'TJS', '2026-09-01', '')`);
    const transferCols = `(id, created_at, client_updated_at, device_id, kind, wallet_id, to_wallet_id, amount_minor, to_amount_minor, occurred_on, note, base_currency, base_amount_minor, debt_id)`;
    const transfer = (n: number, fee: number, debt: string | null) =>
      `insert into public.transactions ${transferCols} values ('${id(n)}', '${NOW}', '${NOW}', 'd', 'transfer', '${WALLET_A}', '${WALLET_A2}', 1000, 990, '2026-10-10', '', 'TJS', ${fee}, ${debt ? `'${debt}'` : 'null'})`;
    const withDebt = await run(asA, transfer(21, 0, DEBT_OWN));
    expect('error' in withDebt && withDebt.error, 'перевод с долгом').toContain('transactions_debt_shape');
    // комиссия перевода (base_amount_minor) — от 0 до 1e15; за пределами нельзя
    const ok0 = await run(asA, transfer(22, 0, null));
    const okFee = await run(asA, transfer(23, 10, null));
    const okMax = await run(asA, transfer(24, 1_000_000_000_000_000, null));
    for (const r of [ok0, okFee, okMax]) expect('error' in r ? r.error : 'ok').toBe('ok');
    const neg = await run(asA, transfer(25, -1, null));
    expect('error' in neg && neg.error, 'отрицательная комиссия').toContain('transactions_base_amount');
    const over = await run(asA, transfer(26, 1_000_000_000_000_001, null));
    expect('error' in over && over.error, 'комиссия больше предела').toContain('transactions_base_amount');
  });

  /* -------------------------------------------------------------------------------------------
   * Этап 3: напоминания (раздел 9). Эти таблицы пишет приложение (authenticated, только свои строки), а читает и чистит серверная
   * функция send-reminders (service_role). Журнал push_log — только для функции.
   * ----------------------------------------------------------------------------------------- */

  const PUSH_TABLES = ['push_subscriptions', 'reminder_settings', 'push_log'] as const;
  const EP = (n: number | string) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
  const P256 = 'p'.repeat(87);
  const AUTH_KEY = 'a'.repeat(22);
  const SUB_A = '51000000-0000-4000-8000-00000000000a';
  const SUB_B = '51000000-0000-4000-8000-00000000000b';

  type SubCols = Partial<Record<'id' | 'user_id' | 'device_id' | 'endpoint' | 'p256dh' | 'auth_secret' | 'user_agent', string>>;
  const subInsert = (o: SubCols = {}, tail = '') => {
    const row: Record<string, string> = { device_id: 'dev-1', endpoint: EP('x'), p256dh: P256, auth_secret: AUTH_KEY, ...o };
    const cols = Object.keys(row);
    return `insert into public.push_subscriptions (${cols.join(', ')}) values (${cols.map((c) => `'${row[c]}'`).join(', ')})${tail}`;
  };
  const settingsInsert = (cols: Record<string, string | number | boolean> = {}, tail = '') => {
    const keys = Object.keys(cols);
    return keys.length === 0
      ? `insert into public.reminder_settings default values${tail}`
      : `insert into public.reminder_settings (${keys.join(', ')}) values (${keys.map((k) => (typeof cols[k] === 'string' ? `'${cols[k]}'` : String(cols[k]))).join(', ')})${tail}`;
  };
  const asService: Who = { role: 'service_role' };
  const sqlState = (r: { error: string; code: string } | { rows: unknown[] }): string => ('error' in r ? r.code : 'ok');
  /** Начальные строки (по одной подписке и настройке у A и B); повторный вызов ничего не меняет. Нужны тестам, чтобы не зависеть от порядка. */
  const seedPush = async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const asB: Who = { role: 'authenticated', sub: B };
    await commit(asA, subInsert({ id: SUB_A, endpoint: EP('a-phone'), device_id: 'phone-a' }, ' on conflict do nothing'));
    await commit(asB, subInsert({ id: SUB_B, endpoint: EP('b-phone'), device_id: 'phone-b' }, ' on conflict do nothing'));
    await commit(asA, settingsInsert({ enabled: true, hour_local: 7, timezone: 'Asia/Dushanbe', show_details: true }, ' on conflict do nothing'));
    await commit(asB, settingsInsert({ enabled: false, hour_local: 22 }, ' on conflict do nothing'));
  };

  test('напоминания: подписки A недоступны B — чтение, правка, перехват через upsert, вставка и перенос на чужой user_id', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const asB: Who = { role: 'authenticated', sub: B };
    await commit(asA, subInsert({ id: SUB_A, endpoint: EP('a-phone'), device_id: 'phone-a' }));
    // user_id по умолчанию = auth.uid(): клиент его не присылает
    const owner = await db.query<{ user_id: string }>(`select user_id from public.push_subscriptions where id = '${SUB_A}'`);
    expect(owner.rows).toEqual([{ user_id: A }]);

    const seen = await run(asB, `select id from public.push_subscriptions`);
    expect('rows' in seen && seen.rows, 'B читает подписки A').toEqual([]);
    const upd = await run(asB, `update public.push_subscriptions set revoked_at = now(), p256dh = 'взлом' where id = '${SUB_A}'`);
    expect('rowCount' in upd && upd.rowCount, 'B правит подписку A').toBe(0);
    // вставка с чужим user_id и перехват строки через upsert по id и по (user_id, endpoint)
    const foreign = await run(asB, subInsert({ id: SUB_B, user_id: A, endpoint: EP('b-forged') }));
    expect('error' in foreign && foreign.code, 'вставка B с user_id = A').toBe('42501');
    const takeId = await run(asB, subInsert({ id: SUB_A, endpoint: EP('a-phone') }, ` on conflict (id) do update set endpoint = excluded.endpoint, revoked_at = now()`));
    expect('error' in takeId, 'перехват чужой строки по id').toBe(true);
    const takeKey = await run(asB, subInsert({ user_id: A, endpoint: EP('a-phone') }, ` on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh`));
    expect('error' in takeKey && takeKey.code, 'перехват по (user_id, endpoint) с user_id = A').toBe('42501');
    // перенос своей строки на чужого пользователя и смена чужой
    await commit(asB, subInsert({ id: SUB_B, endpoint: EP('b-phone'), device_id: 'phone-b' }));
    const move = await run(asB, `update public.push_subscriptions set user_id = '${A}' where id = '${SUB_B}'`);
    expect('error' in move && move.code, 'перенос своей подписки на A').toBe('42501');
    // тот же адрес у B — его собственная строка, строка A не затронута
    const rows = await db.query<{ id: string; user_id: string; p256dh: string; revoked_at: string | null }>(`select id, user_id, p256dh, revoked_at from public.push_subscriptions where id in ('${SUB_A}', '${SUB_B}') order by id`);
    expect(rows.rows).toEqual([
      { id: SUB_A, user_id: A, p256dh: P256, revoked_at: null },
      { id: SUB_B, user_id: B, p256dh: P256, revoked_at: null },
    ]);
  });

  test('напоминания: настройки A недоступны B — чтение, правка, upsert, вставка с чужим user_id; свои создаются сами', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const asB: Who = { role: 'authenticated', sub: B };
    await commit(asA, settingsInsert({ enabled: true, hour_local: 7, timezone: 'Asia/Dushanbe', show_details: true }));
    const mine = await db.query(`select user_id, enabled, hour_local, show_details, remind_payments, remind_debts, remind_daily from public.reminder_settings where user_id = '${A}'`);
    expect(mine.rows).toEqual([{ user_id: A, enabled: true, hour_local: 7, show_details: true, remind_payments: true, remind_debts: true, remind_daily: false }]);

    const seen = await run(asB, `select * from public.reminder_settings`);
    expect('rows' in seen && seen.rows, 'B читает настройки A').toEqual([]);
    const upd = await run(asB, `update public.reminder_settings set enabled = false, hour_local = 1 where user_id = '${A}'`);
    expect('rowCount' in upd && upd.rowCount, 'B правит настройки A').toBe(0);
    const foreign = await run(asB, settingsInsert({ user_id: `${A}`, enabled: true }));
    expect('error' in foreign && foreign.code, 'вставка B с user_id = A').toBe('42501');
    const take = await run(asB, settingsInsert({ user_id: `${A}`, enabled: false }, ` on conflict (user_id) do update set enabled = excluded.enabled, hour_local = 0`));
    expect('error' in take && take.code, 'перехват настроек A через upsert').toBe('42501');
    // свои настройки B: user_id подставляется сервером; повторный upsert по user_id обновляет свою строку
    await commit(asB, settingsInsert({ enabled: true, hour_local: 21 }));
    await commit(asB, settingsInsert({ enabled: false, hour_local: 22 }, ` on conflict (user_id) do update set enabled = excluded.enabled, hour_local = excluded.hour_local`));
    const bRows = await db.query(`select user_id, enabled, hour_local from public.reminder_settings where user_id = '${B}'`);
    expect(bRows.rows).toEqual([{ user_id: B, enabled: false, hour_local: 22 }]);
    const move = await run(asB, `update public.reminder_settings set user_id = '${A}' where user_id = '${B}'`);
    expect('error' in move && move.code, 'перенос своих настроек на A').toBe('42501');
    const still = await db.query(`select user_id, enabled, hour_local from public.reminder_settings where user_id = '${A}'`);
    expect(still.rows).toEqual([{ user_id: A, enabled: true, hour_local: 7 }]);
  });

  test('напоминания: DELETE и TRUNCATE у authenticated невозможны на всех трёх таблицах; anon не может ничего', async () => {
    await seedPush();
    for (const t of PUSH_TABLES) {
      for (const sql of [`delete from public.${t}`, `truncate public.${t}`]) {
        const r = await run({ role: 'authenticated', sub: A }, sql);
        expect('error' in r && r.code, `authenticated: ${sql}`).toBe('42501');
      }
      for (const sql of [`select * from public.${t}`, `delete from public.${t}`, `truncate public.${t}`]) {
        const r = await run({ role: 'anon' }, sql);
        expect('error' in r && r.code, `anon: ${sql}`).toBe('42501');
      }
    }
    const anonIns = await run({ role: 'anon' }, subInsert({ endpoint: EP('anon') }));
    expect('error' in anonIns && anonIns.code, 'anon вставляет подписку').toBe('42501');
    const anonSet = await run({ role: 'anon' }, settingsInsert({ enabled: true }));
    expect('error' in anonSet && anonSet.code, 'anon вставляет настройки').toBe('42501');
    // подписки и настройки уцелели после всех попыток
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.push_subscriptions where id in ('${SUB_A}', '${SUB_B}')`);
    expect(left.rows).toEqual([{ n: 2 }]);
  });

  test('напоминания: журнал push_log недоступен ни anon, ни authenticated (ни одно из четырёх действий), а service_role работает', async () => {
    const REF = 'r'.repeat(60);
    for (const who of [{ role: 'anon' }, { role: 'authenticated', sub: A }] as Who[]) {
      for (const sql of [
        `select * from public.push_log`,
        `insert into public.push_log (user_id, kind, ref, sent_on) values ('${A}', 'daily', 'day', '2026-10-10')`,
        `update public.push_log set ref = 'x'`,
        `delete from public.push_log`,
        `select count(*) from public.push_log`,
      ]) {
        const r = await run(who, sql);
        expect('error' in r && r.code, `${who.role}: ${sql}`).toBe('42501');
      }
    }
    // функция (service_role): запись, повтор без ошибки, чтение, чистка
    const ins = (kind: string, ref: string, day: string) => `insert into public.push_log (user_id, kind, ref, sent_on) values ('${A}', '${kind}', '${ref}', '${day}') on conflict (user_id, kind, ref, sent_on) do nothing returning ref`;
    await commit(asService, ins('payment', REF, '2026-10-10'));
    const dup = await run(asService, ins('payment', REF, '2026-10-10'));
    expect('rows' in dup && dup.rows, 'повтор того же дня не создаёт строку и возвращает пусто').toEqual([]);
    const nextDay = await run(asService, ins('payment', REF, '2026-10-11'));
    expect('rows' in nextDay && nextDay.rows, 'на следующий день та же запись — новая').toEqual([{ ref: REF }]);
    const otherKind = await run(asService, ins('debt', REF, '2026-10-10'));
    expect('rows' in otherKind && otherKind.rows).toEqual([{ ref: REF }]);
    const read = await run(asService, `select user_id, kind, to_char(sent_on, 'YYYY-MM-DD') as sent_on, created_at is not null as stamped from public.push_log`);
    expect('rows' in read && read.rows).toEqual([{ user_id: A, kind: 'payment', sent_on: '2026-10-10', stamped: true }]);
    const del = await run(asService, `delete from public.push_log where sent_on < '2026-10-11'`);
    expect('rowCount' in del && del.rowCount).toBe(1);
    await commit(asService, `delete from public.push_log`);
  });

  test('напоминания: служебная функция (service_role) читает подписки и настройки всех и отзывает подписку; в таблицах чужих пользователей не путается', async () => {
    await seedPush();
    const rows = await run(asService, `select user_id, endpoint from public.push_subscriptions where revoked_at is null order by endpoint`);
    expect('rows' in rows && rows.rows.map((r) => r.user_id).sort()).toEqual([A, B]);
    const revoke = await run(asService, `update public.push_subscriptions set revoked_at = now() where id = '${SUB_A}' and revoked_at is null returning id`);
    expect('rows' in revoke && revoke.rows).toEqual([{ id: SUB_A }]);
    const on = await run(asService, `select user_id from public.reminder_settings where enabled = true`);
    expect('rows' in on && on.rows).toEqual([{ user_id: A }]);
  });

  test('напоминания: ограничения подписок отвергаются по имени (23514), границы принимаются; повтор адреса — 23505', async () => {
    await seedPush();
    const asA: Who = { role: 'authenticated', sub: A };
    const bad: Array<[string, SubCols]> = [
      ['push_subscriptions_endpoint_fmt', { endpoint: 'http://fcm.googleapis.com/fcm/send/x' }],
      ['push_subscriptions_endpoint_fmt', { endpoint: 'HTTPS://fcm.googleapis.com/fcm/send/x' }],
      ['push_subscriptions_endpoint_fmt', { endpoint: 'javascript:alert(1)//https://x' }],
      ['push_subscriptions_endpoint_fmt', { endpoint: 'https://' }],
      ['push_subscriptions_endpoint_fmt', { endpoint: `https://${'e'.repeat(2041)}` }],
      ['push_subscriptions_keys_len', { p256dh: 'p'.repeat(19) }],
      ['push_subscriptions_keys_len', { p256dh: 'p'.repeat(201) }],
      ['push_subscriptions_keys_len', { auth_secret: 'a'.repeat(7) }],
      ['push_subscriptions_keys_len', { auth_secret: 'a'.repeat(101) }],
      ['push_subscriptions_device_len', { device_id: '' }],
      ['push_subscriptions_device_len', { device_id: 'd'.repeat(65) }],
      ['push_subscriptions_ua_len', { user_agent: 'u'.repeat(301) }],
      ['push_subscriptions_ua_len', { user_agent: '😀'.repeat(301) }],
    ];
    for (const [name, cols] of bad) {
      const r = await run(asA, subInsert({ endpoint: EP('bad'), ...cols }));
      expect('error' in r && r.code, `${name} ${JSON.stringify(cols).slice(0, 50)}`).toBe('23514');
      expect('error' in r && r.error, name).toContain(name);
    }
    const ok: SubCols[] = [
      { endpoint: `https://${'e'.repeat(2040)}` }, // ровно 2048 знаков
      { endpoint: 'https://a.b' + 'c' }, // ровно 12 знаков
      { p256dh: 'p'.repeat(20), auth_secret: 'a'.repeat(8) },
      { p256dh: 'p'.repeat(200), auth_secret: 'a'.repeat(100) },
      { device_id: 'd' },
      { device_id: 'д'.repeat(64) },
      { user_agent: '' },
      { user_agent: '😀'.repeat(300) },
    ];
    for (const [i, cols] of ok.entries()) {
      const r = await run(asA, subInsert({ endpoint: EP(`ok-${i}`), ...cols }));
      expect(sqlState(r), JSON.stringify(cols).slice(0, 60)).toBe('ok');
    }
    // один и тот же адрес у одного человека — одна строка
    const dup = await run(asA, subInsert({ endpoint: EP('a-phone') }));
    expect('error' in dup && dup.code).toBe('23505');
    expect('error' in dup && dup.error).toContain('push_subscriptions_user_endpoint_key');
  });

  test('напоминания: ограничения настроек (час 0–23, длина часового пояса) и журнала (вид, длина ссылки) отвергаются по имени', async () => {
    await seedPush();
    const asB: Who = { role: 'authenticated', sub: B };
    const cases: Array<[string, Record<string, string | number | boolean>]> = [
      ['reminder_settings_hour', { hour_local: -1 }],
      ['reminder_settings_hour', { hour_local: 24 }],
      ['reminder_settings_hour', { hour_local: 99 }],
      ['reminder_settings_tz_len', { timezone: '' }],
      ['reminder_settings_tz_len', { timezone: 'z'.repeat(65) }],
      ['reminder_settings_tz_len', { timezone: '😀'.repeat(65) }],
    ];
    for (const [name, cols] of cases) {
      // user_id не передаём — берётся из входа; строка B есть (seedPush), поэтому бьём по upsert со своей же строкой
      const r = await run(asB, settingsInsert(cols, ` on conflict (user_id) do update set ${Object.keys(cols).map((k) => `${k} = excluded.${k}`).join(', ')}`));
      expect('error' in r && r.code, `${name} ${JSON.stringify(cols).slice(0, 40)}`).toBe('23514');
      expect('error' in r && r.error, name).toContain(name);
    }
    const goodCases: Array<Record<string, string | number | boolean>> = [{ hour_local: 0 }, { hour_local: 23 }, { timezone: 'z' }, { timezone: 'я'.repeat(64) }, { timezone: '😀'.repeat(64) }];
    for (const cols of goodCases) {
      const r = await run(asB, settingsInsert(cols, ` on conflict (user_id) do update set ${Object.keys(cols).map((k) => `${k} = excluded.${k}`).join(', ')}`));
      expect(sqlState(r), JSON.stringify(cols).slice(0, 40)).toBe('ok');
    }
    const junk = await run(asB, settingsInsert({ hour_local: 'девять' }, ` on conflict (user_id) do update set hour_local = excluded.hour_local`));
    expect('error' in junk && junk.code, 'час — не число').toBe('22P02');
    const flag = await run(asB, settingsInsert({ enabled: 'maybe' }, ` on conflict (user_id) do update set enabled = excluded.enabled`));
    expect('error' in flag && flag.code, 'флаг — не boolean').toBe('22P02');

    const log = (kind: string, ref: string) => `insert into public.push_log (user_id, kind, ref, sent_on) values ('${A}', '${kind}', '${ref}', '2026-10-10')`;
    const k = await run(asService, log('weekly', 'x'));
    expect('error' in k && k.code).toBe('23514');
    expect('error' in k && k.error).toContain('push_log_kind');
    const long = await run(asService, log('payment', 'r'.repeat(201)));
    expect('error' in long && long.error).toContain('push_log_ref_len');
    expect(sqlState(await run(asService, log('payment', 'r'.repeat(200))))).toBe('ok');
    expect(sqlState(await run(asService, log('payment', '😀'.repeat(200))))).toBe('ok');
    const ghost = await run(asService, `insert into public.push_log (user_id, kind, ref, sent_on) values ('99999999-9999-4999-8999-999999999999', 'daily', 'day', '2026-10-10')`);
    expect('error' in ghost && ghost.code, 'журнал несуществующего пользователя').toBe('23503');
  });

  test('напоминания: свою подписку можно отозвать (revoked_at); повторное подключение той же подписки через upsert снимает отзыв и обновляет ключи', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const asB: Who = { role: 'authenticated', sub: B };
    const ENDPOINT = EP('re-subscribe');
    await commit(asA, subInsert({ endpoint: ENDPOINT, device_id: 'phone-a' }));
    const before = await db.query<{ id: string }>(`select id from public.push_subscriptions where user_id = '${A}' and endpoint = '${ENDPOINT}'`);
    expect(before.rows).toHaveLength(1);
    const id = before.rows[0]!.id;

    const revoke = await run(asA, `update public.push_subscriptions set revoked_at = now() where user_id = '${A}' and endpoint = '${ENDPOINT}'`);
    expect('rowCount' in revoke && revoke.rowCount, 'A отзывает свою подписку').toBe(1);
    await commit(asA, `update public.push_subscriptions set revoked_at = now() where endpoint = '${ENDPOINT}'`);
    const foreignRevoke = await run(asB, `update public.push_subscriptions set revoked_at = null where endpoint = '${ENDPOINT}'`);
    expect('rowCount' in foreignRevoke && foreignRevoke.rowCount, 'B снимает отзыв с подписки A').toBe(0);
    const active = await db.query(`select id from public.push_subscriptions where endpoint = '${ENDPOINT}' and revoked_at is null`);
    expect(active.rows, 'отозванная подписка не считается действующей').toEqual([]);

    // то же устройство подключилось снова: upsert по (user_id, endpoint), как делает приложение
    const upsert = `insert into public.push_subscriptions (device_id, endpoint, p256dh, auth_secret, user_agent, last_seen_at, revoked_at)
      values ('phone-a-2', '${ENDPOINT}', '${'n'.repeat(87)}', '${'m'.repeat(22)}', 'Safari', now(), null)
      on conflict (user_id, endpoint) do update set device_id = excluded.device_id, p256dh = excluded.p256dh, auth_secret = excluded.auth_secret,
        user_agent = excluded.user_agent, last_seen_at = excluded.last_seen_at, revoked_at = excluded.revoked_at
      returning id, revoked_at, p256dh`;
    const r = await run(asA, upsert);
    expect('rows' in r && r.rows).toEqual([{ id, revoked_at: null, p256dh: 'n'.repeat(87) }]);
    await commit(asA, upsert);
    const after = await db.query<{ id: string; revoked_at: string | null; device_id: string; auth_secret: string }>(`select id, revoked_at, device_id, auth_secret from public.push_subscriptions where endpoint = '${ENDPOINT}'`);
    expect(after.rows).toEqual([{ id, revoked_at: null, device_id: 'phone-a-2', auth_secret: 'm'.repeat(22) }]); // одна строка, тот же id
  });

  test('напоминания: при удалении пользователя его подписки, настройки и журнал удаляются каскадом, чужие остаются', async () => {
    const GONE = '77777777-7777-4777-8777-777777777777';
    await db.exec(`insert into auth.users (id) values ('${GONE}')`);
    const asGone: Who = { role: 'authenticated', sub: GONE };
    await commit(asGone, subInsert({ endpoint: EP('gone') }));
    await commit(asGone, settingsInsert({ enabled: true }));
    await commit(asService, `insert into public.push_log (user_id, kind, ref, sent_on) values ('${GONE}', 'daily', 'day', '2026-10-10')`);
    const count = (t: string) => db.query<{ n: number }>(`select count(*)::int as n from public.${t} where user_id = '${GONE}'`);
    for (const t of PUSH_TABLES) expect((await count(t)).rows, t).toEqual([{ n: 1 }]);
    await db.exec(`delete from auth.users where id = '${GONE}'`);
    for (const t of PUSH_TABLES) expect((await count(t)).rows, `${t} после удаления пользователя`).toEqual([{ n: 0 }]);
    const others = await db.query<{ n: number }>(`select count(*)::int as n from public.push_subscriptions where user_id in ('${A}', '${B}')`);
    expect(others.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });

  test('напоминания: права в каталоге — у authenticated только select/insert/update на подписки и настройки, на журнал ничего; у anon ничего; у service_role всё', async () => {
    const priv = async (role: string, t: string, p: string) => (await db.query<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.${t}', '${p}') as ok`)).rows[0]!.ok;
    for (const t of ['push_subscriptions', 'reminder_settings']) {
      for (const p of ['select', 'insert', 'update']) expect(await priv('authenticated', t, p), `authenticated ${p} ${t}`).toBe(true);
      for (const p of ['delete', 'truncate', 'references', 'trigger']) expect(await priv('authenticated', t, p), `authenticated ${p} ${t}`).toBe(false);
    }
    for (const p of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) expect(await priv('authenticated', 'push_log', p), `authenticated ${p} push_log`).toBe(false);
    for (const t of PUSH_TABLES) {
      for (const p of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) expect(await priv('anon', t, p), `anon ${p} ${t}`).toBe(false);
      for (const p of ['select', 'insert', 'update', 'delete']) expect(await priv('service_role', t, p), `service_role ${p} ${t}`).toBe(true);
    }
    // у каждой из трёх таблиц включена защита строк; политик у журнала нет, у остальных — по одной на select/insert/update и все «только для authenticated»
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname in ('push_subscriptions', 'reminder_settings', 'push_log') and relkind = 'r' order by relname`);
    expect(rls.rows).toEqual([
      { relname: 'push_log', relrowsecurity: true },
      { relname: 'push_subscriptions', relrowsecurity: true },
      { relname: 'reminder_settings', relrowsecurity: true },
    ]);
    const pol = await db.query<{ tablename: string; policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
      `select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ('push_subscriptions', 'reminder_settings') order by tablename, cmd`,
    );
    expect(pol.rows).toHaveLength(6);
    for (const p of pol.rows) {
      if (p.cmd !== 'INSERT') expect(p.qual, p.policyname).toContain('auth.uid()');
      if (p.cmd !== 'SELECT') expect(p.with_check, p.policyname).toContain('auth.uid()');
    }
  });

  test('напоминания: один адрес push может быть действующим у двух людей и строки друг друга они не трогают — хозяина адреса выбирает функция по last_seen_at (узкий запрос service_role)', async () => {
    const asA: Who = { role: 'authenticated', sub: A };
    const asB: Who = { role: 'authenticated', sub: B };
    const PHONE = EP('shared-phone');
    const SHARED_A = '52000000-0000-4000-8000-00000000000a';
    const SHARED_B = '52000000-0000-4000-8000-00000000000b';
    try {
      // A вышел без отзыва подписки, потом на том же телефоне вошёл B (тот же адрес): схема обе строки принимает
      await commit(asA, subInsert({ id: SHARED_A, endpoint: PHONE, device_id: 'phone' }));
      await db.exec(`update public.push_subscriptions set last_seen_at = '2026-10-01T10:00:00Z' where id = '${SHARED_A}'`);
      const second = await run(asB, subInsert({ id: SHARED_B, endpoint: PHONE, device_id: 'phone' }));
      expect(sqlState(second), 'схема допускает тот же адрес у другого человека (уникальна пара «человек + адрес»)').toBe('ok');
      await commit(asB, subInsert({ id: SHARED_B, endpoint: PHONE, device_id: 'phone' }));
      await db.exec(`update public.push_subscriptions set last_seen_at = '2026-10-09T10:00:00Z' where id = '${SHARED_B}'`);

      // строка A цела: вход B ничего в ней не менял и отозвать её B не может
      const revoke = await run(asB, `update public.push_subscriptions set revoked_at = now() where id = '${SHARED_A}'`);
      expect('rowCount' in revoke && revoke.rowCount, 'B отзывает подписку A').toBe(0);
      const own = await run(asA, `select id, revoked_at from public.push_subscriptions where endpoint = '${PHONE}'`);
      expect('rows' in own && own.rows, 'A видит только свою строку по этому адресу').toEqual([{ id: SHARED_A, revoked_at: null }]);

      // запрос функции «кто ещё на этом адресе»: только id и время, только действующие, свежие первыми; ключей и user_id не отдаёт
      const claims = await run(asService, `select id, last_seen_at from public.push_subscriptions where endpoint = '${PHONE}' and revoked_at is null order by last_seen_at desc, id asc limit 50`);
      expect('rows' in claims && claims.rows.map((r) => r.id)).toEqual([SHARED_B, SHARED_A]);
      // отзыв строки B (человек снял устройство) убирает её из выборки: хозяином остаётся единственная действующая строка
      await commit(asB, `update public.push_subscriptions set revoked_at = now() where id = '${SHARED_B}'`);
      const after = await run(asService, `select id from public.push_subscriptions where endpoint = '${PHONE}' and revoked_at is null`);
      expect('rows' in after && after.rows).toEqual([{ id: SHARED_A }]);
    } finally {
      await db.exec(`delete from public.push_subscriptions where endpoint = '${PHONE}'`);
    }
  });
});
