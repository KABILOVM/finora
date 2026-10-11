import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, waitFor } from '@/components/testUtils';
import { opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import HomePage from '@/features/home/HomePage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

describe('комиссия перевода на главном экране', () => {
  it('строка комиссии подписана «Комиссии», а не «Без категории»; ключи строк не совпадают с расходом без категории', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.map(String).join(' ')));
    const td = opsDeps([table()], {
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray())[0]!;
        const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
        await s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
        await s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-10-06' });
      },
    });
    await showApp(<HomePage />, td, '/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    const card = document.querySelector('[aria-label="Итоги месяца"]')!;
    await waitFor(() => expect(card.textContent).toContain('Расходы по категориям'));
    const text = card.textContent ?? '';
    expect(text).toContain('Комиссии');
    expect((text.match(/Без категории/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(errors.filter((e) => /same key|unique "key"/i.test(e))).toEqual([]);
    spy.mockRestore();
  });
});
