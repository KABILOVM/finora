import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { makeTestDeps, renderAppRoot } from './app/testkit';
import { findByRole, waitFor } from './components/testUtils';
import { APP_TITLE } from './layout/documentTitle';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));
afterEach(() => {
  document.title = '';
  vi.restoreAllMocks();
});

/** Заголовок вкладки в настоящих маршрутах: у раздела свой, а шит «Добавить операцию» поверх страницы его не меняет. */
describe('заголовок вкладки в маршрутах', () => {
  it('раздел: /wallets — «Кошельки — Sumoima»', async () => {
    renderAppRoot(<AppRoutes />, { deps: makeTestDeps().deps, path: '/wallets' });
    await findByRole('heading', { name: 'Кошельки', level: 1 });
    expect(document.title).toBe('Кошельки — Sumoima');
  });

  it('«Главная» — общий заголовок', async () => {
    renderAppRoot(<AppRoutes />, { deps: makeTestDeps().deps, path: '/' });
    await findByRole('heading', { name: 'Главная', level: 1 });
    expect(document.title).toBe(APP_TITLE);
  });

  it('шит /add, открытый поверх «Кошельков», оставляет заголовок «Кошельки»', async () => {
    const background = { pathname: '/wallets', search: '', hash: '', state: null, key: 'k' };
    renderAppRoot(<AppRoutes />, { deps: makeTestDeps().deps, path: '/add', state: { background } });
    await findByRole('dialog');
    await waitFor(() => expect(document.title).toBe('Кошельки — Sumoima'));
  });

  it('шит /add при прямом заходе лежит поверх «Главной»: общий заголовок', async () => {
    renderAppRoot(<AppRoutes />, { deps: makeTestDeps().deps, path: '/add' });
    await findByRole('dialog');
    expect(document.title).toBe(APP_TITLE);
  });
});
