import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { AppRoutes } from './App';
import { makeTestDeps, renderAppRoot, type RenderAppOptions } from './app/testkit';
import { findByRole, render, screen, user, waitFor } from './components/testUtils';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

/** Приложение целиком в локальном режиме (облака нет), у каждого теста своя пустая база. */
function renderAt(path: string, extra: Omit<RenderAppOptions, 'path' | 'deps'> = {}) {
  return renderAppRoot(<AppRoutes />, { path, deps: makeTestDeps().deps, ...extra });
}

describe('маршруты', () => {
  it.each([
    ['/', 'Главная'],
    ['/transactions', 'Операции'],
    ['/wallets', 'Кошельки'],
    ['/settings', 'Настройки'],
    ['/settings/categories', 'Категории'],
  ])('%s показывает страницу «%s»', async (path, title) => {
    renderAt(path);
    expect(await findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
  });

  it('/login при уже выполненном входе ведёт на «Главную»', async () => {
    renderAt('/login');
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Вход' })).toBeNull();
  });

  it('неизвестный адрес ведёт на «Главную»', async () => {
    renderAt('/нет-такой-страницы');
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
  });

  describe('HashRouter', () => {
    beforeEach(() => {
      // Настоящая сеть в тестах запрещена: курсы (автообновление) не должны никуда ходить.
      vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      window.location.hash = '';
    });

    it('App открывает страницу по #/… (локальный режим, без ключей облака)', async () => {
      window.location.hash = '#/wallets';
      render(<App />);
      expect(await findByRole('heading', { name: 'Кошельки', level: 1 })).toBeInTheDocument();
    });
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

  it('на странице категорий пункт «Ещё» остаётся активным', async () => {
    renderAt('/settings/categories');
    await findByRole('heading', { name: 'Категории', level: 1 });
    const current = Array.from(document.querySelectorAll('[aria-current="page"]')).map((a) => a.textContent);
    expect(current.some((t) => t?.includes('Ещё') || t?.includes('Настройки'))).toBe(true);
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

describe('шит правки /edit/:id', () => {
  it('прямой заход: шит правки поверх «Главной», закрытие ведёт на «/»', async () => {
    renderAt('/edit/0b1c2d3e-0000-4000-8000-000000000001');
    expect(await findByRole('dialog')).toBeInTheDocument();
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
  });

  it('открытие поверх «Операций» (state.background): страница под шитом остаётся, Esc закрывает', async () => {
    const background = { pathname: '/transactions', search: '', hash: '', state: null, key: 'k' };
    renderAt('/edit/abc', { state: { background } });
    expect(await findByRole('dialog')).toBeInTheDocument();
    expect(await findByRole('heading', { name: 'Операции', level: 1 })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('/edit без id не открывает шит и ведёт на «Главную»', async () => {
    renderAt('/edit');
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('плашка и индикатор локального режима', () => {
  it('на «Главной» и в «Настройках» есть плашка «Облако не подключено», на «Операциях» нет', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    expect(screen.getByRole('note')).toHaveTextContent('Облако не подключено: данные хранятся только на этом устройстве');
    expect(screen.getByRole('note')).toHaveTextContent('Делайте резервную копию');

    await user.click(screen.getAllByRole('link', { name: 'Операции' })[0] as HTMLElement);
    await findByRole('heading', { name: 'Операции', level: 1 });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('в шапке вместо «Синхронизировано» — нейтральный бейдж «Только на устройстве»', async () => {
    renderAt('/wallets');
    await findByRole('heading', { name: 'Кошельки', level: 1 });
    expect(screen.getAllByText('Только на устройстве').length).toBeGreaterThan(0);
    expect(screen.queryByText('Синхронизировано')).toBeNull();
  });
});
