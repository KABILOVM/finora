import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, currentSearch, LocationProbe, opsDeps, pinToday, seedHistory, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetDismissedCache } from '@/lib/dismissedKeys';
import AnalyticsPage from './AnalyticsPage';

/** «Сегодня» = четверг 15 октября 2026. */
beforeEach(() => {
  pinToday();
  window.localStorage.clear();
  forgetDismissedCache();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
  window.localStorage.clear();
  forgetDismissedCache();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null | undefined) => norm(el?.textContent);
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/**
 * «Еда»: по одной трате в 100 с. с мая по сентябрь (обычная — 100); в октябре банкет на 400 (рекорд), два одинаковых «кофе» по 15 в один день
 * и «Ремонт» (новая статья) на 3 000.
 */
async function seed(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const cats = await s.db.categories.toArray();
  const food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')?.id ?? '';
  const transport = cats.find((c) => c.name === 'Транспорт' && c.kind === 'expense')?.id ?? '';
  const repair = (await s.categories.create({ name: 'Ремонт', kind: 'expense', color: '#2563eb', icon: '🔧' })).id;
  const add = (amountMinor: number, categoryId: string, occurredOn: string, note = '') =>
    s.transactions.create({ kind: 'expense', walletId: cash, amountMinor, categoryId, occurredOn, note });
  for (const d of ['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10']) await add(10_000, food, d);
  await add(5_000, transport, '2026-08-12');
  await add(5_000, transport, '2026-09-12');
  await add(40_000, food, '2026-10-12', 'банкет');
  await add(1_500, food, '2026-10-14', 'кофе');
  await add(1_500, food, '2026-10-14', 'кофе');
  await add(300_000, repair, '2026-10-05', 'плитка');
}

async function openPage(setup: (s: Store) => Promise<unknown> = seed) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(
    <>
      <AnalyticsPage />
      <LocationProbe />
    </>,
    td,
    '/analytics',
  );
  await findByRole('heading', { name: 'Аналитика', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return td;
}

describe('«Что бросается в глаза»', () => {
  it('показывает необычно крупную трату, новую статью расходов и возможный дубль', async () => {
    await openPage();
    const card = tid('anomalies-card')!;
    expect(text(card)).toContain('Что бросается в глаза');

    const big = text(tid('anomaly-big'));
    expect(big).toContain('Необычно крупная трата: банкет');
    expect(big).toContain(fmt(40_000));
    expect(big).toContain(`в «Еда» обычно около ${fmt(10_000)}`);

    const fresh = text(tid('anomaly-new'));
    expect(fresh).toContain('Новая статья расходов: Ремонт');
    expect(fresh).toContain(fmt(300_000));
    expect(fresh).toContain('87% расходов месяца'); // 3 000 из 3 430

    const dup = text(tid('anomaly-dup'));
    expect(dup).toContain('Возможный дубль: кофе');
    expect(dup).toContain(`${fmt(1_500)} × 2`);
    expect(dup).toContain('2 одинаковые траты за день');
  });

  it('«Скрыть» убирает находку и помнит об этом после перезагрузки экрана; остальные остаются', async () => {
    const td = await openPage();
    await user.click(screen.getByRole('button', { name: 'Скрыть: банкет' }));
    await waitFor(() => expect(tid('anomaly-big')).toBeNull());
    expect(tid('anomaly-new')).not.toBeNull();
    expect(tid('anomaly-dup')).not.toBeNull();
    expect(window.localStorage.getItem(`finora:dismissed:anomalies:${td.stores[0]!.userId}`)).toContain('big:');
  });

  it('скрыты все — карточки нет совсем', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Скрыть: банкет' }));
    await user.click(screen.getByRole('button', { name: 'Скрыть: Ремонт' }));
    await user.click(screen.getByRole('button', { name: 'Скрыть: кофе' }));
    await waitFor(() => expect(tid('anomalies-card')).toBeNull());
  });

  it('«К операциям» ведёт в список категории за этот месяц', async () => {
    await openPage();
    await user.click(screen.getByRole('link', { name: 'К операциям' }));
    await waitFor(() => expect(currentPath()).toBe('/transactions'));
    expect(currentSearch()).toMatch(/^\?month=2026-10&category=[\w-]+&kind=expense$/);
  });

  it('«Открыть трату» открывает правку этой траты поверх экрана', async () => {
    const td = await openPage();
    const bigId = (await td.stores[0]!.db.transactions.toArray()).find((t) => t.note === 'банкет')!.id;
    const links = screen.getAllByRole('link', { name: 'Открыть трату' });
    await user.click(links[0]!);
    await waitFor(() => expect(currentPath()).toBe(`/edit/${bigId}`));
  });

  it('обычные траты без находок: карточки нет', async () => {
    await openPage(seedHistory);
    expect(tid('anomalies-card')).toBeNull();
  });

  it('другой месяц — свои находки: в сентябре ничего необычного', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(tid('analytics-summary'))).toContain('сентябрь 2026'));
    expect(tid('anomalies-card')).toBeNull();
  });
});
