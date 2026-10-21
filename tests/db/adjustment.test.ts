import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { exportBackup, FxRequiredError, importBackup, summarizeDay, summarizeMonth, ValidationError } from '@/db';
import { ADJUSTMENT_NOTE, ADJUSTMENT_SOURCE, isAdjustment } from '@/domain/adjustment';
import { computeBalances } from '@/domain/balances';
import { budgetLevelsOf } from '@/domain/budgetLevels';
import { topExpenses, weekdayProfile } from '@/features/analytics/analytics';
import { balanceSeries } from '@/features/home/homeData';
import { describeTx } from '@/features/transactions/txDisplay';
import { basics, makeStore } from './helpers';

const day = '2026-10-05';

async function setup() {
  const store = await makeStore();
  const b = await basics(store);
  await store.wallets.update(b.cash.id, { openingBalanceMinor: 100_000 });
  return { store, ...b };
}

describe('«Корректировка остатка»: запись', () => {
  it('разница в плюс — доход, в минус — расход; заметка, без категории и долга, пометка в fxSource', async () => {
    const { store, cash } = await setup();
    const up = await store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: 2_345, occurredOn: day });
    const down = await store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: -1_000, occurredOn: day });
    expect(up).toMatchObject({ kind: 'income', amountMinor: 2_345, categoryId: null, debtId: null, note: ADJUSTMENT_NOTE, fxSource: ADJUSTMENT_SOURCE, fxRate: 1, baseAmountMinor: 2_345 });
    expect(down).toMatchObject({ kind: 'expense', amountMinor: 1_000, fxSource: ADJUSTMENT_SOURCE });
    expect(isAdjustment(up) && isAdjustment(down)).toBe(true);
  });

  it('остаток кошелька меняется на разницу', async () => {
    const { store, cash } = await setup();
    await store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: 2_345, occurredOn: day });
    const wallets = await store.db.wallets.toArray();
    const txs = await store.db.transactions.toArray();
    expect(computeBalances(wallets, txs).get(cash.id)).toBe(102_345);
  });

  it.each([0, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])('разница %s — ошибка', async (delta) => {
    const { store, cash } = await setup();
    await expect(store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: delta, occurredOn: day })).rejects.toBeInstanceOf(ValidationError);
  });

  it('кошелёк в небазовой валюте без курса — ошибка курса; с курсом — снимок в базовой, пометка сохраняется', async () => {
    const { store, usd } = await setup();
    await expect(store.transactions.createAdjustment({ walletId: usd.id, deltaMinor: 1_000, occurredOn: day })).rejects.toBeInstanceOf(FxRequiredError);
    const t = await store.transactions.createAdjustment({ walletId: usd.id, deltaMinor: 1_000, occurredOn: day, fx: { rate: 10.9, source: 'nbt' } });
    expect(t).toMatchObject({ fxSource: ADJUSTMENT_SOURCE, fxRate: 10.9, baseAmountMinor: 10_900 });
  });

  it('деньги корректировки не правятся, заметка и дата — можно, удаление и возврат работают', async () => {
    const { store, cash } = await setup();
    const t = await store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: 500, occurredOn: day });
    await expect(store.transactions.update(t.id, { amountMinor: 600 })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.transactions.update(t.id, { kind: 'expense' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.transactions.update(t.id, { categoryId: null, fx: { rate: 1, source: 'manual' } })).rejects.toBeInstanceOf(ValidationError);
    const edited = await store.transactions.update(t.id, { note: 'сверка с банком', occurredOn: '2026-10-06' });
    expect(edited).toMatchObject({ note: 'сверка с банком', occurredOn: '2026-10-06', fxSource: ADJUSTMENT_SOURCE });
    await store.transactions.softDelete(t.id);
    expect(computeBalances(await store.db.wallets.toArray(), await store.db.transactions.toArray()).get(cash.id)).toBe(100_000);
    await store.transactions.restore(t.id);
    expect(isAdjustment((await store.db.transactions.get(t.id))!)).toBe(true);
  });

  it('обычный доход, расход и долговая операция корректировкой не считаются', async () => {
    expect(isAdjustment({ kind: 'income', fxSource: 'same' })).toBe(false);
    expect(isAdjustment({ kind: 'income', fxSource: null })).toBe(false);
    expect(isAdjustment({ kind: 'income' })).toBe(false);
    expect(isAdjustment({ kind: 'transfer', fxSource: ADJUSTMENT_SOURCE })).toBe(false);
    expect(isAdjustment({ kind: 'expense', fxSource: ADJUSTMENT_SOURCE, debtId: 'd' })).toBe(false);
  });
});

describe('«Корректировка остатка»: не доход и не расход', () => {
  async function withOps() {
    const { store, cash, food } = await setup();
    await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 50_000, occurredOn: day });
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 10_000, categoryId: food.id, occurredOn: day });
    await store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: 7_000, occurredOn: day });
    await store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: -3_000, occurredOn: day });
    return { store, cash, food, txs: await store.db.transactions.toArray() };
  }

  it('итоги месяца и дня: доходы, расходы, категории — без корректировок; они отдельным итогом', async () => {
    const { txs } = await withOps();
    const m = summarizeMonth(txs, '2026-10', 'TJS');
    expect(m).toMatchObject({ incomeMinor: 50_000, expenseMinor: 10_000, adjustmentFlowMinor: 4_000, debtFlowMinor: 0 });
    expect(m.byCategory).toHaveLength(1);
    const d = summarizeDay(txs, 'TJS');
    expect(d.netMinor).toBe(40_000);
  });

  it('график остатка по дням идёт с учётом корректировок: сегодня = итог, вчера = итог − вся сумма дня', async () => {
    const { store, cash, txs } = await withOps();
    const total = computeBalances(await store.db.wallets.toArray(), txs).get(cash.id)!;
    expect(total).toBe(100_000 + 50_000 - 10_000 + 4_000);
    const series = balanceSeries(txs, total, day, 2, 'TJS');
    expect(series).toEqual([100_000, 100_000, total]);
  });

  it('бюджет: корректировка-расход в лимит не входит', async () => {
    const { txs, food } = await withOps();
    const rows = budgetLevelsOf({
      budgets: [{ id: 'b', categoryId: null, amountMinor: 20_000, currency: 'TJS' }],
      txs: txs.filter((t) => t.deletedAt === null),
      parentOf: new Map([[food.id, null]]),
      base: 'TJS',
    });
    expect(rows[0]?.percent).toBe(50); // 10 000 из 20 000; с корректировкой 3 000 было бы 65
  });

  it('самые крупные расходы и дни недели корректировку не показывают', async () => {
    const { txs } = await withOps();
    expect(topExpenses(txs, '2026-10', 'TJS').map((t) => t.amountMinor)).toEqual([10_000]);
    const total = weekdayProfile(txs, '2026-10', '2026-10-31', 'TJS').reduce((s, p) => s + p.totalMinor, 0);
    expect(total).toBe(10_000);
  });

  it('строка в списке: «Корректировка остатка», без цветов дохода/расхода', async () => {
    const { store, cash } = await setup();
    const t = await store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: -3_000, occurredOn: day });
    const v = describeTx(t, new Map([[cash.id, cash]]), new Map());
    expect(v).toMatchObject({ title: 'Корректировка остатка', tone: 'none', signedMinor: -3_000, subtitle: cash.name });
  });
});

describe('«Корректировка остатка»: резервная копия', () => {
  it('выгрузка и загрузка сохраняют пометку', async () => {
    const { store, cash } = await setup();
    const t = await store.transactions.createAdjustment({ walletId: cash.id, deltaMinor: 900, occurredOn: day });
    const file = await exportBackup(store);
    const other = await makeStore({ factory: new IDBFactory() });
    await importBackup(other, JSON.parse(JSON.stringify(file)));
    const back = await other.db.transactions.get(t.id);
    expect(back).toMatchObject({ fxSource: ADJUSTMENT_SOURCE, kind: 'income', amountMinor: 900 });
  });
});
