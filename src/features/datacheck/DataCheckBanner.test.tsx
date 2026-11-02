import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import TransactionsPage from '@/features/transactions/TransactionsPage';
import { dismissKey, forgetDismissedCache } from '@/lib/dismissedKeys';
import { DATACHECK_NAMESPACE } from './dataCheck';

beforeEach(() => {
  localStorage.clear();
  forgetDismissedCache();
  pinToday(); // 15 октября 2026
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetDismissedCache();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const banner = () => document.querySelector<HTMLElement>('[data-testid="datacheck-banner"]');

/** Дубль «кофе» и расход без категории: две находки; денег на кошельке достаточно, чтобы остаток в минус не ушёл. */
async function seedFindings(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
  await s.wallets.update(cash.id, { openingBalanceMinor: 100_000_000 });
  const add = (amountMinor: number, occurredOn: string, over: Record<string, unknown> = {}) =>
    s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor, categoryId: food, occurredOn, ...over });
  await add(1_500, '2026-10-10', { note: 'кофе' });
  await add(1_500, '2026-10-10', { note: 'кофе' });
  await add(500, '2026-10-12', { categoryId: null, note: 'киоск' });
}

/** Всё в порядке: одна обычная операция. */
async function seedClean(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  const salary = (await s.db.categories.toArray()).find((c) => c.kind === 'income')!.id;
  await s.wallets.update(cash.id, { openingBalanceMinor: 100_000_000 });
  await s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100_000, occurredOn: '2026-10-01', categoryId: salary });
}

async function openOperations(setup: (s: Store) => Promise<void>) {
  const td = opsDeps([table()], { setup });
  await showApp(
    <>
      <TransactionsPage />
      <LocationProbe />
    </>,
    td,
    '/transactions',
  );
  await findByRole('heading', { name: 'Операции', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

describe('«Операции»: вход в «Проверку данных»', () => {
  it('плашка показывает, сколько пунктов найдено и каких, и ведёт на экран проверки', async () => {
    await openOperations(seedFindings);
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(banner()!.textContent).toContain('Проверка данных');
    expect(banner()!.textContent).toContain('2 пункта: дубли, без категории');
    expect(banner()!.getAttribute('href')).toBe('/transactions/check');
    await user.click(banner()!);
    await waitFor(() => expect(currentPath()).toBe('/transactions/check'));
  });

  it('когда всё отмечено «Это нормально», плашка уходит, а меню «⋯» в шапке остаётся', async () => {
    const td = await openOperations(async (s) => {
      await seedClean(s);
      await s.wallets.create({ name: 'Кредитка', currency: 'TJS', kind: 'card', openingBalanceMinor: -5_000, color: '#2563eb', icon: '💳' });
    });
    await waitFor(() => expect(norm(banner()?.textContent)).toContain('1 пункт:')); // плашка была: ноль ниже — не «ещё не прочитали»
    const credit = (await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Кредитка')!;
    dismissKey(DATACHECK_NAMESPACE, storeOf(td).userId, `neg:${credit.id}`);
    await waitFor(() => expect(banner()).toBeNull());
    expect(screen.getByRole('button', { name: 'Шаблоны и проверка данных' })).toBeTruthy();
  });

  it('отмеченное «Это нормально» не считается: число в плашке то же, что на экране; всё отмечено — плашка уходит', async () => {
    const td = await openOperations(async (s) => {
      await seedClean(s);
      await s.wallets.create({ name: 'Кредитка', currency: 'TJS', kind: 'card', openingBalanceMinor: -5_000, color: '#2563eb', icon: '💳' });
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
      await s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 700, categoryId: null, occurredOn: '2026-10-12', note: 'киоск' });
    });
    await waitFor(() => expect(norm(banner()?.textContent)).toContain('2 пункта'));
    const credit = (await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Кредитка')!;
    dismissKey(DATACHECK_NAMESPACE, storeOf(td).userId, `neg:${credit.id}`);
    await waitFor(() => expect(norm(banner()?.textContent)).toContain('1 пункт:'));
    expect(norm(banner()!.textContent)).not.toContain('пункта');
    expect(norm(banner()!.textContent)).toContain('без категории');
    expect(norm(banner()!.textContent)).not.toContain('минусе');
  });

  it('пока человек выбирает операции, плашки нет (не мешает и не ловит случайное касание)', async () => {
    await openOperations(seedFindings);
    await waitFor(() => expect(banner()).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Выбрать операции' }));
    await waitFor(() => expect(banner()).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(banner()).not.toBeNull());
  });

  it('без операций (пустой список) плашки нет', async () => {
    await openOperations(async () => undefined);
    expect(banner()).toBeNull();
  });
});
