/**
 * ЛОМАТЕЛЬ: маршруты и сборка в App.tsx (шит /edit/:id рядом с /add не трогаем по сути — только живучесть).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes, hasLineBreak } from './App';
import { makeTestDeps, renderAppRoot } from './app/testkit';
import { findByRole, screen, waitFor } from './components/testUtils';

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

/**
 * SEC-1. react-router раскодирует адрес и ищет страницу регуляркой, где «.» не ловит перевод строки (\n, \r, U+2028, U+2029):
 * для «#/%0a» не находился даже запасной маршрут «*», и Routes рисовал пустоту — белый экран.
 */
describe('ATTACK: кодированные переводы строки в адресе (белый экран)', () => {
  const BREAKS = ['/%0a', '/x%0d', '/%0d%0aSet-Cookie:x=1', '/%e2%80%a8', '/%E2%80%A9', '/wallets%0a', '/settings/%0Acategories', '/edit/%0a', '/add%0a', '/%0a/'];
  for (const path of BREAKS) {
    it(`адрес ${path} ведёт на «Главную», а не на пустой экран`, async () => {
      const td = makeTestDeps();
      renderAppRoot(<AppRoutes />, { deps: td.deps, path });
      expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull(); // шиты /add и /edit по такому адресу не открываются
    });
  }

  it('обычные адреса не затронуты: /wallets остаётся «Кошельками»', async () => {
    renderAppRoot(<AppRoutes />, { deps: makeTestDeps().deps, path: '/wallets' });
    expect(await findByRole('heading', { name: 'Кошельки', level: 1 })).toBeInTheDocument();
  });

  it('кодированные, но безобидные символы (пробел, кириллица, %00) тоже ведут на «Главную»', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const path of ['/%20', '/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82', '/%00']) {
      const { unmount } = renderAppRoot(<AppRoutes />, { deps: makeTestDeps().deps, path });
      expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('hasLineBreak', () => {
  it('находит перевод строки в раскодированном адресе, а не в «сыром»', () => {
    for (const p of ['/%0a', '/x%0D', '/a%e2%80%a8', '/a%E2%80%A9b', '/\n', '/a\rb']) expect(hasLineBreak(p), p).toBe(true);
  });
  it('обычные, пустые, битые адреса и не-строки — нет', () => {
    for (const p of ['/', '/wallets', '/%20', '/%00', '/%', '/%E0%A4%A', '/edit/123', '', 5, null, undefined]) expect(hasLineBreak(p), String(p)).toBe(false);
  });
});
