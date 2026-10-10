/**
 * ЛОМАТЕЛЬ: маршруты и сборка в App.tsx (шит /edit/:id рядом с /add не трогаем по сути — только живучесть).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { makeTestDeps, renderAppRoot } from './app/testkit';
import { screen, waitFor } from './components/testUtils';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));
afterEach(() => vi.restoreAllMocks());

const HOSTILE = [
  '/edit/%',
  '/edit/%E0%A4%A',
  '/edit/..%2F..%2Fsettings',
  '/edit/' + 'x'.repeat(4000),
  '/edit/%00',
  '/edit/<script>alert(1)</script>',
  '/settings/categories//',
  '/settings/categories/extra',
  '/wallets/%',
  '/add/%',
];

describe('ATTACK: враждебные адреса', () => {
  for (const path of HOSTILE) {
    it(`адрес ${path.slice(0, 40)} не роняет приложение: есть заголовок страницы или шит, нет белого экрана`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const td = makeTestDeps();
      renderAppRoot(<AppRoutes />, { deps: td.deps, path });
      await waitFor(
        () => expect(screen.queryAllByRole('heading', { level: 1 }).length + screen.queryAllByRole('dialog').length).toBeGreaterThan(0),
        6000,
      );
    });
  }
});
