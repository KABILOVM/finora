import { HashRouter, MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { findByRole, render, screen, user, waitFor } from './components/testUtils';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

describe('ATTACK: шит /add и история', () => {
  it('прямой заход на /add: Esc закрывает шит и показывает «Главную»', async () => {
    render(
      <MemoryRouter initialEntries={['/add']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
  });

  it('/add со state.background, но БЕЗ предыдущей записи истории (дубль вкладки/восстановление): шит всё равно закрывается', async () => {
    const background = { pathname: '/transactions', search: '', hash: '', state: null, key: 'k' };
    render(
      <MemoryRouter initialEntries={[{ pathname: '/add', state: { background } }]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('повреждённый state.background ({}), например из старой версии приложения, не роняет экран', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/add', state: { background: {} } }]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await findByRole('dialog')).toBeInTheDocument();
  });

  it('/ADD (другой регистр) и /add/ не оставляют пользователя на пустом экране', async () => {
    for (const p of ['/ADD', '/add/']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[p]}>
          <AppRoutes />
        </MemoryRouter>,
      );
      expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
      unmount();
    }
  });

  // Настоящая история браузера (HashRouter): «назад» — только если есть куда вернуться.
  it('шит открыт кнопкой «+» из браузерной истории: закрытие возвращает на страницу под ним (шаг назад)', async () => {
    window.history.replaceState(null, '', '#/transactions');
    render(
      <HashRouter>
        <AppRoutes />
      </HashRouter>,
    );
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
    render(
      <HashRouter>
        <AppRoutes />
      </HashRouter>,
    );
    await findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#/');
    expect(window.history.length, 'новых записей в истории быть не должно (замена, а не переход)').toBe(before);
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
  });
});
