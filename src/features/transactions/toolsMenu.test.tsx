import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { resetModalHistoryForTests } from '@/components/modalHistory';
import type { Store } from '@/db';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from './__fixtures__/opsKit';
import TransactionsPage from './TransactionsPage';

beforeEach(() => {
  resetModalHistoryForTests();
  pinToday(); // 15 октября 2026
});
afterEach(() => {
  unpinToday();
  resetModalHistoryForTests();
  vi.restoreAllMocks();
});

/** Одна обычная операция в этом месяце: список не пуст, находок нет. */
async function seedOne(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  const salary = (await s.db.categories.toArray()).find((c) => c.kind === 'income')!.id;
  await s.wallets.update(cash.id, { openingBalanceMinor: 100_000_000 });
  await s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100_000, occurredOn: '2026-10-01', categoryId: salary });
}

async function openOperations(setup: (s: Store) => Promise<void> = seedOne, path = '/transactions') {
  const td = opsDeps([table()], { setup });
  await showApp(
    <>
      <TransactionsPage />
      <LocationProbe />
    </>,
    td,
    path,
  );
  await findByRole('heading', { name: 'Операции', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
}

const menuButton = () => screen.getByRole('button', { name: 'Шаблоны и проверка данных' });

describe('«Операции»: меню «⋯» — шаблоны и проверка данных', () => {
  it('меню открывается из шапки и предлагает «Шаблоны операций» и «Проверка данных»', async () => {
    await openOperations();
    await user.click(await waitFor(menuButton));
    const dialog = await findByRole('dialog', { name: 'Операции' });
    expect(dialog.textContent).toContain('Шаблоны операций');
    expect(dialog.textContent).toContain('Проверка данных');
  });

  it('«Шаблоны операций» ведёт на экран шаблонов', async () => {
    await openOperations();
    await user.click(await waitFor(menuButton));
    await user.click(await findByRole('button', { name: 'Шаблоны операций' }));
    await waitFor(() => expect(currentPath()).toBe('/transactions/templates'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Операции' })).toBeNull());
  });

  it('«Проверка данных» ведёт на экран проверки, даже когда находок нет', async () => {
    await openOperations();
    await user.click(await waitFor(menuButton));
    await user.click(await findByRole('button', { name: 'Проверка данных' }));
    await waitFor(() => expect(currentPath()).toBe('/transactions/check'));
  });

  it('фильтр ничего не нашёл: «Выбрать» и «Выгрузить» пропали, а меню осталось', async () => {
    await openOperations();
    await user.type(await findByRole('textbox', { name: 'Поиск по операциям' }), 'такого-нет');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ничего не найдено' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Выбрать операции' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Выгрузить список в CSV' })).toBeNull();
    expect(menuButton()).toBeTruthy();
  });

  it('операций ещё нет вовсе: «Выбрать» и «Выгрузить» нет, а меню есть (шаблоны заводятся и без операций)', async () => {
    await openOperations(async () => undefined);
    expect(screen.getByRole('heading', { name: 'Операций пока нет' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Выбрать операции' })).toBeNull();
    expect(menuButton()).toBeTruthy();
  });

  it('пока выбираются операции, в шапке только «Готово»', async () => {
    await openOperations();
    await user.click(await findByRole('button', { name: 'Выбрать операции' }));
    expect(screen.getByRole('button', { name: 'Готово' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Шаблоны и проверка данных' })).toBeNull();
  });
});
