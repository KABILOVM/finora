import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, currentSearch, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetDismissedCache } from '@/lib/dismissedKeys';
import HomePage from './HomePage';

/** Воскресенье 1 ноября 2026: недельная карточка в этот день не показывается, чтобы не мешать (она живёт с понедельника по четверг). */
const FIRST_DAY = new Date(2026, 10, 1, 12, 0, 0);

beforeEach(() => {
  localStorage.clear();
  forgetDismissedCache();
  pinToday();
  vi.setSystemTime(FIRST_DAY);
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

/** Октябрь: еда 100 + 300 (ужин — крупнейшая), транспорт 200, доход 5 000. Сентябрь: расход 400. */
async function seed(s: Store): Promise<void> {
  const wallet = (await s.db.wallets.toArray())[0]!;
  const cats = await s.db.categories.toArray();
  const cat = (name: string, kind: 'expense' | 'income' = 'expense') => cats.find((c) => c.name === name && c.kind === kind)?.id ?? '';
  const add = (kind: 'expense' | 'income', amountMinor: number, categoryId: string, occurredOn: string, note = '') =>
    s.transactions.create({ kind, walletId: wallet.id, amountMinor, categoryId, occurredOn, note });
  await add('expense', 10_000, cat('Еда'), '2026-10-05', 'обед');
  await add('expense', 30_000, cat('Еда'), '2026-10-17', 'ужин в кафе');
  await add('expense', 20_000, cat('Транспорт'), '2026-10-30');
  await add('income', 500_000, cat('Зарплата', 'income'), '2026-10-09');
  await add('expense', 40_000, cat('Еда'), '2026-09-12');
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

describe('карточка «Итоги месяца» на «Главной»', () => {
  it('в первые дни месяца: сколько потрачено, против месяца раньше, главная категория, самая крупная трата, в день, доход и остаток', async () => {
    await openHome();
    await waitFor(() => expect(tid('monthly-card')).not.toBeNull());
    expect(text('monthly-card')).toContain('Итоги месяца');
    expect(text('monthly-card')).toContain('Октябрь 2026');
    expect(text('monthly-expense')).toBe(fmt(60_000));
    expect(text('monthly-delta')).toBe(`▲ +50% · месяцем раньше ${fmt(40_000)}`); // 600 против 400
    expect(text('monthly-top')).toContain('Больше всего ушло на Еда');
    expect(text('monthly-top')).toContain(fmt(40_000));
    expect(text('monthly-top')).toContain('66% расходов');
    expect(text('monthly-biggest')).toContain('ужин в кафе');
    expect(text('monthly-biggest')).toContain(fmt(30_000));
    expect(text('monthly-per-day')).toContain(fmt(1_935)); // 600 / 31 дням
    expect(text('monthly-income')).toContain(fmt(500_000));
    expect(text('monthly-net')).toContain('Осталось');
    expect(text('monthly-net')).toContain(fmt(440_000));
  });

  it('«Подробнее» открывает «Аналитику» на прошедшем месяце', async () => {
    await openHome();
    await user.click(await findByRole('link', { name: 'Подробнее' }));
    await waitFor(() => expect(currentPath()).toBe('/analytics'));
    expect(new URLSearchParams(currentSearch()).get('month')).toBe('2026-10');
  });

  it('«Скрыть» убирает карточку этого месяца и помнит об этом на устройстве', async () => {
    const td = await openHome();
    await user.click(await findByRole('button', { name: 'Скрыть итоги месяца' }));
    await waitFor(() => expect(tid('monthly-card')).toBeNull());
    expect(localStorage.getItem(`finora:dismissed:monthly:${td.stores[0]!.userId}`)).toContain('month:2026-10');
  });

  it('за месяц ничего не было — карточки нет', async () => {
    await openHome(async (s) => {
      const wallet = (await s.db.wallets.toArray())[0]!;
      await s.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 1_000, occurredOn: '2026-09-20' });
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(tid('monthly-card')).toBeNull();
  });

  it('новый человек без операций — карточки нет', async () => {
    await openHome(async () => undefined);
    await new Promise((r) => setTimeout(r, 100));
    expect(tid('monthly-card')).toBeNull();
  });

  it('месяцем раньше расходов не было — так и написано, без процента', async () => {
    await openHome(async (s) => {
      const wallet = (await s.db.wallets.toArray())[0]!;
      await s.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 2_500, occurredOn: '2026-10-08', note: 'такси' });
    });
    await waitFor(() => expect(tid('monthly-card')).not.toBeNull());
    expect(text('monthly-delta')).toBe('Месяцем раньше расходов не было');
    expect(tid('monthly-income')).toBeNull(); // доходов не было — строк «Получено» и «Осталось» нет
    expect(tid('monthly-net')).toBeNull();
  });

  it('расходы больше доходов — «Ушло больше, чем получено»', async () => {
    await openHome(async (s) => {
      const wallet = (await s.db.wallets.toArray())[0]!;
      const cats = await s.db.categories.toArray();
      await s.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 9_000, occurredOn: '2026-10-08', categoryId: cats.find((c) => c.kind === 'expense')!.id });
      await s.transactions.create({ kind: 'income', walletId: wallet.id, amountMinor: 4_000, occurredOn: '2026-10-09', categoryId: cats.find((c) => c.kind === 'income')!.id });
    });
    await waitFor(() => expect(tid('monthly-card')).not.toBeNull());
    expect(text('monthly-net')).toContain('Ушло больше, чем получено');
    expect(text('monthly-net')).toContain(fmt(5_000));
  });
});

describe('окно показа', () => {
  it('5-го числа карточка ещё есть', async () => {
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0, 0));
    await openHome();
    await waitFor(() => expect(tid('monthly-card')).not.toBeNull());
  });

  it('6-го числа и позже карточки нет, даже если за месяц были траты', async () => {
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0));
    await openHome();
    await new Promise((r) => setTimeout(r, 100));
    expect(tid('monthly-card')).toBeNull();
  });
});
