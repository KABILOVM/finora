import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, waitFor } from '@/components/testUtils';
import type { CategoryTotal, Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { sharePercent, topCategories } from './homeData';
import HomePage from './HomePage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));

describe('topCategories: строка комиссий (kind: "fee")', () => {
  const fee = (totalMinor: number): CategoryTotal => ({ categoryId: null, totalMinor, kind: 'fee' });
  const none = (totalMinor: number): CategoryTotal => ({ categoryId: null, totalMinor });
  const cat = (id: string, totalMinor: number): CategoryTotal => ({ categoryId: id, totalMinor });

  it('комиссии и «без категории» — разные строки, обе остаются в топе', () => {
    const { top, restCount } = topCategories([cat('a', 500), none(300), fee(200)]);
    expect(top).toHaveLength(3);
    expect(top.filter((r) => r.kind === 'fee')).toHaveLength(1);
    expect(top.filter((r) => r.categoryId === null && r.kind === undefined)).toHaveLength(1);
    expect(restCount).toBe(0);
  });

  it('комиссии вне топ-5 идут в «ещё» вместе с остальными, сумма не теряется', () => {
    const rows = [cat('a', 600), cat('b', 500), cat('c', 400), cat('d', 300), cat('e', 200), fee(100), none(50)];
    const bars = topCategories(rows);
    expect(bars.top).toHaveLength(5);
    expect(bars.restCount).toBe(2);
    expect(bars.restMinor).toBe(150);
  });

  it('доля комиссий считается от всех расходов; нулевой итог не даёт NaN', () => {
    expect(sharePercent(200, 2450)).toBe(8);
    expect(sharePercent(0, 0)).toBe(0);
    expect(sharePercent(200, 0)).toBe(0);
  });
});

async function openHome(setup: (s: Store) => Promise<void>) {
  const td = opsDeps([table()], { setup });
  await showApp(
    <>
      <HomePage />
      <LocationProbe />
    </>,
    td,
    '/',
  );
  await findByRole('heading', { name: 'Главная', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
}

const rows = (): string[] =>
  Array.from(document.querySelectorAll('[aria-label="Итоги месяца"] h3 + ul > li')).map((li) => norm(li.textContent));

async function twoWallets(s: Store) {
  const cash = (await s.db.wallets.toArray())[0]?.id ?? '';
  const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  return { cash, card };
}

describe('«Расходы по категориям» на «Главной»: комиссия перевода', () => {
  it('комиссия называется «Комиссии» и не сливается с «Без категории»', async () => {
    await openHome(async (s) => {
      const { cash, card } = await twoWallets(s);
      const food = (await s.db.categories.toArray()).find((c) => c.kind === 'expense' && c.name === 'Еда');
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1250, categoryId: food?.id ?? null, occurredOn: '2026-10-15' });
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1000, occurredOn: '2026-10-14' }); // без категории
      // перевод 100 с. → получено 98 с.: комиссия 2 с.
      await s.transactions.create({ kind: 'transfer', walletId: cash, toWalletId: card, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-13' });
    });
    const list = rows();
    expect(list).toHaveLength(3);
    expect(list[0]).toContain('Еда');
    expect(list[0]).toContain(fmt(1250));
    expect(list[1]).toContain('Без категории');
    expect(list[1]).toContain(fmt(1000));
    expect(list[1]).not.toContain('Комиссии');
    expect(list[2]).toContain('Комиссии');
    expect(list[2]).toContain(fmt(200));
    expect(list[2]).toContain('8%'); // 200 из 2 450
    expect(list[2]).not.toContain('Без категории');
  });

  it('только комиссия: единственная строка «Комиссии» на 100%, «Без категории» нет', async () => {
    await openHome(async (s) => {
      const { cash, card } = await twoWallets(s);
      await s.transactions.create({ kind: 'transfer', walletId: cash, toWalletId: card, amountMinor: 5_000, toAmountMinor: 4_900, occurredOn: '2026-10-15' });
    });
    const list = rows();
    expect(list).toHaveLength(1);
    expect(list[0]).toContain('Комиссии');
    expect(list[0]).toContain(fmt(100));
    expect(list[0]).toContain('100%');
    expect(document.body.textContent).not.toContain('Без категории');
    // комиссия — расход месяца
    const card = document.querySelector('[aria-label="Итоги месяца"]');
    const expense = Array.from(card?.querySelectorAll('dt') ?? []).find((x) => norm(x.textContent) === 'Расходы');
    expect(norm(expense?.nextElementSibling?.textContent)).toBe(norm(formatMinor(-100, 'TJS')));
  });

  it('перевод без комиссии строку «Комиссии» не создаёт', async () => {
    await openHome(async (s) => {
      const { cash, card } = await twoWallets(s);
      await s.transactions.create({ kind: 'transfer', walletId: cash, toWalletId: card, amountMinor: 5_000, toAmountMinor: 5_000, occurredOn: '2026-10-15' });
    });
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Комиссии');
  });
});
