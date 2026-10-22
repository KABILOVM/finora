import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetActiveTripCache, readActiveTrip, setActiveTrip } from '@/features/trips/activeTrip';
import HomePage from './HomePage';

beforeEach(() => {
  localStorage.clear();
  forgetActiveTripCache();
  pinToday();
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetActiveTripCache();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const card = () => document.querySelector<HTMLElement>('[data-testid="trip-card"]');

async function seed(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  await s.wallets.update(cash.id, { openingBalanceMinor: 10_000_000 });
  await s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 12_300, occurredOn: '2026-10-14', note: 'такси #Самарканд' });
}

async function openHome() {
  const td = opsDeps([table()], { setup: async (s) => void (await seed(s)) });
  await showApp(
    <>
      <HomePage />
      <LocationProbe />
    </>,
    td,
    '/',
  );
  await findByRole('heading', { name: 'Главная', level: 1 });
  return td;
}

describe('«Идёт поездка» на «Главной»', () => {
  it('без начатой поездки карточки нет', async () => {
    await openHome();
    await new Promise((r) => setTimeout(r, 50));
    expect(card()).toBeNull();
  });

  it('поездка начата: карточка с названием и потраченным; «Открыть поездки» ведёт на /trips; «Завершить» убирает карточку', async () => {
    const td = await openHome();
    setActiveTrip(storeOf(td).userId, 'Самарканд');
    await waitFor(() => expect(card()).not.toBeNull());
    await waitFor(() => expect(norm(card()!.textContent)).toContain(norm(formatMinor(12_300, 'TJS'))));
    expect(norm(card()!.textContent)).toContain('Идёт поездка: Самарканд');
    expect(norm(card()!.textContent)).toContain('метку #Самарканд');
    await user.click(screen.getByRole('link', { name: 'Открыть поездки' }));
    await waitFor(() => expect(currentPath()).toBe('/trips'));
  });

  it('«Завершить» убирает карточку и поездку на устройстве', async () => {
    const td = await openHome();
    setActiveTrip(storeOf(td).userId, 'Самарканд');
    await user.click(await findByRole('button', { name: 'Завершить поездку: Самарканд' }));
    await waitFor(() => expect(card()).toBeNull());
    expect(readActiveTrip(storeOf(td).userId)).toBeNull();
  });
});
