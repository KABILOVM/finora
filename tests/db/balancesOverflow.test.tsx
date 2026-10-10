import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BALANCES_OVERFLOW_MESSAGE, StoreProvider, useBalances, useBalancesState, type Store } from '@/db';
import { AMOUNT_MAX } from '@/db/validate';
import { basics, makeStore } from './helpers';
import { renderHook, waitFor } from './renderHook';

/**
 * computeBalances при переполнении суммы бросает RangeError. Через useLiveQuery это роняло экран (ошибка пробрасывается
 * в отрисовку). Теперь хук ловит её и отдаёт понятный признак; старый useBalances не падает.
 */

const wrapperFor = (store: Store) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <StoreProvider store={store}>{children}</StoreProvider>;
  };

/** Кошелёк с начальным остатком 1e15 и 9 доходами по 1e15: итог 1e16 > 9,007e15 (предел безопасного целого). Каждая запись сама по себе допустима. */
async function overflowing(store: Store) {
  const { cash, salary } = await basics(store);
  await store.wallets.update(cash.id, { openingBalanceMinor: AMOUNT_MAX });
  for (let i = 0; i < 9; i++) {
    await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: AMOUNT_MAX, categoryId: salary.id, occurredOn: '2026-10-05' });
  }
  return { cash, salary };
}

describe('useBalancesState', () => {
  it('обычные данные: ok, остатки как у useBalances', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const { result } = renderHook(() => useBalancesState(), { wrapper: wrapperFor(store) });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.ok).toBe(true));
    const state = result.current;
    if (!state?.ok) throw new Error('ожидались остатки');
    expect(state.balances.get(cash.id)).toBe(100_000);
  });

  it('переполнение суммы: экран не падает, вместо остатков понятный признак и текст для человека', async () => {
    const store = await makeStore();
    await overflowing(store);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { result } = renderHook(() => useBalancesState(), { wrapper: wrapperFor(store) });
      await waitFor(() => expect(result.current).toBeDefined());
      expect(result.current).toEqual({ ok: false, error: 'overflow', message: 'Сумма слишком большая, проверьте данные' });
      expect(BALANCES_OVERFLOW_MESSAGE).toBe('Сумма слишком большая, проверьте данные');
    } finally {
      spy.mockRestore();
    }
  });

  it('признак исчезает, когда данные исправлены (лишний доход удалён), и остатки возвращаются', async () => {
    const store = await makeStore();
    const { cash } = await overflowing(store);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { result } = renderHook(() => useBalancesState(), { wrapper: wrapperFor(store) });
      await waitFor(() => expect(result.current?.ok).toBe(false));
      const incomes = await store.db.transactions.toArray();
      for (const t of incomes.slice(0, 5)) await store.transactions.softDelete(t.id);
      await waitFor(() => {
        const state = result.current;
        expect(state?.ok && state.balances.get(cash.id)).toBe(AMOUNT_MAX * 5); // начальный остаток + 4 оставшихся дохода
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('useBalances (прежний API) при переполнении', () => {
  it('не бросает и не роняет отрисовку: остаётся «считается» (undefined), а не нули вместо денег', async () => {
    const store = await makeStore();
    await overflowing(store);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const errors: ErrorEvent[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      const state = renderHook(() => useBalancesState(), { wrapper: wrapperFor(store) });
      const { result } = renderHook(() => useBalances(), { wrapper: wrapperFor(store) });
      await waitFor(() => expect(state.result.current?.ok).toBe(false)); // расчёт уже закончился
      expect(result.current).toBeUndefined();
      expect(errors).toHaveLength(0);
    } finally {
      window.removeEventListener('error', onError);
      spy.mockRestore();
    }
  });

  it('без переполнения работает как раньше', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const { result } = renderHook(() => useBalances(), { wrapper: wrapperFor(store) });
    await waitFor(() => expect(result.current?.get(cash.id)).toBe(100_000));
  });
});
