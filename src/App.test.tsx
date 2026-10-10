import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App, { AppRoutes } from './App';
import { findByRole, render, screen, user, waitFor } from './components/testUtils';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

function renderAt(path: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[state ? { pathname: path, state } : path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('маршруты', () => {
  it.each([
    ['/', 'Главная'],
    ['/transactions', 'Операции'],
    ['/wallets', 'Кошельки'],
    ['/settings', 'Настройки'],
  ])('%s показывает страницу «%s» с заглушкой «Скоро»', async (path, title) => {
    renderAt(path);
    expect(await findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Скоро' })).toBeInTheDocument();
  });

  it('/login — без боковой и нижней панелей', async () => {
    renderAt('/login');
    expect(await findByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('неизвестный адрес ведёт на «Главную»', async () => {
    renderAt('/нет-такой-страницы');
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
  });

  it('HashRouter: App открывает страницу по #/…', async () => {
    window.location.hash = '#/wallets';
    render(<App />);
    expect(await findByRole('heading', { name: 'Кошельки', level: 1 })).toBeInTheDocument();
    window.location.hash = '';
  });
});

describe('навигация', () => {
  it('нижняя панель телефона: Главная, Операции, «+», Кошельки, Ещё', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const bottom = screen.getAllByRole('navigation', { name: 'Основная навигация' }).find((n) => n.className.includes('bottom-0'));
    expect(bottom).toBeDefined();
    const labels = Array.from((bottom as HTMLElement).querySelectorAll('a')).map((a) => a.getAttribute('aria-label') ?? a.textContent);
    expect(labels).toEqual(['Главная', 'Операции', 'Добавить операцию', 'Кошельки', 'Ещё']);
  });

  it('боковая панель ПК: те же пункты («Ещё» → «Настройки») и кнопка «Добавить операцию»', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const side = screen.getAllByRole('navigation', { name: 'Основная навигация' }).find((n) => n.closest('aside'));
    expect(side).toBeDefined();
    const labels = Array.from((side as HTMLElement).querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Главная', 'Операции', 'Кошельки', 'Настройки']);
    const aside = (side as HTMLElement).closest('aside') as HTMLElement;
    expect(aside.querySelector('a[href="#/add"], a[href="/add"]')?.textContent).toContain('Добавить операцию');
  });

  it('текущий пункт помечен aria-current', async () => {
    renderAt('/wallets');
    await findByRole('heading', { name: 'Кошельки', level: 1 });
    const current = Array.from(document.querySelectorAll('[aria-current="page"]')).map((a) => a.textContent);
    expect(current.every((t) => t?.includes('Кошельки'))).toBe(true);
    expect(current.length).toBeGreaterThan(0);
  });

  it('переход по пункту меню меняет страницу', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const link = screen.getAllByRole('link', { name: 'Операции' })[0] as HTMLElement;
    await user.click(link);
    expect(await findByRole('heading', { name: 'Операции', level: 1 })).toBeInTheDocument();
  });

  it('центральная «+» открывает шит поверх текущей страницы, Esc возвращает на неё', async () => {
    renderAt('/transactions');
    await findByRole('heading', { name: 'Операции', level: 1 });
    await user.click(screen.getAllByRole('link', { name: 'Добавить операцию' })[0] as HTMLElement);
    expect(await findByRole('dialog', { name: 'Новая операция' })).toBeInTheDocument();
    // страница под шитом осталась прежней
    expect(screen.getByRole('heading', { name: 'Операции', level: 1 })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Операции', level: 1 })).toBeInTheDocument();
  });

  it('прямой заход на /add: шит поверх «Главной», закрытие ведёт на «/»', async () => {
    renderAt('/add');
    expect(await findByRole('dialog', { name: 'Новая операция' })).toBeInTheDocument();
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
  });

  it('индикатор «Офлайн» показывается в шапке только без сети', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    expect(screen.queryByText('Офлайн')).toBeNull();
  });
});
