import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DEBT_OVERFLOW_MESSAGE, StoreProvider, useBudgets, useDebts, useDebtState, useDebtView, useRecurringRules, useTransactions, useUpcoming, uuidV5, type Store } from '@/db';
import { basics, makeStore } from './helpers';
import { renderHook, waitFor } from './renderHook';

const wrapperFor = (store: Store) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <StoreProvider store={store}>{children}</StoreProvider>;
  };

const debtInput = { direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' } as const;

describe('useBudgets', () => {
  it('undefined пока грузится; общий лимит первым; архивные скрыты; живое обновление', async () => {
    const store = await makeStore();
    const { food } = await basics(store);
    const { result } = renderHook(() => useBudgets(), { wrapper: wrapperFor(store) });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual([]));
    const cat = await store.budgets.create({ categoryId: food.id, amountMinor: 100 });
    const total = await store.budgets.create({ amountMinor: 900 });
    await waitFor(() => expect(result.current?.map((b) => b.id)).toEqual([total.id, cat.id]));
    await store.budgets.archive(cat.id);
    await waitFor(() => expect(result.current?.map((b) => b.id)).toEqual([total.id]));
    const all = renderHook(() => useBudgets({ includeArchived: true }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(all.result.current).toHaveLength(2));
  });
});

describe('useDebts', () => {
  it('незакрытые первыми, затем по сроку; архивные скрыты; закрытые можно скрыть', async () => {
    const store = await makeStore();
    const a = await store.debts.create({ ...debtInput, counterparty: 'Без срока' });
    const b = await store.debts.create({ ...debtInput, counterparty: 'Срок поздний', dueOn: '2026-12-31' });
    const c = await store.debts.create({ ...debtInput, counterparty: 'Срок ранний', dueOn: '2026-11-01' });
    const d = await store.debts.create({ ...debtInput, counterparty: 'Закрыт' });
    const e = await store.debts.create({ ...debtInput, counterparty: 'В архиве' });
    await store.debts.close(d.id);
    await store.debts.archive(e.id);
    const { result } = renderHook(() => useDebts(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current?.map((x) => x.id)).toEqual([c.id, b.id, a.id, d.id]));
    const open = renderHook(() => useDebts({ includeClosed: false }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(open.result.current?.map((x) => x.id)).toEqual([c.id, b.id, a.id]));
    const every = renderHook(() => useDebts({ includeArchived: true }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(every.result.current).toHaveLength(5));
  });
});

describe('useRecurringRules', () => {
  it('по началу расписания; архивные скрыты', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const mk = (startOn: string) => store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 10, frequency: 'monthly', startOn });
    const late = await mk('2026-11-01');
    const early = await mk('2026-10-01');
    const gone = await mk('2026-09-01');
    await store.recurring.archive(gone.id);
    const { result } = renderHook(() => useRecurringRules(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current?.map((r) => r.id)).toEqual([early.id, late.id]));
    const all = renderHook(() => useRecurringRules({ includeArchived: true }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(all.result.current).toHaveLength(3));
  });
});

describe('useDebtState / useDebtView', () => {
  it('остаток и платежи считаются из операций и обновляются сами', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const debt = await store.debts.create(debtInput);
    const { result } = renderHook(() => useDebtState(debt.id), { wrapper: wrapperFor(store) });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.state).toMatchObject({ remainingMinor: 100_000, paidMinor: 0 }));
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100_000, occurredOn: '2026-10-01', debtId: debt.id });
    const pay = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 30_000, occurredOn: '2026-10-09', debtId: debt.id });
    await waitFor(() => expect(result.current?.state).toMatchObject({ remainingMinor: 70_000, paidMinor: 30_000, issuedMinor: 100_000 }));
    expect(result.current?.state.payments.map((p) => p.txId)).toEqual([pay.id]);
    await store.transactions.update(pay.id, { amountMinor: 120_000 });
    await waitFor(() => expect(result.current?.state).toMatchObject({ remainingMinor: 0, overpaidMinor: 20_000, settled: true }));
    await store.transactions.softDelete(pay.id);
    await waitFor(() => expect(result.current?.state).toMatchObject({ remainingMinor: 100_000, paidMinor: 0 }));
    // операция другой валюты (кошелёк другой валюты нельзя привязать через репозиторий — вставляем «как с сервера») в остаток не входит
    const row = (await store.db.transactions.toArray())[0]!;
    await store.db.transactions.put({ ...row, id: 'foreign-1', walletId: usd.id, kind: 'income', amountMinor: 5, debtId: debt.id, deletedAt: null });
    await waitFor(() => expect(result.current?.state.issues).toEqual([expect.objectContaining({ reason: 'foreign-currency', txId: 'foreign-1' })]));
    expect(result.current?.state.paidMinor).toBe(0);
  });

  it('нет такого долга — null (useDebtState) и причина (useDebtView); удалённый тоже', async () => {
    const store = await makeStore();
    const debt = await store.debts.create(debtInput);
    const state = renderHook(() => useDebtState('нет'), { wrapper: wrapperFor(store) });
    const view = renderHook(() => useDebtView('нет'), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(state.result.current).toBeNull());
    await waitFor(() => expect(view.result.current).toEqual({ ok: false, error: 'not-found', message: 'Долг не найден' }));
    await store.db.debts.put({ ...debt, deletedAt: '2026-10-10T00:00:00.000Z' });
    const gone = renderHook(() => useDebtView(debt.id), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(gone.result.current).toMatchObject({ ok: false, error: 'not-found' }));
  });

  it('переполнение сумм не роняет экран: значение с понятным текстом', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const debt = await store.debts.create({ ...debtInput, principalMinor: 1_000_000_000_000_000 });
    const base = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 1_000_000_000_000_000, occurredOn: '2026-10-01', debtId: debt.id });
    for (let i = 0; i < 9; i++) await store.db.transactions.put({ ...base, id: `big-${i}` });
    const { result } = renderHook(() => useDebtView(debt.id), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current).toEqual({ ok: false, error: 'overflow', message: DEBT_OVERFLOW_MESSAGE }));
  });
});

describe('useUpcoming', () => {
  async function setup() {
    const store = await makeStore();
    const k = await basics(store);
    const rule = await store.recurring.create({ kind: 'expense', walletId: k.cash.id, amountMinor: 1_000, frequency: 'weekly', startOn: '2026-10-05', note: 'Интернет' });
    return { store, ...k, rule };
  }

  it('просроченные, сегодняшние и будущие с признаком alreadyExists; живое обновление после проведения и пропуска', async () => {
    const { store, rule } = await setup();
    const { result } = renderHook(() => useUpcoming(10, { today: '2026-10-19', lookbackDays: 10 }), { wrapper: wrapperFor(store) });
    expect(result.current).toBeUndefined();
    const view = () => result.current?.map((i) => [i.date, i.status, i.alreadyExists]);
    await waitFor(() =>
      expect(view()).toEqual([
        ['2026-10-12', 'overdue', false],
        ['2026-10-19', 'due', false],
        ['2026-10-26', 'upcoming', false],
      ]),
    );
    expect(result.current?.every((i) => i.rule.id === rule.id)).toBe(true);
    await store.transactions.createFromRule(rule, '2026-10-12');
    await store.transactions.skipOccurrence(rule, '2026-10-19');
    await waitFor(() =>
      expect(view()).toEqual([
        ['2026-10-12', 'overdue', true],
        ['2026-10-19', 'due', true], // пропуск — тоже «уже есть»
        ['2026-10-26', 'upcoming', false],
      ]),
    );
  });

  it('проведённая операция с изменённой датой всё равно занимает свой «слот» (по id, а не по дате)', async () => {
    const { store, rule } = await setup();
    const t = await store.transactions.createFromRule(rule, '2026-10-12');
    await store.transactions.update(t.id, { occurredOn: '2026-10-14' });
    const { result } = renderHook(() => useUpcoming(0, { today: '2026-10-12', lookbackDays: 0 }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current?.map((i) => [i.date, i.alreadyExists])).toEqual([['2026-10-12', true]]));
  });

  it('архивное правило не показывается; конец расписания учитывается; пусто — пустой список', async () => {
    const { store, rule, cash } = await setup();
    const ended = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5, frequency: 'daily', startOn: '2026-10-01', endOn: '2026-10-20' });
    await store.recurring.archive(rule.id);
    const { result } = renderHook(() => useUpcoming(5, { today: '2026-10-19', lookbackDays: 0 }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current?.map((i) => i.date)).toEqual(['2026-10-19', '2026-10-20']));
    expect(result.current?.every((i) => i.rule.id === ended.id)).toBe(true);
    await store.recurring.archive(ended.id);
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('по умолчанию окно назад — год: давно не проведённый платёж не пропадает', async () => {
    const { store, rule } = await setup();
    const { result } = renderHook(() => useUpcoming(0, { today: '2027-01-04' }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current).toHaveLength(14)); // 5 окт … 4 янв по понедельникам
    expect(result.current?.[0]).toMatchObject({ date: '2026-10-05', status: 'overdue', alreadyExists: false });
    expect(result.current?.at(-1)).toMatchObject({ date: '2027-01-04', status: 'due' });
    expect(await uuidV5(rule.id, '2026-10-05')).toBeTruthy();
  });
});

describe('useTransactions: фильтр по долгу', () => {
  it('отбирает операции долга и обновляется', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const d = await store.debts.create(debtInput);
    const { result } = renderHook(() => useTransactions({ debtId: d.id }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current).toEqual([]));
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 10, occurredOn: '2026-10-01' });
    const linked = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 20, occurredOn: '2026-10-01', debtId: d.id });
    await waitFor(() => expect(result.current?.map((t) => t.id)).toEqual([linked.id]));
  });
});
