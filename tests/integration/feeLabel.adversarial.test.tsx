import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, waitFor } from '@/components/testUtils';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import AnalyticsPage from '@/features/analytics/AnalyticsPage';
import HomePage from '@/features/home/HomePage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** Свежая база на каждый тест (данные заводятся при открытии базы). Перевод Наличные → Карта: ушло 100, пришло 98 (комиссия 2 с.), 5 октября; и расход 50 с. без категории 6 октября. */
const feeAndUncategorized = () =>
  opsDeps([table()], {
    setup: async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!;
      const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
      await s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
      await s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-10-06' });
    },
  });

describe('комиссия перевода в расходах по категориям', () => {
  it('«Аналитика»: строка комиссии подписана «Комиссии», а не «Без категории»; ключи строк не совпадают с расходом без категории', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.map(String).join(' ')));
    await showApp(<AnalyticsPage />, feeAndUncategorized(), '/analytics');
    await findByRole('heading', { name: 'Аналитика', level: 1 });
    await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
    const list = await waitFor(() => screen.getByRole('list', { name: 'Расходы по категориям' }));

    // две разные строки: комиссия (ключ «fee») и расход без категории (ключ «none»)
    const fee = tid('compare-fee');
    const none = tid('compare-none');
    expect(fee).not.toBeNull();
    expect(none).not.toBeNull();
    expect(fee).not.toBe(none);
    expect(norm(fee!.textContent)).toContain('Комиссии');
    expect(norm(fee!.textContent)).toContain(fmt(200));
    expect(norm(fee!.textContent)).not.toContain('Без категории');
    expect(norm(none!.textContent)).toContain('Без категории');
    expect(norm(none!.textContent)).toContain(fmt(5_000));
    expect(norm(none!.textContent)).not.toContain('Комиссии');
    // каждая подпись встречается в списке один раз; комиссия не «растворилась» в расходе без категории (50 + 2 = 52)
    expect((list.textContent?.match(/Комиссии/g) ?? []).length).toBe(1);
    expect((list.textContent?.match(/Без категории/g) ?? []).length).toBe(1);
    expect(list.textContent).not.toContain(fmt(5_200));
    // и ведут они в разные места: комиссия — к переводам месяца, без категории — к расходам без категории
    expect(fee!.getAttribute('href')).toBe('/transactions?month=2026-10&kind=transfer');
    expect(none!.getAttribute('href')).toBe('/transactions?month=2026-10&category=none&kind=expense');
    expect(errors.filter((e) => /same key|unique "key"/i.test(e))).toEqual([]);
    spy.mockRestore();
  });

  it('«Аналитика»: пользовательская категория с именем «Комиссии» не сливается со строкой комиссий переводов — две строки, свои суммы и ссылки', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.map(String).join(' ')));
    let ownId = '';
    const td = opsDeps([table()], {
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray())[0]!;
        const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
        ownId = (await s.categories.create({ name: 'Комиссии', kind: 'expense', color: '#ef4444', icon: '💸' })).id;
        await s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
        await s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 3_000, categoryId: ownId, occurredOn: '2026-10-06' });
      },
    });
    await showApp(<AnalyticsPage />, td, '/analytics');
    await findByRole('heading', { name: 'Аналитика', level: 1 });
    await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
    const list = await waitFor(() => screen.getByRole('list', { name: 'Расходы по категориям' }));

    const fee = tid('compare-fee');
    const own = tid(`compare-${ownId}`);
    expect(fee).not.toBeNull();
    expect(own).not.toBeNull();
    expect(fee).not.toBe(own);
    expect(list.querySelectorAll('li')).toHaveLength(2); // не одна «слитая» строка на 32 с.
    expect(norm(fee!.textContent)).toContain(fmt(200));
    expect(norm(own!.textContent)).toContain(fmt(3_000));
    expect(norm(fee!.textContent)).not.toContain(fmt(3_000));
    expect(norm(own!.textContent)).not.toContain(fmt(200));
    expect(list.textContent).not.toContain(fmt(3_200));
    expect(fee!.getAttribute('href')).toBe('/transactions?month=2026-10&kind=transfer');
    expect(own!.getAttribute('href')).toBe(`/transactions?month=2026-10&category=${ownId}&kind=expense`);
    expect(errors.filter((e) => /same key|unique "key"/i.test(e))).toEqual([]);
    spy.mockRestore();
  });

  it('«Главная»: комиссия входит в расход месяца в капсуле (50 + 2 = 52), перевод сам по себе — нет', async () => {
    await showApp(<HomePage />, feeAndUncategorized(), '/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    await waitFor(() => expect(norm(tid('home-flow-expense')?.textContent)).toBe(norm(formatMinor(-5_200, 'TJS'))));
    expect(norm(tid('home-flow-income')?.textContent)).toBe(norm(formatMinor(0, 'TJS', { sign: 'always' })));
  });
});
