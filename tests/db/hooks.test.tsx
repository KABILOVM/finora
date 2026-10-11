import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  StoreProvider,
  useBalances,
  useCategories,
  useMonthSummary,
  useSettings,
  useStore,
  useTransactions,
  useWallets,
  type Store,
  type TxFilter,
} from '@/db';
import { basics, expense, makeStore } from './helpers';
import { renderHook, waitFor } from './renderHook';

const wrapperFor = (store: Store) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <StoreProvider store={store}>{children}</StoreProvider>;
  };

const newWallet = (name: string) => ({ name, currency: 'TJS', kind: 'cash' as const, openingBalanceMinor: 0, color: '#000000', icon: 'x' });

describe('StoreProvider / useStore', () => {
  it('без провайдера — понятная ошибка', () => {
    // React и jsdom шумят в консоль о ожидаемой ошибке — глушим только на время этого теста
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mute = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', mute);
    try {
      expect(() => renderHook(() => useStore())).toThrow(/StoreProvider/);
    } finally {
      window.removeEventListener('error', mute);
      spy.mockRestore();
    }
  });

  it('отдаёт хранилище из контекста', async () => {
    const store = await makeStore();
    const { result } = renderHook(() => useStore(), { wrapper: wrapperFor(store) });
    expect(result.current).toBe(store);
  });
});

describe('useWallets', () => {
  it('undefined пока грузится; затем список; живое обновление после записи', async () => {
    const store = await makeStore();
    const { result } = renderHook(() => useWallets(), { wrapper: wrapperFor(store) });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual([]));
    await store.wallets.create(newWallet('Первый'));
    await waitFor(() => expect(result.current?.map((w) => w.name)).toEqual(['Первый']));
  });

  it('архивные скрыты, если не попросить; удалённые не показываются никогда', async () => {
    const store = await makeStore();
    const a = await store.wallets.create(newWallet('Живой'));
    const b = await store.wallets.create(newWallet('Архивный'));
    const c = await store.wallets.create(newWallet('Удалённый'));
    await store.wallets.archive(b.id);
    await store.db.wallets.update(c.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    const plain = renderHook(() => useWallets(), { wrapper: wrapperFor(store) });
    const all = renderHook(() => useWallets({ includeArchived: true }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(plain.result.current?.map((w) => w.id)).toEqual([a.id]));
    await waitFor(() => expect(all.result.current?.map((w) => w.id)).toEqual([a.id, b.id]));
    await store.wallets.restore(b.id);
    await waitFor(() => expect(plain.result.current?.map((w) => w.id)).toEqual([a.id, b.id]));
  });

  it('порядок: sortOrder, затем название по-русски (Ё после Е, регистр не важен)', async () => {
    const store = await makeStore();
    const names = ['яблоко', 'Ёлка', 'Арбуз', 'елка', 'Банк'];
    for (const n of names) {
      const w = await store.wallets.create(newWallet(n));
      await store.wallets.update(w.id, { sortOrder: 5 });
    }
    const first = await store.wallets.create(newWallet('Последний по имени, первый по порядку'));
    await store.wallets.update(first.id, { sortOrder: 1 });
    const { result } = renderHook(() => useWallets(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current).toHaveLength(6));
    expect(result.current!.map((w) => w.name)).toEqual(['Последний по имени, первый по порядку', 'Арбуз', 'Банк', 'елка', 'Ёлка', 'яблоко']);
  });
});

describe('useCategories', () => {
  it('по виду и с архивными по просьбе', async () => {
    const store = await makeStore();
    const { food, salary } = await basics(store);
    const old = await store.categories.create({ name: 'Старая', kind: 'expense', color: '#000000', icon: 'x' });
    await store.categories.archive(old.id);
    const all = renderHook(() => useCategories(), { wrapper: wrapperFor(store) });
    const exp = renderHook(() => useCategories('expense'), { wrapper: wrapperFor(store) });
    const inc = renderHook(() => useCategories('income'), { wrapper: wrapperFor(store) });
    const expAll = renderHook(() => useCategories('expense', { includeArchived: true }), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(all.result.current?.map((c) => c.id)).toEqual([food.id, salary.id]));
    await waitFor(() => expect(exp.result.current?.map((c) => c.id)).toEqual([food.id]));
    await waitFor(() => expect(inc.result.current?.map((c) => c.id)).toEqual([salary.id]));
    await waitFor(() => expect(expAll.result.current?.map((c) => c.id)).toEqual([food.id, old.id]));
  });
});

describe('useTransactions', () => {
  it('фильтр, порядок «новые сверху», лимит, живое обновление, удалённые скрыты', async () => {
    const store = await makeStore();
    const { cash, usd, food } = await basics(store);
    const t1 = await expense(store, cash.id, 100, { occurredOn: '2026-10-01', categoryId: food.id, note: 'Хлеб' });
    const t2 = await expense(store, cash.id, 200, { occurredOn: '2026-10-03' });
    const t3 = await expense(store, usd.id, 300, { occurredOn: '2026-10-02', fx: { rate: 10, source: 'manual' } });

    const all = renderHook(() => useTransactions(), { wrapper: wrapperFor(store) });
    const limited = renderHook(() => useTransactions({}, { limit: 2 }), { wrapper: wrapperFor(store) });
    const byWallet = renderHook(() => useTransactions({ walletId: usd.id }), { wrapper: wrapperFor(store) });
    const period = renderHook(() => useTransactions({ from: '2026-10-02', to: '2026-10-03' }), { wrapper: wrapperFor(store) });
    const search = renderHook(() => useTransactions({ search: 'хлеб' }), { wrapper: wrapperFor(store) });

    await waitFor(() => expect(all.result.current?.map((t) => t.id)).toEqual([t2.id, t3.id, t1.id]));
    await waitFor(() => expect(limited.result.current?.map((t) => t.id)).toEqual([t2.id, t3.id]));
    await waitFor(() => expect(byWallet.result.current?.map((t) => t.id)).toEqual([t3.id]));
    await waitFor(() => expect(period.result.current?.map((t) => t.id)).toEqual([t2.id, t3.id]));
    await waitFor(() => expect(search.result.current?.map((t) => t.id)).toEqual([t1.id]));

    await store.transactions.softDelete(t2.id);
    await waitFor(() => expect(all.result.current?.map((t) => t.id)).toEqual([t3.id, t1.id]));
    await waitFor(() => expect(limited.result.current?.map((t) => t.id)).toEqual([t3.id, t1.id]));
  });

  it('«без категории» (null) и «любая» (не задана) — разные запросы; смена фильтра обновляет результат', async () => {
    const store = await makeStore();
    const { cash, food } = await basics(store);
    const withCat = await expense(store, cash.id, 100, { categoryId: food.id });
    const noCat = await expense(store, cash.id, 200);
    const { result, rerender } = renderHook(({ filter }: { filter: TxFilter }) => useTransactions(filter), {
      wrapper: wrapperFor(store),
      initialProps: { filter: {} as TxFilter },
    });
    await waitFor(() => expect(result.current).toHaveLength(2));
    rerender({ filter: { categoryId: null } });
    await waitFor(() => expect(result.current?.map((t) => t.id)).toEqual([noCat.id]));
    rerender({ filter: { categoryId: food.id } });
    await waitFor(() => expect(result.current?.map((t) => t.id)).toEqual([withCat.id]));
    rerender({ filter: {} });
    await waitFor(() => expect(result.current).toHaveLength(2));
  });
});

describe('useBalances', () => {
  it('начальный остаток ± живые операции и переводы; обновляется; удалённые не считаются', async () => {
    const store = await makeStore();
    const { cash, usd, salary } = await basics(store); // нал: 1000,00 сомони
    const { result } = renderHook(() => useBalances(), { wrapper: wrapperFor(store) });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.get(cash.id)).toBe(100_000));

    const spent = await expense(store, cash.id, 2_500);
    await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 10_000, categoryId: salary.id, occurredOn: '2026-10-05' });
    await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 10_900, toAmountMinor: 1_000, occurredOn: '2026-10-05' });
    await waitFor(() => expect(result.current?.get(cash.id)).toBe(100_000 - 2_500 + 10_000 - 10_900));
    expect(result.current?.get(usd.id)).toBe(1_000);

    await store.transactions.softDelete(spent.id);
    await waitFor(() => expect(result.current?.get(cash.id)).toBe(100_000 + 10_000 - 10_900));
  });

  it('архивный кошелёк остаётся в остатках', async () => {
    const store = await makeStore();
    const { usd } = await basics(store);
    await store.wallets.archive(usd.id);
    const { result } = renderHook(() => useBalances(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current?.has(usd.id)).toBe(true));
  });
});

describe('useSettings / useMonthSummary', () => {
  it('useSettings: undefined → null (нет настроек) → строка после затравки', async () => {
    const store = await makeStore();
    const { result } = renderHook(() => useSettings(), { wrapper: wrapperFor(store) });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBeNull());
    await store.settings.ensure({ baseCurrency: 'USD' });
    await waitFor(() => expect(result.current?.baseCurrency).toBe('USD'));
    await store.settings.update({ weekStartsOn: 0 });
    await waitFor(() => expect(result.current?.weekStartsOn).toBe(0));
  });

  it('useMonthSummary: null без настроек; итоги по снимкам; обновляется', async () => {
    const store = await makeStore();
    const { result } = renderHook(() => useMonthSummary('2026-10'), { wrapper: wrapperFor(store) });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBeNull());

    const { cash, usd, food, salary } = await basics(store);
    await expense(store, cash.id, 3_000, { categoryId: food.id });
    await expense(store, usd.id, 1_000, { categoryId: food.id, fx: { rate: 10, source: 'manual' } }); // 100,00 сомони
    await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 50_000, categoryId: salary.id, occurredOn: '2026-10-01' });
    await expense(store, cash.id, 777, { occurredOn: '2026-09-30' });
    await waitFor(() => expect(result.current).toEqual({
      incomeMinor: 50_000,
      expenseMinor: 13_000,
      byCategory: [{ categoryId: food.id, totalMinor: 13_000 }],
      excludedCount: 0,
    }));

    await store.settings.update({ baseCurrency: 'USD' }); // снимки в TJS теперь «чужие»
    await waitFor(() => expect(result.current).toMatchObject({ incomeMinor: 0, expenseMinor: 0, excludedCount: 3 }));
  });
});
