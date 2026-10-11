import { describe, expect, it } from 'vitest';
import type { LocalRow } from '@/domain/types';
import { createMemoryServer } from '@/sync/memoryServer';
import { SYNC_TABLES, type SyncTableName } from '@/sync/tables';
import { makeBudget, makeCategory, makeDebt, makeRecurringRule, makeTransaction } from './factories';
import { USER, openDevice, spy, until, type Device, type Spy } from './engineHarness';

/**
 * Движок и таблицы этапа 2 (долги, бюджеты, регулярные платежи): доставка между устройствами, порядок отправки,
 * цепочки зависимостей «родитель в карантине → дети не отправляются», снятие блокировки после исправления.
 * Зависимости: операции — от кошельков, категорий, долгов, регулярных платежей; платежи — от кошельков, категорий, долгов;
 * бюджеты — от категорий; долги — ни от чего.
 */

const dirty = <T extends object>(e: T): LocalRow<T> => ({ ...e, dirty: 1 as const, serverSeq: null, syncError: null }) as LocalRow<T>;
const stripLocal = (row: Record<string, unknown>): Record<string, unknown> => {
  const { dirty: _d, serverSeq: _s, syncError: _e, dirtyGroups: _g, ...rest } = row;
  return rest;
};
const old = '2026-10-01T00:00:00.000Z';
const base = { createdAt: old, clientUpdatedAt: old, deviceId: 'dev-a' };

async function ready(server: ReturnType<typeof createMemoryServer>, id: string) {
  let sp!: Spy;
  const d = await openDevice(server, id, { seed: true, wrap: (inner) => (sp = spy(inner)).transport });
  await d.engine.syncNow();
  return { d, sp };
}

async function firstWalletId(d: Device): Promise<string> {
  const w = await d.store.db.wallets.orderBy('sortOrder').first();
  if (!w) throw new Error('нет кошелька');
  return w.id;
}
async function firstCategoryId(d: Device): Promise<string> {
  const c = await d.store.db.categories.where('kind').equals('expense').first();
  if (!c) throw new Error('нет категории');
  return c.id;
}

describe('движок: таблицы этапа 2', () => {
  it('долги, бюджеты, платежи и операции с ссылками доезжают до сервера и до второго устройства без искажений; отправка идёт в порядке SYNC_TABLES', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const walletId = await firstWalletId(a);
    const categoryId = await firstCategoryId(a);
    const debt = makeDebt({ ...base, counterparty: 'Рустам', principalMinor: 250_000, dueOn: '2026-12-31', note: 'до зарплаты' });
    const budget = makeBudget({ ...base, categoryId, amountMinor: 80_000 });
    const rule = makeRecurringRule({ ...base, walletId, debtId: debt.id, categoryId: null, amountMinor: 5_000, autoPost: 1, note: 'взнос' });
    const repay = makeTransaction({ ...base, walletId, kind: 'income', debtId: debt.id, recurringRuleId: rule.id, amountMinor: 5_000, baseAmountMinor: 5_000 });
    await a.store.db.transactions.bulkPut([dirty(repay)]); // дети раньше родителей: порядок записи в базу не важен
    await a.store.db.recurring_rules.bulkPut([dirty(rule)]);
    await a.store.db.budgets.bulkPut([dirty(budget)]);
    await a.store.db.debts.bulkPut([dirty(debt)]);

    sp.calls.length = 0;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(server.dump(USER, 'debts').map((r) => r['id'])).toEqual([debt.id]);
    expect(server.dump(USER, 'budgets').map((r) => r['id'])).toEqual([budget.id]);
    expect(server.dump(USER, 'recurring_rules').map((r) => r['id'])).toEqual([rule.id]);
    expect(server.dump(USER, 'transactions').map((r) => r['id'])).toEqual([repay.id]);

    const order = [...new Set(sp.pushes().map((c) => c.table))];
    expect(order).toEqual(SYNC_TABLES.filter((t) => order.includes(t)));
    expect(order.indexOf('debts')).toBeLessThan(order.indexOf('recurring_rules'));
    expect(order.indexOf('recurring_rules')).toBeLessThan(order.indexOf('transactions'));

    const { d: b } = await ready(server, 'dev-b');
    for (const [table, e] of [['debts', debt], ['budgets', budget], ['recurring_rules', rule], ['transactions', repay]] as const) {
      const got = await b.store.db.syncTable(table).get(e.id);
      expect(got ? stripLocal(got as never) : got, table).toEqual(e);
    }
  });

  it('цепочка: отвергнутый долг тянет в карантин свои платежи и операции (и операции этих платежей), отвергнутая категория — свой бюджет; остальное уходит', async () => {
    const server = createMemoryServer();
    const { d: a, sp } = await ready(server, 'dev-a');
    const walletId = await firstWalletId(a);
    const badDebt = makeDebt({ ...base, counterparty: 'Плохой должник', currency: 'usd' }); // сервер отвергнет: debts_currency_fmt
    const badCat = makeCategory({ ...base, name: '' }); // categories_name_len
    const ruleBad = makeRecurringRule({ ...base, walletId, debtId: badDebt.id, note: 'по долгу' });
    const ruleGood = makeRecurringRule({ ...base, walletId, note: 'аренда' });
    const txViaRule = makeTransaction({ ...base, walletId, recurringRuleId: ruleBad.id });
    const txViaDebt = makeTransaction({ ...base, walletId, kind: 'income', debtId: badDebt.id });
    const txGood = makeTransaction({ ...base, walletId, recurringRuleId: ruleGood.id });
    const budgetBad = makeBudget({ ...base, categoryId: badCat.id });
    const budgetGood = makeBudget({ ...base });
    await a.store.db.debts.bulkPut([dirty(badDebt)]);
    await a.store.db.categories.bulkPut([dirty(badCat)]);
    await a.store.db.recurring_rules.bulkPut([dirty(ruleBad), dirty(ruleGood)]);
    await a.store.db.budgets.bulkPut([dirty(budgetBad), dirty(budgetGood)]);
    await a.store.db.transactions.bulkPut([dirty(txViaRule), dirty(txViaDebt), dirty(txGood)]);

    sp.calls.length = 0;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 6 });
    expect(server.dump(USER, 'debts')).toEqual([]);
    expect(server.dump(USER, 'recurring_rules').map((r) => r['id'])).toEqual([ruleGood.id]);
    expect(server.dump(USER, 'budgets').map((r) => r['id'])).toEqual([budgetGood.id]);
    expect(server.dump(USER, 'transactions').map((r) => r['id'])).toEqual([txGood.id]);

    const err = async (table: SyncTableName, id: string) => (await a.store.db.syncTable(table).get(id))?.syncError;
    expect(await err('debts', badDebt.id)).toMatch(/^Сервер не принял запись/);
    expect(await err('recurring_rules', ruleBad.id)).toMatch(/^Не отправлена: долг «Плохой должник» не принят\(а\) сервером/);
    expect(await err('transactions', txViaDebt.id)).toMatch(/^Не отправлена: долг «Плохой должник»/);
    expect(await err('transactions', txViaRule.id)).toMatch(/^Не отправлена: регулярный платёж «по долгу»/); // цепочка: долг → платёж → операция
    expect(await err('budgets', budgetBad.id)).toMatch(/^Не отправлена: категория «»/);

    // заведомо отвергаемое отправлялось только само по себе, дети отвергнутых родителей на сервер не ходили
    const sent = new Set(sp.pushes().flatMap((c) => c.ids ?? []));
    for (const id of [ruleBad.id, txViaRule.id, txViaDebt.id, budgetBad.id]) expect(sent.has(id), id).toBe(false);

    // человек исправил родителей, не перезапуская приложение: блокировка детей снимается сама, всё уходит
    await a.store.db.debts.update(badDebt.id, { currency: 'TJS', syncError: null });
    await a.store.db.categories.update(badCat.id, { name: 'Починена', syncError: null });
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(server.dump(USER, 'debts').map((r) => r['id'])).toEqual([badDebt.id]);
    expect(server.dump(USER, 'recurring_rules').map((r) => r['id']).sort()).toEqual([ruleBad.id, ruleGood.id].sort());
    expect(server.dump(USER, 'budgets').map((r) => r['id']).sort()).toEqual([budgetBad.id, budgetGood.id].sort());
    expect(server.dump(USER, 'transactions').map((r) => r['id']).sort()).toEqual([txGood.id, txViaDebt.id, txViaRule.id].sort());
  });

  it('родитель, который сам себе виноват, не блокирует чужих детей; отвергнутая операция не мешает остальным операциям долга', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const walletId = await firstWalletId(a);
    const debt = makeDebt({ ...base });
    const badTx = makeTransaction({ ...base, walletId, debtId: debt.id, amountMinor: 0 }); // transactions_amount
    const okTx = makeTransaction({ ...base, walletId, debtId: debt.id, amountMinor: 700, baseAmountMinor: 700 });
    await a.store.db.debts.bulkPut([dirty(debt)]);
    await a.store.db.transactions.bulkPut([dirty(badTx), dirty(okTx)]);
    await a.engine.syncNow();
    expect(server.dump(USER, 'debts')).toHaveLength(1);
    expect(server.dump(USER, 'transactions').map((r) => r['id'])).toEqual([okTx.id]);
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 1 });
    expect((await a.store.db.debts.get(debt.id))?.dirty).toBe(0);
  });

  it('перезапуск приложения снимает карантин: платёж и операции по ранее отвергнутому долгу уходят после его исправления', async () => {
    const server = createMemoryServer();
    const { d: a } = await ready(server, 'dev-a');
    const walletId = await firstWalletId(a);
    const debt = makeDebt({ ...base, principalMinor: 0 }); // debts_principal
    const rule = makeRecurringRule({ ...base, walletId, debtId: debt.id });
    await a.store.db.debts.bulkPut([dirty(debt)]);
    await a.store.db.recurring_rules.bulkPut([dirty(rule)]);
    await a.engine.syncNow();
    expect(a.engine.getStatus().quarantined).toBe(2);
    await a.store.db.debts.update(debt.id, { principalMinor: 1_000 });
    a.engine.start();
    await until(() => server.dump(USER, 'recurring_rules').length === 1, 'платёж ушёл');
    expect(server.dump(USER, 'debts')).toHaveLength(1);
    await until(() => a.engine.getStatus().quarantined === 0, 'карантин пуст');
  });
});
