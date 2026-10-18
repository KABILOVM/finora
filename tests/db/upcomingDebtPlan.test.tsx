import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { StoreProvider, useStoppedDebtPlans, useUpcoming, type Store, type UpcomingItem } from '@/db';
import type { UUID } from '@/domain/types';
import { basics, makeStore } from './helpers';
import { renderHook, waitFor } from './renderHook';

/**
 * «Предстоящие» и план «Платить частями»: план по долгу, который погашен, закрыт, в архиве или удалён, в список не попадает
 * (debtPlanStop); «Открыть снова», пополнение и возврат из архива возвращают его без правки правила. Обычные платежи и выдача
 * по расписанию на тот же долг (другой вид операции) остаются на месте.
 */

const wrapperFor = (store: Store) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <StoreProvider store={store}>{children}</StoreProvider>;
  };

const TODAY = '2026-10-19';
const ALL_DATES = ['2026-10-12', '2026-10-19', '2026-10-26'];

/**
 * «Я должен» банку 12 000; план — расход 5 000 по понедельникам с 5 октября; обычный платёж «Интернет» с тем же расписанием;
 * выдача по расписанию — доход 2 000 на тот же долг («мне дали ещё»). Окно: 10 дней назад и 10 вперёд от 19 октября.
 */
async function setup({ upcoming = true } = {}) {
  const store = await makeStore();
  const k = await basics(store);
  const debt = await store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 12_000, currency: 'TJS', openedOn: '2026-09-01' });
  const weekly = { walletId: k.cash.id, frequency: 'weekly', startOn: '2026-10-05' } as const;
  const plan = await store.recurring.create({ ...weekly, kind: 'expense', amountMinor: 5_000, debtId: debt.id, note: 'Банк: частями' });
  const plain = await store.recurring.create({ ...weekly, kind: 'expense', amountMinor: 1_000, categoryId: k.food.id, note: 'Интернет' });
  const issue = await store.recurring.create({ ...weekly, kind: 'income', amountMinor: 2_000, debtId: debt.id, note: 'Банк: ещё' });
  const result = upcoming ? renderHook(() => useUpcoming(10, { today: TODAY, lookbackDays: 10 }), { wrapper: wrapperFor(store) }).result : null;
  return { store, ...k, debt, plan, plain, issue, result: result! };
}

const datesOf = (items: UpcomingItem[] | undefined, ruleId: UUID) => items?.filter((i) => i.rule.id === ruleId).map((i) => i.date);
const slotsOf = (items: UpcomingItem[] | undefined, ruleId: UUID) =>
  items?.filter((i) => i.rule.id === ruleId).map((i) => [i.date, i.status, i.alreadyExists]);

describe('useUpcoming: план по долгу, который стоит, не показывается', () => {
  it('погашен — план пропадает, обычный платёж и выдача остаются; пополнение возвращает план', async () => {
    const { store, cash, debt, plan, plain, issue, result } = await setup();
    await waitFor(() => {
      expect(datesOf(result.current, plan.id)).toEqual(ALL_DATES);
      expect(datesOf(result.current, plain.id)).toEqual(ALL_DATES);
      expect(datesOf(result.current, issue.id)).toEqual(ALL_DATES);
    });

    // плановый платёж за 12-е проведён (5 000), остаток 7 000 — план на месте, дата «уже есть»
    await store.transactions.createFromRule(plan, '2026-10-12', { fitToDebt: true });
    await waitFor(() =>
      expect(slotsOf(result.current, plan.id)).toEqual([
        ['2026-10-12', 'overdue', true],
        ['2026-10-19', 'due', false],
        ['2026-10-26', 'upcoming', false],
      ]),
    );

    // остаток 7 000 внесён вручную — долг погашен
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 7_000, occurredOn: '2026-10-14', debtId: debt.id });
    await waitFor(() => expect(datesOf(result.current, plan.id)).toEqual([]));
    expect(datesOf(result.current, plain.id)).toEqual(ALL_DATES);
    expect(datesOf(result.current, issue.id)).toEqual(ALL_DATES);

    await store.debts.increase(debt.id, 3_000);
    await waitFor(() =>
      expect(slotsOf(result.current, plan.id)).toEqual([
        ['2026-10-12', 'overdue', true],
        ['2026-10-19', 'due', false],
        ['2026-10-26', 'upcoming', false],
      ]),
    );
    expect(datesOf(result.current, plain.id)).toEqual(ALL_DATES);
  });

  it('закрыт — план пропадает; «Открыть снова» возвращает его вместе с просроченной датой', async () => {
    const { store, debt, plan, plain, issue, result } = await setup();
    await waitFor(() => expect(datesOf(result.current, plan.id)).toEqual(ALL_DATES));

    await store.debts.close(debt.id);
    await waitFor(() => expect(datesOf(result.current, plan.id)).toEqual([]));
    expect(datesOf(result.current, plain.id)).toEqual(ALL_DATES);
    expect(datesOf(result.current, issue.id)).toEqual(ALL_DATES);

    await store.debts.reopen(debt.id);
    // «Предстоящие» не режут дни остановки: просроченное ждёт решения человека (не проводит только автоматика)
    await waitFor(() =>
      expect(slotsOf(result.current, plan.id)).toEqual([
        ['2026-10-12', 'overdue', false],
        ['2026-10-19', 'due', false],
        ['2026-10-26', 'upcoming', false],
      ]),
    );
    expect(datesOf(result.current, plain.id)).toEqual(ALL_DATES);
    // в правило ничего не писали
    expect(await store.db.recurring_rules.get(plan.id)).toMatchObject({ archivedAt: null, deletedAt: null, amountMinor: 5_000 });
  });

  it('в архиве — план пропадает, выдача по расписанию остаётся; из архива — план снова в списке', async () => {
    const { store, debt, plan, plain, issue, result } = await setup();
    await waitFor(() => expect(datesOf(result.current, plan.id)).toEqual(ALL_DATES));
    await store.debts.archive(debt.id);
    await waitFor(() => expect(datesOf(result.current, plan.id)).toEqual([]));
    expect(datesOf(result.current, issue.id)).toEqual(ALL_DATES);
    expect(datesOf(result.current, plain.id)).toEqual(ALL_DATES);
    await store.debts.restore(debt.id);
    await waitFor(() => expect(datesOf(result.current, plan.id)).toEqual(ALL_DATES));
  });

  it('долг удалён на другом устройстве (правило ещё живое) — план пропадает, обычный платёж остаётся', async () => {
    const { store, debt, plan, plain, result } = await setup();
    await waitFor(() => expect(datesOf(result.current, plan.id)).toEqual(ALL_DATES));
    await store.db.debts.update(debt.id, { deletedAt: '2026-10-18T09:00:00.000Z' });
    await waitFor(() => expect(datesOf(result.current, plan.id)).toEqual([]));
    expect(datesOf(result.current, plain.id)).toEqual(ALL_DATES);
  });
});

describe('useStoppedDebtPlans: почему план стоит', () => {
  it('погашен → снова есть остаток → закрыт → в архиве → удалён; выдача по расписанию у погашенного, закрытого и архивного долга не стоит; обычного платежа в списке нет', async () => {
    const { store, cash, debt, plan, plain, issue } = await setup({ upcoming: false });
    const { result } = renderHook(() => useStoppedDebtPlans(), { wrapper: wrapperFor(store) });
    const entries = () => (result.current ? [...result.current.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)) : undefined);
    await waitFor(() => expect(entries()).toEqual([]));

    const payment = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 12_000, occurredOn: '2026-10-14', debtId: debt.id });
    await waitFor(() => expect(entries()).toEqual([[plan.id, 'settled']]));

    await store.transactions.softDelete(payment.id);
    await waitFor(() => expect(entries()).toEqual([]));

    await store.debts.close(debt.id);
    await waitFor(() => expect(entries()).toEqual([[plan.id, 'closed']]));

    await store.debts.reopen(debt.id);
    await store.debts.archive(debt.id);
    await waitFor(() => expect(entries()).toEqual([[plan.id, 'archived']]));
    expect(result.current?.has(issue.id)).toBe(false);

    await store.db.debts.update(debt.id, { deletedAt: '2026-10-18T09:00:00.000Z' });
    await waitFor(() => expect(result.current?.get(plan.id)).toBe('deleted'));
    expect(result.current?.has(plain.id)).toBe(false);
  });
});
