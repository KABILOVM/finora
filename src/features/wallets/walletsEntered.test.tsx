import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAppRoot, write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, storeOf, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import type { RateLookup } from '@/rates/types';
import { computeWalletsTotal } from '@/rates/walletsTotal';
import WalletsPage from './WalletsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const usd = { name: 'Доллары', currency: 'USD', kind: 'cash' as const, openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' };
const totalText = () => document.querySelector('[data-testid="wallets-total"]')?.parentElement?.textContent ?? '';

describe('«Всего» на экране «Кошельки» и курс, введённый в операции', () => {
  it('нет курса сети: после ввода курса доллары вошли в итог, «≈» и пояснение с датой', async () => {
    const td = opsDeps([]);
    renderAppRoot(<WalletsPage />, { deps: td.deps });
    await findByRole('heading', { name: 'Кошельки', level: 1 });
    await waitFor(() => expect(td.stores.length).toBeGreaterThan(0));
    await write(() => storeOf(td).wallets.create(usd));
    await waitFor(() => expect(screen.getByText(/Нет курса, в итог не вошли: USD/)).toBeInTheDocument());

    await write(async () => td.rates.rememberEnteredRate('USD', 'TJS', 11));
    await waitFor(() => expect(document.querySelector('[data-testid="wallets-total"]')?.textContent).toContain('≈'));
    expect(document.querySelector('[data-testid="wallets-total"]')?.textContent).toContain(formatMinor(110_000, 'TJS'));
    expect(screen.queryByText(/Нет курса/)).toBeNull();
    expect(totalText()).toContain('Остаток в USD пересчитан по введённому вами курсу от 10.10');
  });

  it('вычисление: введённый курс отдельно от обычных', () => {
    const lookup = (from: string): RateLookup | null =>
      from === 'USD'
        ? { rate: 11, source: 'manual', asOf: '2026-10-10', stale: false, manual: false, entered: true }
        : from === 'EUR'
          ? { rate: 12, source: 'nbt', asOf: '2026-10-10', stale: false, manual: false }
          : null;
    const balances = new Map([['a', 100], ['b', 100], ['c', 100]]);
    const t = computeWalletsTotal([{ id: 'a', currency: 'TJS' }, { id: 'b', currency: 'USD' }, { id: 'c', currency: 'EUR' }], balances, 'TJS', lookup);
    expect(t).toMatchObject({ totalMinor: 2400, approximate: true, entered: [{ currency: 'USD', asOf: '2026-10-10' }], viaOtherRates: true });
  });

  it('отрицательный начальный остаток в сомони: подсказка без двойной точки («−500 с..»)', async () => {
    const td = opsDeps([]);
    renderAppRoot(<WalletsPage />, { deps: td.deps });
    await findByRole('heading', { name: 'Кошельки', level: 1 });
    await waitFor(() => expect(td.stores.length).toBeGreaterThan(0));
    await write(() => storeOf(td).wallets.create({ name: 'Кредитка', currency: 'TJS', kind: 'card', openingBalanceMinor: -50_000, color: '#2563eb', icon: '💳' }));
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Изменить: Кредитка' })));
    await findByRole('dialog', { name: 'Правка кошелька' });
    const hint = screen.getByText(/Сейчас начальный остаток отрицательный/);
    expect(hint.textContent).not.toContain('..');
    expect(hint.textContent).toMatch(/с\. Он не изменится/);
  });
});
