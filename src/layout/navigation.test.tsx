import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));
afterEach(() => vi.restoreAllMocks());

const renderAt = (path: string) => renderAppRoot(<AppRoutes />, { path, deps: makeTestDeps().deps });

const navs = () => screen.getAllByRole('navigation', { name: 'Основная навигация' });
const bottomNav = () => navs().find((n) => n.className.includes('bottom-[max')) as HTMLElement;
const sideNav = () => navs().find((n) => n.closest('aside')) as HTMLElement;
/** Ссылка с таким именем внутри контейнера (в testUtils нет within). */
const linkIn = (container: HTMLElement, name: string): HTMLElement => {
  const found = screen.getAllByRole('link', { name }).filter((a) => container.contains(a));
  if (found.length !== 1) throw new Error(`В контейнере ссылок «${name}»: ${found.length}`);
  return found[0] as HTMLElement;
};
const current = (nav: HTMLElement) => Array.from(nav.querySelectorAll('[aria-current="page"]')).map((a) => a.textContent);

describe('«Ещё» ведёт на страницу «Ещё», а не в настройки', () => {
  it('нижняя панель: ссылка «Ещё» → /more', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const more = linkIn(bottomNav(), 'Ещё');
    expect(more.getAttribute('href')).toMatch(/\/more$/);
    await user.click(more);
    expect(await findByRole('heading', { name: 'Ещё', level: 1 })).toBeInTheDocument();
  });

  it('боковая панель: «Ещё» нет, «Настройки» → /settings', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    expect(Array.from(sideNav().querySelectorAll('a')).map((a) => a.textContent)).not.toContain('Ещё');
    expect(linkIn(sideNav(), 'Настройки').getAttribute('href')).toMatch(/\/settings$/);
  });
});

describe('подсветка нижней панели: «Ещё» горит на всех своих разделах и больше ничего', () => {
  it.each([
    ['/more', 'Ещё'],
    ['/budgets', 'Бюджеты'],
    ['/recurring', 'Регулярные платежи'],
    ['/shopping', 'Покупки'],
    ['/debts', 'Долги и кредиты'],
    ['/import', 'Импорт из Дзен-мани'],
    ['/settings', 'Настройки'],
    ['/settings/categories', 'Категории'],
  ])('%s', async (path, title) => {
    renderAt(path);
    await findByRole('heading', { name: title, level: 1 });
    expect(current(bottomNav())).toEqual(['Ещё']);
  });

  it.each([
    ['/', 'Главная', 'Главная'],
    ['/transactions', 'Операции', 'Операции'],
    ['/wallets', 'Кошельки', 'Кошельки'],
  ])('%s: горит только «%s»', async (path, title, label) => {
    renderAt(path);
    await findByRole('heading', { name: title, level: 1 });
    expect(current(bottomNav())).toEqual([label]);
  });
});

describe('подсветка боковой панели', () => {
  it.each([
    ['/budgets', 'Бюджеты', 'Бюджеты'],
    ['/recurring', 'Регулярные платежи', 'Платежи'],
    ['/shopping', 'Покупки', 'Покупки'],
    ['/debts', 'Долги и кредиты', 'Долги'],
    ['/import', 'Импорт из Дзен-мани', 'Настройки'],
    ['/settings/categories', 'Категории', 'Настройки'],
    ['/settings', 'Настройки', 'Настройки'],
  ])('%s: горит один пункт «%s»', async (path, title, label) => {
    renderAt(path);
    await findByRole('heading', { name: title, level: 1 });
    expect(current(sideNav())).toEqual([label]);
  });
});

describe('переходы из страницы «Ещё»', () => {
  it.each([
    ['Бюджеты', '/budgets', 'Бюджеты'],
    ['Регулярные платежи', '/recurring', 'Регулярные платежи'],
    ['Покупки', '/shopping', 'Покупки'],
    ['Долги и кредиты', '/debts', 'Долги и кредиты'],
    ['Настройки', '/settings', 'Настройки'],
  ])('«%s» ведёт на %s', async (link, href, title) => {
    renderAt('/more');
    await findByRole('heading', { name: 'Ещё', level: 1 });
    const main = screen.getByRole('main');
    const a = linkIn(main, link);
    expect(a.getAttribute('href')).toMatch(new RegExp(`${href}$`));
    await user.click(a);
    expect(await findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    // «Ещё» в нижней панели остаётся подсвеченным
    expect(current(bottomNav())).toEqual(['Ещё']);
  });

  it('в «Ещё» пять пунктов, категорий и импорта нет: они внутри «Настроек»', async () => {
    renderAt('/more');
    await findByRole('heading', { name: 'Ещё', level: 1 });
    const links = screen.getAllByRole('link').filter((a) => screen.getByRole('main').contains(a));
    expect(links).toHaveLength(5);
  });

  it('в «Настройках» есть категории и импорт', async () => {
    renderAt('/settings');
    await findByRole('heading', { name: 'Настройки', level: 1 });
    const main = screen.getByRole('main');
    expect(linkIn(main, 'Категории').getAttribute('href')).toMatch(/\/settings\/categories$/);
    expect(linkIn(main, 'Импорт из Дзен-мани').getAttribute('href')).toMatch(/\/import$/);
  });
});

describe('новые разделы', () => {
  it.each([
    ['/budgets', 'Бюджеты'],
    ['/recurring', 'Регулярные платежи'],
    ['/shopping', 'Покупки'],
    ['/debts', 'Долги и кредиты'],
    ['/import', 'Импорт из Дзен-мани'],
  ])('%s: заголовок и каркас на месте', async (path, title) => {
    renderAt(path);
    await findByRole('heading', { name: title, level: 1 });
    expect(navs().length).toBeGreaterThanOrEqual(2);
  });

  it('из раздела можно вернуться на «Ещё» через нижнюю панель', async () => {
    renderAt('/budgets');
    await findByRole('heading', { name: 'Бюджеты', level: 1 });
    await user.click(linkIn(bottomNav(), 'Ещё'));
    expect(await findByRole('heading', { name: 'Ещё', level: 1 })).toBeInTheDocument();
  });
});

describe('кривые адреса не дают белый экран', () => {
  const BAD = ['/more/', '/more/x', '/MORE', '/budgets/%', '/debts/%E0%A4%A', '/recurring/..%2F..%2Fsettings', '/import//', '/more%0a', '/budgets/%0d%0a', '/more/' + 'x'.repeat(2000)];
  for (const path of BAD) {
    it(`адрес ${path.slice(0, 30)}: есть заголовок страницы`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      renderAt(path);
      await waitFor(() => expect(screen.queryAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0), 6000);
      expect(navs().length).toBeGreaterThanOrEqual(2);
    });
  }
});
