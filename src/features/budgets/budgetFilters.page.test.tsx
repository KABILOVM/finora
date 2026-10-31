import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { choose, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import BudgetsPage from './BudgetsPage';

/** «Сегодня» = четверг 15 октября 2026, основная валюта TJS. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

/**
 * Три лимита и общий: Еда 1 000 (потрачено 400 — в норме), Транспорт 120 (потрачено 100 — внимание),
 * Развлечения 50 (потрачено 60 — исчерпан), общий лимит 5 000 (потрачено 560 — в норме).
 */
async function setup(s: Store, opts: { withTotal?: boolean } = {}) {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const cats = new Map((await s.db.categories.toArray()).filter((c) => c.kind === 'expense').map((c) => [c.name, c.id] as const));
  const spend = async (name: string, amountMinor: number) =>
    void (await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor, categoryId: cats.get(name) ?? null, occurredOn: '2026-10-10' }));
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 900_000, categoryId: null, occurredOn: '2026-10-01' });
  await spend('Еда', 40_000);
  await spend('Транспорт', 10_000);
  await spend('Развлечения', 6_000);
  await s.budgets.create({ categoryId: cats.get('Еда') ?? null, amountMinor: 100_000 });
  await s.budgets.create({ categoryId: cats.get('Транспорт') ?? null, amountMinor: 12_000 });
  await s.budgets.create({ categoryId: cats.get('Развлечения') ?? null, amountMinor: 5_000 });
  if (opts.withTotal) await s.budgets.create({ categoryId: null, amountMinor: 500_000 });
}

async function openPage(setupFn?: (s: Store) => Promise<void>) {
  const td = opsDeps([table()], { setup: setupFn });
  await showApp(
    <>
      <BudgetsPage />
      <LocationProbe />
    </>,
    td,
    '/budgets',
  );
  await findByRole('heading', { name: 'Бюджеты', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return td;
}

const rows = () => screen.queryAllByRole('button', { name: /^Лимит «/ }).map((b) => /^Лимит «([^»]+)»/.exec(b.getAttribute('aria-label') ?? b.textContent ?? '')?.[1] ?? '');
const filtersButton = () => screen.getByRole('button', { name: /^Фильтры/ });
const apply = () => user.click(screen.getByRole('button', { name: 'Применить' }));

describe('экран «Бюджеты»: фильтры списка лимитов', () => {
  it('с одним лимитом (или без) панели фильтров нет', async () => {
    await openPage(async (s) => {
      const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense');
      await s.budgets.create({ categoryId: food?.id ?? null, amountMinor: 100_000 });
    });
    expect(screen.queryByRole('button', { name: /^Фильтры/ })).toBeNull();
  });

  it('по категории: остаётся один лимит, сводка над списком не меняется, «Сбросить» возвращает всё', async () => {
    await openPage((s) => setup(s));
    expect(rows().sort()).toEqual(['Еда', 'Развлечения', 'Транспорт']);
    const chips = () => screen.getByRole('list', { name: 'Сводка по лимитам' }).textContent;
    const before = chips();

    await user.click(filtersButton());
    choose('Категория', 'Еда');
    await apply();

    await waitFor(() => expect(rows()).toEqual(['Еда']));
    expect(chips()).toBe(before); // сводка считается по всем лимитам
    expect(screen.getByRole('button', { name: 'Фильтры, включено: 1' })).toBeTruthy();
    expect(document.querySelector('[data-testid="active-filters"]')?.textContent).toContain('Еда');

    await user.click(screen.getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(document.querySelector('[data-testid="active-filters"]')).toBeNull();
  });

  it('по состоянию: «Исчерпано» и «Внимание» (почти исчерпан входит во «Внимание»)', async () => {
    await openPage((s) => setup(s));
    await user.click(filtersButton());
    await user.click(screen.getByRole('button', { name: 'Исчерпано' }));
    await apply();
    await waitFor(() => expect(rows()).toEqual(['Развлечения']));

    await user.click(filtersButton());
    await user.click(screen.getByRole('button', { name: 'Внимание' }));
    await apply();
    await waitFor(() => expect(rows()).toEqual(['Транспорт']));
  });

  it('общий лимит выбирается как «Все расходы»; «Без лимита» при фильтре скрыт', async () => {
    await openPage(async (s) => {
      await setup(s, { withTotal: true });
      // расход без лимитной категории: он попадает в строку «Без лимита»
      const cash = (await s.db.wallets.toArray())[0]?.id ?? '';
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_000, categoryId: null, occurredOn: '2026-10-11' });
    });
    expect(screen.getByText('Без лимита')).toBeTruthy();
    await user.click(filtersButton());
    choose('Категория', 'Все расходы');
    await apply();
    await waitFor(() => expect(rows()).toEqual(['Все расходы']));
    expect(screen.queryByText('Без лимита')).toBeNull();
  });

  it('ничего не подошло: понятное сообщение и «Сбросить фильтры»', async () => {
    await openPage((s) => setup(s));
    await user.click(filtersButton());
    choose('Категория', 'Еда');
    await user.click(screen.getByRole('button', { name: 'Исчерпано' })); // Еда в норме → пусто
    await apply();
    await waitFor(() => expect(document.querySelector('[data-testid="budgets-filter-empty"]')).not.toBeNull());
    expect(document.querySelector('[data-testid="budgets-filter-empty"]')?.textContent).toContain('Нет лимитов, подходящих под выбранные фильтры');
    expect(rows()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('закрыли шит без «Применить» — список прежний', async () => {
    await openPage((s) => setup(s));
    await user.click(filtersButton());
    choose('Категория', 'Еда');
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rows()).toHaveLength(3);
  });
});
