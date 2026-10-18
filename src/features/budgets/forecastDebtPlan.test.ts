import { describe, expect, it } from 'vitest';
import { basics, makeStore } from '../../../tests/db/helpers';
import { loadForecastData } from './useDailyForecast';

/** Прогноз «в день» и календарь денег не считают платежи плана по долгу, который стоит (как «Предстоящие»). */
describe('прогноз: план по долгу, который стоит, денег не тратит', () => {
  const ruleIds = async (store: Awaited<ReturnType<typeof makeStore>>) => {
    const l = await loadForecastData(store, '2026-10-15');
    if (!l || l.overflow) throw new Error('прогноз не посчитан');
    return l.data.rules.map((r) => r.id);
  };

  it('закрыт — плана нет; открыт снова — есть; погашен — нет; обычное правило и выдача по расписанию на месте', async () => {
    const store = await makeStore();
    const { cash, food } = await basics(store);
    const debt = await store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-01' });
    const plan = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-10-20', debtId: debt.id });
    const issue = await store.recurring.create({ kind: 'income', walletId: cash.id, amountMinor: 1_000, frequency: 'monthly', startOn: '2026-10-25', debtId: debt.id });
    const plain = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 700, frequency: 'monthly', startOn: '2026-10-21', categoryId: food.id });

    expect(await ruleIds(store)).toEqual(expect.arrayContaining([plan.id, issue.id, plain.id]));
    await store.debts.close(debt.id);
    expect(await ruleIds(store)).not.toContain(plan.id);
    expect(await ruleIds(store)).toEqual(expect.arrayContaining([issue.id, plain.id]));
    await store.debts.reopen(debt.id);
    expect(await ruleIds(store)).toContain(plan.id);
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 10_000, occurredOn: '2026-10-10', debtId: debt.id });
    expect(await ruleIds(store)).not.toContain(plan.id);
    expect(await ruleIds(store)).toEqual(expect.arrayContaining([issue.id, plain.id]));
  });
});
