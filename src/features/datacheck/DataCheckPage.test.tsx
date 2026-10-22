import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { eventually } from '@/app/testkit';
import { forgetDismissedCache } from '@/lib/dismissedKeys';
import DataCheckPage from './DataCheckPage';

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
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => norm(tid(id)?.textContent);

/** Всё сразу: дубль «кофе», расход без категории, операция в 2062 году, трата с лишним нулём и кошелёк в минусе. */
async function seedProblems(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  const cats = await s.db.categories.toArray();
  const food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
  await s.wallets.update(cash.id, { openingBalanceMinor: 100_000_000 }); // чтобы «Наличные» в минус не ушли
  await s.wallets.create({ name: 'Кредитка', currency: 'TJS', kind: 'card', openingBalanceMinor: -5_000, color: '#2563eb', icon: '💳' });
  const add = (amountMinor: number, occurredOn: string, over: Record<string, unknown> = {}) =>
    s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor, categoryId: food, occurredOn, ...over });
  for (const d of ['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10']) await add(1_000, d);
  await add(1_500, '2026-10-10', { note: 'кофе' });
  await add(1_500, '2026-10-10', { note: 'кофе' });
  await add(500, '2026-10-12', { categoryId: null, note: 'киоск' });
  await add(700, '2062-10-15', { note: 'опечатка в годе' });
  await add(200_000, '2026-10-11', { note: 'обед' });
}

async function openPage(setup: (s: Store) => Promise<unknown> = seedProblems) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(
    <>
      <DataCheckPage />
      <LocationProbe />
    </>,
    td,
    '/settings/data-check',
  );
  await findByRole('heading', { name: 'Проверка данных', level: 1 });
  await waitFor(() => expect(screen.queryByText('Проверяем…')).toBeNull());
  return td;
}

describe('«Проверка данных»', () => {
  it('показывает все пять видов находок', async () => {
    await openPage();
    await waitFor(() => expect(tid('datacheck-summary')).not.toBeNull());
    expect(text('datacheck-summary')).toContain('Найдено: 5 пунктов');

    expect(text('check-dupes')).toContain('кофе');
    expect(text('check-dupes')).toContain('× 2');
    expect(text('check-uncategorized')).toContain('Без категории · 1');
    expect(text('check-uncategorized')).toContain('киоск');
    expect(text('check-future')).toContain('опечатка в годе');
    expect(text('check-future')).toContain('Дата в будущем');
    expect(text('check-outliers')).toContain('обед');
    expect(text('check-outliers')).toContain(fmt(200_000));
    expect(text('check-negative')).toContain('Кредитка');
    expect(text('check-negative')).toContain('−50');
  });

  it('«Это нормально» убирает находку и помнит об этом на устройстве', async () => {
    const td = await openPage();
    await waitFor(() => expect(tid('check-negative')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Это нормально: Кредитка' }));
    await waitFor(() => expect(tid('check-negative')).toBeNull());
    expect(text('datacheck-summary')).toContain('Найдено: 4 пункта');
    expect(localStorage.getItem(`finora:dismissed:datacheck:${td.stores[0]!.userId}`)).toContain('neg:');
  });

  it('«Удалить лишнюю» оставляет одну трату из дубля; «Отменить» возвращает', async () => {
    const td = await openPage();
    const s = td.stores[0]!;
    await user.click(await findByRole('button', { name: 'Удалить лишнюю: кофе' }));
    await eventually(async () => expect((await s.db.transactions.toArray()).filter((t) => t.note === 'кофе' && t.deletedAt === null)).toHaveLength(1));
    await waitFor(() => expect(tid('check-dupes')).toBeNull());
    await user.click(await findByRole('button', { name: 'Отменить' }));
    await eventually(async () => expect((await s.db.transactions.toArray()).filter((t) => t.note === 'кофе' && t.deletedAt === null)).toHaveLength(2));
    await waitFor(() => expect(tid('check-dupes')).not.toBeNull());
  });

  it('«Открыть» ведёт к правке операции, «Открыть кошелёк» — к кошельку', async () => {
    const td = await openPage();
    await waitFor(() => expect(tid('check-outliers')).not.toBeNull());
    const typo = (await td.stores[0]!.db.transactions.toArray()).find((t) => t.note === 'обед')!;
    await user.click(screen.getByRole('link', { name: 'Проверить сумму' }));
    await waitFor(() => expect(currentPath()).toBe(`/edit/${typo.id}`));
  });

  it('«Все без категории» ведёт в «Операции» с нужными фильтрами', async () => {
    await openPage();
    const link = (await waitFor(() => screen.getByRole('link', { name: /^Все без категории/ }))) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/transactions?period=all&category=none');
  });

  it('чистые данные: «Проблем не найдено»', async () => {
    await openPage(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!;
      const salary = (await s.db.categories.toArray()).find((c) => c.kind === 'income')!.id;
      await s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100_000, occurredOn: '2026-10-01', categoryId: salary });
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Проблем не найдено' })).toBeTruthy());
    expect(tid('datacheck-summary')).toBeNull();
  });

  it('когда всё отмечено «Это нормально», остаётся «Проблем не найдено»', async () => {
    await openPage(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!;
      await s.wallets.create({ name: 'Кредитка', currency: 'TJS', kind: 'card', openingBalanceMinor: -5_000, color: '#2563eb', icon: '💳' });
      await s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 1_000, occurredOn: '2026-10-01', categoryId: (await s.db.categories.toArray()).find((c) => c.kind === 'income')!.id });
    });
    await user.click(await findByRole('button', { name: 'Это нормально: Кредитка' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Проблем не найдено' })).toBeTruthy());
  });
});
