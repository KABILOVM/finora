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

const TABLES = ['settings', 'wallets', 'categories', 'debts', 'budgets', 'recurring_rules', 'transactions'] as const;
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
    expect(privs.rows.length).toBe(8); // 7 таблиц синхронизации + курсы валют
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
  test('каталог: политик ровно 22 (select / insert / update × 7 таблиц синхронизации + 1 select у курсов), политик на delete и «для всех» нет', async () => {
    const pol = await db.query<{ tablename: string; cmd: string; roles: string }>(`select tablename, cmd, roles::text as roles from pg_policies where schemaname = 'public'`);
    expect(pol.rows).toHaveLength(22);
    for (const t of TABLES) expect(pol.rows.filter((p) => p.tablename === t).map((p) => p.cmd).sort(), t).toEqual(['INSERT', 'SELECT', 'UPDATE']);
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
});
