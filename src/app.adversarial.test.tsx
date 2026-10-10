import { HashRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { AppRoot } from './app/AppRoot';
import { makeTestDeps, renderAppRoot } from './app/testkit';
import { findByRole, render, screen, user, waitFor } from './components/testUtils';
import { ToastProvider } from './components/Toast';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

/** Приложение целиком (вход → база → страницы) в обычной памяти-истории: страницам нужна база, голый <AppRoutes /> их не отрисует. */
const renderAt = (path: string, state?: unknown) => renderAppRoot(<AppRoutes />, { deps: makeTestDeps().deps, path, state });

/** То же, но с настоящей историей браузера (HashRouter). */
const renderHash = () =>
  render(
    <ToastProvider>
      <HashRouter>
        <AppRoot client={null} deps={makeTestDeps().deps}>
          <AppRoutes />
        </AppRoot>
      </HashRouter>
    </ToastProvider>,
  );

describe('ATTACK: шит /add и история', () => {
  it('прямой заход на /add: Esc закрывает шит и показывает «Главную»', async () => {
    renderAt('/add');
    await findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
  });

  it('/add со state.background, но БЕЗ предыдущей записи истории (дубль вкладки/восстановление): шит всё равно закрывается', async () => {
    const background = { pathname: '/transactions', search: '', hash: '', state: null, key: 'k' };
    renderAt('/add', { background });
    await findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('повреждённый state.background ({}), например из старой версии приложения, не роняет экран', async () => {
    renderAt('/add', { background: {} });
    expect(await findByRole('dialog')).toBeInTheDocument();
  });

  it('/ADD (другой регистр) и /add/ не оставляют пользователя на пустом экране', async () => {
    for (const p of ['/ADD', '/add/']) {
      const { unmount } = renderAt(p);
      expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
      unmount();
    }
  });

  // Настоящая история браузера (HashRouter): «назад» — только если есть куда вернуться.
  it('шит открыт кнопкой «+» из браузерной истории: закрытие возвращает на страницу под ним (шаг назад)', async () => {
    window.history.replaceState(null, '', '#/transactions');
    renderHash();
    await findByRole('heading', { name: 'Операции', level: 1 });
    await user.click(screen.getAllByRole('link', { name: 'Добавить операцию' })[0] as HTMLElement);
    await findByRole('dialog');
    expect(window.location.hash).toBe('#/add');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#/transactions');
    expect(screen.getByRole('heading', { name: 'Операции', level: 1 })).toBeInTheDocument();
  });

  it('дубль вкладки: /add с state.background и первой записью истории (idx 0) — закрытие заменяет запись на «/», а не уходит «назад»', async () => {
    const background = { pathname: '/transactions', search: '', hash: '', state: null, key: 'k' };
    window.history.replaceState({ usr: { background }, key: 'dup', idx: 0 }, '', '#/add');
    const before = window.history.length;
    renderHash();
    await findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#/');
    expect(window.history.length, 'новых записей в истории быть не должно (замена, а не переход)').toBe(before);
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
  });
});
