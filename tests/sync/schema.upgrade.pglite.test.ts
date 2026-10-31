// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SYNC_TABLES, toWire, type SyncTableName } from '@/sync/tables';
import { makeBudget, makeCategory, makeDebt, makeRecurringRule, makeSavingsGoal, makeSettings, makeShoppingItem, makeTransaction, makeUserId, makeWallet } from './factories';
import { createPgliteServer, type PgliteServer } from './pglite';

/**
 * Раздел 7 supabase/schema.sql (ограничения длины color / icon / fx_source) на УЖЕ созданной базе.
 * Таблицы создаются «if not exists» и в старых проектах не меняются, поэтому ограничения добавляются отдельным блоком.
 * «Старую базу» получаем так: применяем схему и убираем эти пять ограничений, как будто их никогда не было.
 */

const NAMES = ['wallets_color_len', 'wallets_icon_len', 'categories_color_len', 'categories_icon_len', 'transactions_fx_source_len'] as const;
const TABLE_OF = (name: string): string => name.slice(0, name.indexOf('_'));

let server: PgliteServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function oldDatabase(): Promise<PgliteServer> {
  server = await createPgliteServer();
  for (const name of NAMES) await server.db.exec(`alter table public.${TABLE_OF(name)} drop constraint ${name}`);
  return server;
}

const state = async (s: PgliteServer): Promise<Record<string, boolean>> => {
  const res = await s.db.query<{ conname: string; convalidated: boolean }>(
    `select conname, convalidated from pg_constraint where conname = any($1)`,
    [[...NAMES]],
  );
  return Object.fromEntries(res.rows.map((r) => [r.conname, r.convalidated]));
};

const insertWallet = (id: string, color: string, stamp = '2026-01-01T00:00:00Z'): string =>
  `insert into public.wallets (id, created_at, client_updated_at, device_id, name, currency, kind, opening_balance_minor, color, icon, sort_order)
   values ('${id}', '${stamp}', '${stamp}', 'dev', 'W', 'TJS', 'cash', 0, '${color}', 'w', 1)`;

describe('схема: ограничения длины на уже созданной базе', () => {
  it('чистая старая база: все пять ограничений добавляются и проверены', async () => {
    const s = await oldDatabase();
    expect(await state(s)).toEqual({});
    await s.applySchema();
    expect(await state(s)).toEqual(Object.fromEntries(NAMES.map((n) => [n, true])));
    const userId = makeUserId();
    await s.addUser(userId);
    await expect(s.as({ role: 'authenticated', sub: userId }, (tx) => tx.query(insertWallet(makeWallet().id, 'c'.repeat(33))))).rejects.toMatchObject({ code: '23514' });
    await expect(s.as({ role: 'authenticated', sub: userId }, (tx) => tx.query(insertWallet(makeWallet().id, 'c'.repeat(32))))).resolves.toBeDefined();
  });

  it('в старой базе уже лежит слишком длинная строка: схема не падает, новые длинные значения отвергаются, старую можно только укоротить', async () => {
    const s = await oldDatabase();
    const userId = makeUserId();
    await s.addUser(userId);
    const as = { role: 'authenticated' as const, sub: userId };
    const dirty = makeWallet().id;
    const long = 'c'.repeat(5000);
    await s.as(as, (tx) => tx.query(insertWallet(dirty, long)));
    const dirtyCat = makeCategory().id;
    await s.as(as, (tx) =>
      tx.query(
        `insert into public.categories (id, created_at, client_updated_at, device_id, name, kind, color, icon, sort_order)
         values ('${dirtyCat}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'dev', 'C', 'expense', '#fff', '${'i'.repeat(100)}', 1)`,
      ),
    );

    await s.applySchema(); // не должно бросить
    // ограничения есть для всех; «не проверены» только там, где нашлись старые нарушения
    expect(await state(s)).toEqual({
      wallets_color_len: false,
      wallets_icon_len: true,
      categories_color_len: true,
      categories_icon_len: false,
      transactions_fx_source_len: true,
    });

    // новая длинная строка отвергается
    await expect(s.as(as, (tx) => tx.query(insertWallet(makeWallet().id, 'c'.repeat(33))))).rejects.toMatchObject({ code: '23514' });
    // правка старой строки с тем же длинным значением отвергается (её сервер принял бы только с укороченным цветом)
    const newer = '2026-02-01T00:00:00Z';
    const upsert = (color: string) =>
      `${insertWallet(dirty, color, newer)} on conflict (id) do update set color = excluded.color, client_updated_at = excluded.client_updated_at, device_id = excluded.device_id`;
    await expect(s.as(as, (tx) => tx.query(upsert(long)))).rejects.toMatchObject({ code: '23514' });
    await s.as(as, (tx) => tx.query(upsert('#abcdef')));
    const row = (await s.adminRows('wallets')).find((r) => r['id'] === dirty);
    expect(row?.['color']).toBe('#abcdef');

    // повторный запуск: ничего не падает, ничего не дублируется
    await s.applySchema();
    const count = await s.db.query<{ n: number }>(`select count(*)::int as n from pg_constraint where conname = any($1)`, [[...NAMES]]);
    expect(count.rows[0]?.n).toBe(NAMES.length);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Обновление с этапа 1 на этап 2: применяем ПРЕЖНЮЮ версию схемы (снимок fixtures/schema.stage1.sql = supabase/schema.sql
// последнего коммита этапа 1) с данными, затем текущую. Ошибок быть не должно, данные целы, номера server_seq не сдвинулись.
// ---------------------------------------------------------------------------------------------------------------------

const STAGE1 = readFileSync(fileURLToPath(new URL('./fixtures/schema.stage1.sql', import.meta.url)), 'utf8');
const STAGE1_TABLES = ['settings', 'wallets', 'categories', 'transactions'] as const;
const HOUR = 3_600_000;
const stamps = (offsetMs = -HOUR) => {
  const t = new Date(Date.now() + offsetMs).toISOString();
  return { createdAt: t, clientUpdatedAt: t };
};

/** Строка в виде, понятном схеме этапа 1: без колонок, которых там ещё нет. */
const asStage1 = (table: SyncTableName, row: Record<string, unknown>): Record<string, unknown> => {
  const { debt_id: _d, recurring_rule_id: _r, ...rest } = row;
  const { goal_minor: _gm, goal_on: _go, ...withoutGoal } = row;
  const { weather: _w, ...withoutWeather } = row;
  const { essential: _e, ...withoutEssential } = row;
  if (table === 'categories') return withoutEssential; // «обязательная» категория — ещё позже (раздел 16 схемы)
  if (table === 'wallets') return withoutGoal; // цели накопления появились позже (раздел 11 схемы)
  if (table === 'settings') return withoutWeather; // города для погоды — ещё позже (раздел 13 схемы)
  return table === 'transactions' ? rest : row;
};

const dumpAll = async (s: PgliteServer, tables: readonly SyncTableName[]): Promise<Record<string, Record<string, unknown>[]>> =>
  Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await s.adminRows(t)] as const)));

async function stage1WithData(): Promise<{ s: PgliteServer; userId: string; ids: { w1: string; w2: string; c: string; transfer: string; expense: string } }> {
  const s = await createPgliteServer({ schema: STAGE1 });
  server = s;
  const hasNew = await s.db.query(`select 1 from pg_class where relnamespace = 'public'::regnamespace and relname in ('debts', 'budgets', 'recurring_rules', 'shopping_items', 'savings_goals')`);
  expect(hasNew.rows, 'прежняя схема не должна знать о таблицах этапа 2').toEqual([]);
  const userId = makeUserId();
  await s.addUser(userId);
  const w1 = makeWallet(stamps());
  const w2 = makeWallet({ ...stamps(), currency: 'USD' });
  const c = makeCategory(stamps());
  const expense = makeTransaction({ ...stamps(), walletId: w1.id, categoryId: c.id, note: 'старая операция' });
  const transfer = makeTransaction({ ...stamps(), kind: 'transfer', walletId: w1.id, toWalletId: w2.id, amountMinor: 10_900, toAmountMinor: 1_000 });
  const push = (table: SyncTableName, rows: Array<Record<string, unknown>>) => s.transportFor(userId).push(table, rows.map((r) => asStage1(table, r)) as never);
  await push('settings', [toWire('settings', makeSettings(userId, stamps()))]);
  await push('wallets', [toWire('wallets', w1), toWire('wallets', w2)]);
  await push('categories', [toWire('categories', c)]);
  await push('transactions', [toWire('transactions', expense), toWire('transactions', transfer)]);
  return { s, userId, ids: { w1: w1.id, w2: w2.id, c: c.id, transfer: transfer.id, expense: expense.id } };
}

describe('схема: обновление с этапа 1 на этап 2 поверх живой базы', () => {
  it('прежняя схема + данные → текущая схема: без ошибок, данные и server_seq целы, новые колонки пусты, повторный запуск ничего не меняет', async () => {
    const { s } = await stage1WithData();
    const before = await dumpAll(s, STAGE1_TABLES);
    for (const t of STAGE1_TABLES) expect(before[t], t).not.toHaveLength(0);

    await s.applySchema(); // обновление
    const after = await dumpAll(s, STAGE1_TABLES);
    for (const t of STAGE1_TABLES) {
      // новые колонки пусты: у всех старых таблиц — служебная base_seq (проверка версии), у операций — ещё debt_id и recurring_rule_id,
      // у кошельков — цель накопления (goal_minor, goal_on), у настроек — города для погоды (weather)
      const expected = before[t]!.map((r) => ({
        ...r,
        base_seq: null,
        ...(t === 'transactions' ? { debt_id: null, recurring_rule_id: null } : {}),
        ...(t === 'wallets' ? { goal_minor: null, goal_on: null } : {}),
        ...(t === 'settings' ? { weather: null } : {}),
        // существующие категории получают «не обязательная» (0), а не пустое значение
        ...(t === 'categories' ? { essential: 0 } : {}),
      }));
      expect(after[t], t).toEqual(expected);
    }

    const count = async () =>
      (
        await s.db.query<Record<string, number>>(
          `select (select count(*) from pg_policies where schemaname = 'public')::int as policies,
                  (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public')::int as constraints,
                  (select count(*) from pg_indexes where schemaname = 'public')::int as indexes,
                  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal)::int as triggers`,
        )
      ).rows[0];
    const once = await count();
    expect(once).toMatchObject({ policies: 34, triggers: 9 });
    await s.applySchema();
    await s.applySchema();
    expect(await count()).toEqual(once);
    expect(await dumpAll(s, STAGE1_TABLES)).toEqual(after);
  });

  it('после обновления новые таблицы работают, а старый курсор синхронизации продолжает читать только новое', async () => {
    const { s, userId, ids } = await stage1WithData();
    const oldMax = Math.max(...(await s.adminRows('transactions')).map((r) => Number(r['server_seq'])));
    await s.applySchema();
    const t = s.transportFor(userId);

    const debt = makeDebt(stamps());
    await t.push('debts', [toWire('debts', debt)]);
    await t.push('budgets', [toWire('budgets', makeBudget({ ...stamps(), categoryId: ids.c }))]);
    const rule = makeRecurringRule({ ...stamps(), walletId: ids.w1, categoryId: ids.c, debtId: debt.id });
    await t.push('recurring_rules', [toWire('recurring_rules', rule)]);
    const repay = makeTransaction({ ...stamps(), kind: 'income', walletId: ids.w1, debtId: debt.id, recurringRuleId: rule.id });
    await t.push('transactions', [toWire('transactions', repay)]);

    // старый перевод (комиссия 0) получает комиссию правкой: новое поле смысла base_amount_minor принимается
    const old = (await s.adminRows('transactions')).find((r) => r['id'] === ids.transfer)!;
    await t.push('transactions', [{ ...(old as Record<string, unknown>), base_amount_minor: 150, client_updated_at: new Date().toISOString() } as never]);

    const fresh = await t.pull('transactions', oldMax, 100);
    expect(fresh.map((r) => r.id).sort()).toEqual([repay.id, ids.transfer].sort());
    expect(fresh.find((r) => r.id === ids.transfer)).toMatchObject({ base_amount_minor: 150, debt_id: null });
    expect(fresh.find((r) => r.id === repay.id)).toMatchObject({ debt_id: debt.id, recurring_rule_id: rule.id });
    await t.push('shopping_items', [toWire('shopping_items', makeShoppingItem(stamps()))]);
    await t.push('savings_goals', [toWire('savings_goals', makeSavingsGoal({ ...stamps(), walletId: ids.w1 }))]);
    for (const table of SYNC_TABLES) expect((await t.pull(table, 0, 100)).length, table).toBeGreaterThan(0);
  });

  it('база с недоприменённым этапом 2 (нет внешних ключей на операциях) достраивается: ключи и проверка долга появляются', async () => {
    const { s } = await stage1WithData();
    await s.applySchema();
    const drop = ['transactions_debt_fk', 'transactions_recurring_rule_fk', 'transactions_debt_shape'];
    for (const name of drop) await s.db.exec(`alter table public.transactions drop constraint ${name}`);
    await s.applySchema();
    const left = await s.db.query<{ conname: string }>(`select conname from pg_constraint where conname = any($1) order by 1`, [drop]);
    expect(left.rows.map((r) => r.conname)).toEqual([...drop].sort());
  });
});
