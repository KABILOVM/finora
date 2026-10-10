import { MemoryRouter } from 'react-router-dom';
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
});
