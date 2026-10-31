import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { choose, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import AnalyticsPage from './AnalyticsPage';

/** «Сегодня» = четверг 15 октября 2026. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** 2026: Еда 120 (в том числе подкатегория «Кафе» 20), Транспорт 30, Продукты 50 — всего расходов 200; доход 3 000. */
async function seed(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const cats = await s.db.categories.toArray();
  const cat = (name: string, kind: 'expense' | 'income' = 'expense') => cats.find((c) => c.name === name && c.kind === kind)!;
  const cafe = await s.categories.create({ name: 'Кафе', kind: 'expense', parentId: cat('Еда').id, color: '#f97316', icon: '☕' });
  const add = (kind: 'expense' | 'income', amountMinor: number, categoryId: string, occurredOn: string) =>
    s.transactions.create({ kind, walletId: cash, amountMinor, categoryId, occurredOn });
  await add('income', 300_000, cat('Зарплата', 'income').id, '2026-02-01');
  await add('expense', 10_000, cat('Еда').id, '2026-02-10');
  await add('expense', 2_000, cafe.id, '2026-03-10');
  await add('expense', 3_000, cat('Транспорт').id, '2026-08-05');
  await add('expense', 5_000, cat('Продукты').id, '2026-10-02');
}

async function openPeriods() {
  const td = opsDeps([table()], { setup: seed });
  await showApp(
    <>
      <AnalyticsPage />
      <LocationProbe />
    </>,
    td,
    '/analytics?tab=periods',
  );
  await findByRole('heading', { name: 'Аналитика', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return td;
}

const expenseRows = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="expense-cat-"]')).map((li) => norm(li.querySelector('.truncate')?.textContent));
const filtersButton = () => screen.getByRole('button', { name: /^Фильтры/ });

describe('«Аналитика → Периоды»: фильтр по категории расходов', () => {
  it('сужает список «Расходы по категориям», доли остаются от всех расходов периода', async () => {
    await openPeriods();
    await waitFor(() => expect(expenseRows().length).toBe(4));
    expect(expenseRows().sort()).toEqual(['Еда', 'Кафе', 'Продукты', 'Транспорт'].sort());
    expect(tid('period-filter-note')).toBeNull();

    await user.click(filtersButton());
    choose('Категория', 'Еда');
    await user.click(screen.getByRole('button', { name: 'Применить' }));

    // «Еда» охватывает и подкатегорию «Кафе»
    await waitFor(() => expect(expenseRows().sort()).toEqual(['Еда', 'Кафе']));
    expect(norm(tid('period-filter-note')?.textContent)).toContain('Только «Еда»');
    expect(norm(tid('period-filter-note')?.textContent)).toContain('Доли — от всех расходов периода');
    // доля «Еды» — 100 из 200 расходов, то есть 50 %, а не 100 % от отфильтрованного
    const food = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="expense-cat-"]')).find((li) => li.textContent?.includes('Еда'));
    expect(norm(food?.textContent)).toContain('50%');
    expect(screen.getByRole('button', { name: 'Фильтры, включено: 1' })).toBeTruthy();
  });

  it('«Сбросить» возвращает все категории; итоги периода фильтр не трогает', async () => {
    await openPeriods();
    await waitFor(() => expect(expenseRows().length).toBe(4));
    const summaryBefore = norm(document.querySelector('main')?.textContent?.slice(0, 400));

    await user.click(filtersButton());
    choose('Категория', 'Транспорт');
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(expenseRows()).toEqual(['Транспорт']));
    expect(norm(document.querySelector('main')?.textContent?.slice(0, 400))).toBe(summaryBefore);

    await user.click(screen.getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(expenseRows().length).toBe(4));
    expect(tid('period-filter-note')).toBeNull();
  });
});
