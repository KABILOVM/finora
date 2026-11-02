import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetActiveTripCache, readActiveTrip, setActiveTrip } from '@/features/trips/activeTrip';
import { forgetTripPlanCache, setTripPlan } from '@/features/trips/tripPlan';
import HomePage from './HomePage';

beforeEach(() => {
  localStorage.clear();
  forgetActiveTripCache();
  forgetTripPlanCache();
  pinToday();
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetActiveTripCache();
  forgetTripPlanCache();
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

describe('деньги поездки на «Главной»', () => {
  /** Обмен 1 100 с. → 100 $ (курс 11), сегодня (15.10) потрачено 20 $. */
  async function seedExchange(s: Store): Promise<void> {
    await seed(s);
    const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
    const usd = await s.wallets.create({ name: 'USD · Самарканд', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#0ea5e9', icon: '✈️' });
    await s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 110_000, toAmountMinor: 10_000, occurredOn: '2026-10-14', note: 'Обмен валюты #Самарканд' });
    await s.transactions.create({ kind: 'expense', walletId: usd.id, amountMinor: 2_000, occurredOn: '2026-10-15', note: 'ужин #Самарканд', fx: { rate: 11, source: 'trip' } });
  }

  it('остаток валюты в сомони по вашему курсу и потрачено сегодня', async () => {
    const td = opsDeps([table()], { setup: seedExchange });
    await showApp(<HomePage />, td, '/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    setActiveTrip(storeOf(td).userId, 'Самарканд');
    await waitFor(() => expect(document.querySelector('[data-testid="trip-card-wallet"]')).not.toBeNull());
    const text = norm(document.querySelector('[data-testid="trip-card-wallet"]')!.textContent);
    expect(text).toContain('Осталось 80 $');
    expect(text).toContain('≈ 880 с.'); // 80 $ × 11
    // сегодня потрачено 220 с. (20 $ по курсу поездки)
    expect(norm(card()!.textContent)).toContain(`сегодня ${norm(formatMinor(22_000, 'TJS'))}`);
    // плана на дни нет — «сколько можно» не показываем
    expect(text).not.toContain('сегодня ещё можно');
  });

  it('есть план на дни: «сегодня ещё можно …» из остатка на начало дня', async () => {
    const td = opsDeps([table()], { setup: seedExchange });
    await showApp(<HomePage />, td, '/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const userId = storeOf(td).userId;
    setActiveTrip(userId, 'Самарканд');
    setTripPlan(userId, 'Самарканд', { startOn: '2026-10-15', days: 4 });
    await waitFor(() => expect(document.querySelector('[data-testid="trip-card-wallet"]')).not.toBeNull());
    // (80 + 20) ÷ 4 = 25 $ в день, потрачено 20 — ещё 5 $
    await waitFor(() => expect(norm(document.querySelector('[data-testid="trip-card-wallet"]')!.textContent)).toContain('сегодня ещё можно 5 $'));
  });
});
