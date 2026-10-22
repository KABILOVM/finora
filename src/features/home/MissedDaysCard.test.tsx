import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import HomePage from './HomePage';
import { readQuietThrough } from './missedDays';

beforeEach(() => {
  localStorage.clear();
  pinToday(); // сегодня — 15.10.2026
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Показывает, какую дату «Внести траты» передаёт форме. */
function StateProbe() {
  const state = useLocation().state as { date?: string; kind?: string } | null;
  return <p data-testid="state" data-date={state?.date ?? ''} data-kind={state?.kind ?? ''} />;
}

/** Последняя запись человека — `lastOn` (null — записей нет совсем). */
async function openHome(lastOn: string | null) {
  const td = opsDeps([table()], {
    setup: async (s: Store) => {
      if (lastOn === null) return;
      const wallet = (await s.db.wallets.toArray())[0]!;
      await s.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 1000, occurredOn: lastOn, note: 'обед' });
    },
  });
  await showApp(
    <>
      <HomePage />
      <LocationProbe />
      <StateProbe />
    </>,
    td,
    '/',
  );
  await findByRole('heading', { name: 'Главная', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const card = () => document.querySelector('[data-testid="missed-days"]');
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const stateOf = () => document.querySelector('[data-testid="state"]') as HTMLElement;

describe('плашка «Пропущенные дни» на «Главной»', () => {
  it('последняя запись 10.10, сегодня 15.10: пропущены 11–14 — плашка с числом дней и двумя кнопками', async () => {
    await openHome('2026-10-10');
    await waitFor(() => expect(card()).not.toBeNull());
    expect(norm(card()!.textContent)).toContain('4 дня без записей — всё в порядке?');
    expect(screen.getByRole('link', { name: 'Внести траты' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ничего не тратил(а)' })).toBeTruthy();
  });

  it.each(['2026-10-15', '2026-10-14', '2026-10-13'])('последняя запись %s (сегодня, вчера или не было только вчера) — плашки нет', async (on) => {
    await openHome(on);
    await new Promise((r) => setTimeout(r, 80));
    expect(card()).toBeNull();
  });

  it('новому человеку (записей нет) плашка не нужна', async () => {
    await openHome(null);
    await new Promise((r) => setTimeout(r, 80));
    expect(card()).toBeNull();
  });

  it('«Внести траты» открывает форму расхода сразу на вчерашнем дне', async () => {
    await openHome('2026-10-10');
    await user.click(await waitFor(() => screen.getByRole('link', { name: 'Внести траты' })));
    expect(currentPath()).toBe('/add');
    expect(stateOf().dataset.date).toBe('2026-10-14');
    expect(stateOf().dataset.kind).toBe('expense');
  });

  it('«Ничего не тратил(а)» убирает плашку, помнит ответ на устройстве; «Отменить» возвращает', async () => {
    const td = await openHome('2026-10-10');
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Ничего не тратил(а)' })));
    await waitFor(() => expect(card()).toBeNull());
    expect(readQuietThrough(storeOf(td).userId)).toBe('2026-10-14');

    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Отменить' })));
    await waitFor(() => expect(card()).not.toBeNull());
    expect(readQuietThrough(storeOf(td).userId)).toBeNull();
  });

  it('внесли операцию — плашка исчезает сразу', async () => {
    const td = await openHome('2026-10-10');
    await waitFor(() => expect(card()).not.toBeNull());
    const s = storeOf(td);
    const wallet = (await s.db.wallets.toArray())[0]!;
    await s.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 500, occurredOn: '2026-10-14', note: 'вчера' });
    await waitFor(() => expect(card()).toBeNull());
  });
});
