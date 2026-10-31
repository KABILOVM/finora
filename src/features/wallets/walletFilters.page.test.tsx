import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestDeps, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import WalletsPage from './WalletsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

const store = (td: TestDeps) => {
  const s = td.stores[0];
  if (!s) throw new Error('Хранилище не открыто');
  return s;
};

async function openPage(setup?: (td: TestDeps) => Promise<void>) {
  const td = makeTestDeps();
  renderAppRoot(<WalletsPage />, { deps: td.deps, path: '/wallets' });
  await findByRole('heading', { name: 'Кошельки', level: 1 });
  await waitFor(() => expect(document.body.textContent).toContain('Наличные'));
  if (setup) await setup(td);
  return td;
}

const names = () => screen.queryAllByRole('link').map((l) => l.textContent ?? '').filter((t) => /Наличные|Карта|Отпуск|Доллары/.test(t));
const filtersButton = () => screen.getByRole('button', { name: /^Фильтры/ });

describe('экран «Кошельки»: фильтры', () => {
  it('один кошелёк — панели фильтров нет', async () => {
    await openPage();
    expect(screen.queryByRole('button', { name: /^Фильтры/ })).toBeNull();
  });

  it('по виду и по валюте; «Всего» не меняется; «Сбросить» возвращает всё', async () => {
    await openPage(async (td) => {
      const s = store(td);
      await write(() => s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 50_000, color: '#2563eb', icon: '💳' }));
      await write(() => s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' }));
    });
    await waitFor(() => expect(names()).toHaveLength(3));
    const total = () => document.querySelector('[data-testid="wallets-total"]')?.textContent;
    const before = total();

    await user.click(filtersButton());
    await user.click(screen.getByRole('button', { name: 'Карта' }));
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(names()).toHaveLength(1));
    expect(names()[0]).toContain('Карта');
    expect(total()).toBe(before);
    expect(document.querySelector('[data-testid="wallets-filter-note"]')?.textContent).toContain('«Всего» считается по всем активным кошелькам');

    // валюта USD вместе с видом «Карта» — ничего не подходит
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(screen.getByRole('button', { name: 'USD' }));
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(document.querySelector('[data-testid="wallets-filter-empty"]')).not.toBeNull());
    expect(names()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(document.querySelector('[data-testid="wallets-filter-note"]')).toBeNull();
  });

  it('фильтр по валюте оставляет только кошельки в ней', async () => {
    await openPage(async (td) => {
      await write(() => store(td).wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' }));
    });
    await waitFor(() => expect(names()).toHaveLength(2));
    await user.click(filtersButton());
    await user.click(screen.getByRole('button', { name: 'USD' }));
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(names()).toHaveLength(1));
    expect(names()[0]).toContain('Доллары');
  });
});
