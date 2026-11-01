import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import HomePage from './HomePage';

/** «Сегодня» = четверг 15 октября 2026 (вторая половина месяца), основная валюта TJS. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const byId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

/** 9 000 на руках; копилка и (по желанию) цель «Отпуск» на 3 000 к 13 января с привязкой к копилке. */
async function setup(s: Store, withGoal: boolean) {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 900_000, categoryId: null, occurredOn: '2026-10-01' });
  const box = await s.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#2563eb', icon: '🐷' });
  if (withGoal) await s.savingsGoals.create({ name: 'Отпуск', targetMinor: 300_000, dueOn: '2027-01-13', walletId: box.id });
}

async function openHome(withGoal: boolean) {
  const td = opsDeps([table()], { setup: (s) => setup(s, withGoal) });
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
  return td;
}

describe('«Главная»: цели накопления', () => {
  it('в виджете «Можно тратить в день» есть строка «С учётом целей» со ссылкой на «Бюджеты»', async () => {
    await openHome(true);
    await waitFor(() => expect(byId('widget-goal-line')).not.toBeNull());
    const line = byId('widget-goal-line')!;
    expect(norm(line.textContent)).toContain('С учётом целей');
    expect(norm(line.textContent)).toContain('в день');
    expect(line.getAttribute('href')).toBe('/budgets');
  });

  it('в «Требует внимания» — «Пора отложить на цель»: отложено меньше нужного во второй половине месяца', async () => {
    await openHome(true);
    await waitFor(() => expect(byId('attention-row')).not.toBeNull());
    expect(norm(byId('attention-row')?.textContent)).toContain('Пора отложить на цель «Отпуск»');
  });

  it('без целей ни строки в виджете, ни напоминания', async () => {
    await openHome(false);
    await waitFor(() => expect(byId('budgets-widget')).not.toBeNull());
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    expect(byId('widget-goal-line')).toBeNull();
    expect(norm(byId('attention-row')?.textContent)).not.toContain('на цель');
  });

  it('отложено сколько нужно — напоминание уходит', async () => {
    const td = await openHome(true);
    await waitFor(() => expect(norm(byId('attention-row')?.textContent)).toContain('Пора отложить на цель «Отпуск»'));
    const s = td.stores[0]!;
    const wallets = await s.db.wallets.toArray();
    const cash = wallets.find((w) => w.name === 'Наличные')!;
    const box = wallets.find((w) => w.name === 'Копилка')!;
    // 3 000 за два месяца — по 1 500: переводим ровно нужное
    await s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: box.id, amountMinor: 150_000, toAmountMinor: 150_000, categoryId: null, occurredOn: '2026-10-15' });
    await waitFor(() => expect(norm(byId('attention-row')?.textContent)).not.toContain('Пора отложить на цель'));
  });
});
