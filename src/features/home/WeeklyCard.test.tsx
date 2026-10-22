import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, currentSearch, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetDismissedCache } from '@/lib/dismissedKeys';
import HomePage from './HomePage';

beforeEach(() => {
  localStorage.clear();
  forgetDismissedCache();
  pinToday(); // сегодня — четверг 15.10.2026: прошедшая неделя 5–11 октября
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetDismissedCache();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => norm(tid(id)?.textContent);

/** Прошедшая неделя: еда 100 + 300 (ужин — крупнейшая), транспорт 200, доход 5 000. Неделей раньше: расход 400. */
async function seed(s: Store): Promise<void> {
  const wallet = (await s.db.wallets.toArray())[0]!;
  const cats = await s.db.categories.toArray();
  const cat = (name: string, kind: 'expense' | 'income' = 'expense') => cats.find((c) => c.name === name && c.kind === kind)?.id ?? '';
  const add = (kind: 'expense' | 'income', amountMinor: number, categoryId: string, occurredOn: string, note = '') =>
    s.transactions.create({ kind, walletId: wallet.id, amountMinor, categoryId, occurredOn, note });
  await add('expense', 10_000, cat('Еда'), '2026-10-05', 'обед');
  await add('expense', 30_000, cat('Еда'), '2026-10-07', 'ужин в кафе');
  await add('expense', 20_000, cat('Транспорт'), '2026-10-11');
  await add('income', 500_000, cat('Зарплата', 'income'), '2026-10-09');
  await add('expense', 40_000, cat('Еда'), '2026-10-02');
}

async function openHome(setup: (s: Store) => Promise<unknown> = seed) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
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

describe('карточка «Итоги недели» на «Главной»', () => {
  it('в начале недели: сколько потрачено, против недели раньше, главная категория, самая крупная трата, доход', async () => {
    await openHome();
    await waitFor(() => expect(tid('weekly-card')).not.toBeNull());
    const card = text('weekly-card');
    expect(card).toContain('Итоги недели');
    expect(card).toContain('5–11 октября');
    expect(text('weekly-expense')).toBe(fmt(60_000));
    expect(text('weekly-delta')).toBe(`▲ +50% · неделей раньше ${fmt(40_000)}`); // 600 против 400
    expect(text('weekly-top')).toContain('Больше всего ушло на Еда');
    expect(text('weekly-top')).toContain(fmt(40_000));
    expect(text('weekly-top')).toContain('66% расходов');
    expect(text('weekly-biggest')).toContain('ужин в кафе');
    expect(text('weekly-biggest')).toContain(fmt(30_000));
    expect(text('weekly-income')).toContain(fmt(500_000));
  });

  it('«Подробнее» открывает «Аналитику → Периоды» на этих датах', async () => {
    await openHome();
    await user.click(await findByRole('link', { name: 'Подробнее' }));
    await waitFor(() => expect(currentPath()).toBe('/analytics'));
    expect(new URLSearchParams(currentSearch()).get('tab')).toBe('periods');
    expect(new URLSearchParams(currentSearch()).get('kind')).toBe('custom');
    expect(new URLSearchParams(currentSearch()).get('from')).toBe('2026-10-05');
    expect(new URLSearchParams(currentSearch()).get('to')).toBe('2026-10-11');
  });

  it('«Скрыть» убирает карточку этой недели и помнит об этом на устройстве', async () => {
    const td = await openHome();
    await user.click(await findByRole('button', { name: 'Скрыть итоги недели' }));
    await waitFor(() => expect(tid('weekly-card')).toBeNull());
    expect(localStorage.getItem(`finora:dismissed:weekly:${td.stores[0]!.userId}`)).toContain('week:2026-10-05');
  });

  it('за неделю ничего не было — карточки нет', async () => {
    await openHome(async (s) => {
      const wallet = (await s.db.wallets.toArray())[0]!;
      await s.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 1_000, occurredOn: '2026-09-20' });
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(tid('weekly-card')).toBeNull();
  });

  it('новый человек без операций — карточки нет', async () => {
    await openHome(async () => undefined);
    await new Promise((r) => setTimeout(r, 100));
    expect(tid('weekly-card')).toBeNull();
  });

  it('неделей раньше расходов не было — так и написано, без процента', async () => {
    await openHome(async (s) => {
      const wallet = (await s.db.wallets.toArray())[0]!;
      await s.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 2_500, occurredOn: '2026-10-08', note: 'такси' });
    });
    await waitFor(() => expect(tid('weekly-card')).not.toBeNull());
    expect(text('weekly-delta')).toBe('Неделей раньше расходов не было');
  });
});

describe('конец недели', () => {
  it('в пятницу и позже карточки нет, даже если за неделю были траты', async () => {
    vi.setSystemTime(new Date(2026, 9, 16, 12, 0, 0)); // пятница
    await openHome();
    await new Promise((r) => setTimeout(r, 100));
    expect(tid('weekly-card')).toBeNull();
  });
});
