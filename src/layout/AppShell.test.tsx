import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { INSTALL_HINT_KEY } from '@/components/InstallHint';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** Приложение целиком (локальный режим) на нужном адресе. */
const renderAt = (path: string) => renderAppRoot(<AppRoutes />, { path, deps: makeTestDeps().deps });
const hint = () => screen.queryByText('Установка:');
/** Главная прочитала данные (до этого она показывает «Загрузка…», и «подсказки нет» было бы пустой проверкой). */
const homeLoaded = () => waitFor(() => screen.getByText('Всего'));
/** Главная сначала показывает «Загрузка…», подсказка появляется вместе с данными. */
const hintShown = () =>
  waitFor(() => {
    const el = hint();
    if (!el) throw new Error('Подсказки ещё нет');
    return el;
  });

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function iphone() {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
}

describe('подсказка «как установить»: только «Главная»', () => {
  afterEach(() => {
    delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
  });

  it('на «Главной» в Safari на iPhone она есть: одна строка и крестик', async () => {
    iphone();
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const note = (await hintShown()).closest('[role="note"]') as HTMLElement;
    expect(note).toHaveTextContent('Поделиться → На экран Домой');
    // одна строка текста и одна кнопка — без заголовка и абзацев
    expect(note.querySelectorAll('p')).toHaveLength(1);
    expect(note.querySelectorAll('button')).toHaveLength(1);
    expect((note.textContent ?? '').length).toBeLessThan(60);
  });

  it.each([
    ['/transactions', 'Операции'],
    ['/wallets', 'Кошельки'],
    ['/settings', 'Настройки'],
    ['/settings/categories', 'Категории'],
  ])('на странице %s подсказки нет', async (path, title) => {
    iphone();
    renderAt(path);
    await findByRole('heading', { name: title, level: 1 });
    expect(hint()).toBeNull();
  });

  it('не показывается, если приложение уже запущено с экрана «Домой» (standalone)', async () => {
    iphone();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} }));
    renderAt('/');
    await homeLoaded();
    expect(hint()).toBeNull();
  });

  it('закрытие запоминается: после ухода с «Главной» и возвращения подсказки нет, в хранилище стоит отметка', async () => {
    iphone();
    renderAt('/');
    await homeLoaded();
    await hintShown();
    await user.click(screen.getByRole('button', { name: 'Закрыть подсказку' }));
    expect(hint()).toBeNull();
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe('1');

    await user.click(screen.getAllByRole('link', { name: 'Операции' })[0] as HTMLElement);
    await findByRole('heading', { name: 'Операции', level: 1 });
    await user.click(screen.getAllByRole('link', { name: 'Главная' })[0] as HTMLElement);
    await homeLoaded();
    expect(hint()).toBeNull();
  });

  it('не iPhone (ПК, Android): подсказки нет и на «Главной»', async () => {
    renderAt('/');
    await homeLoaded();
    expect(hint()).toBeNull();
  });
});

describe('шапка телефона: индикаторы в одну строку', () => {
  const statusRow = () => document.querySelector('.header-status') as HTMLElement;

  it('«Только на устройстве» лежит в одной строке-контейнере (.header-status), без переноса', async () => {
    renderAt('/wallets');
    await findByRole('heading', { name: 'Кошельки', level: 1 });
    expect(statusRow()).not.toBeNull();
    expect(statusRow()).toHaveTextContent('Только на устройстве');
    expect(statusRow().className).not.toContain('flex-wrap');
  });

  it('без сети «Офлайн» появляется в том же контейнере, а слово «Finora» на узком экране уступает место (остаётся для скринридера)', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderAt('/wallets');
    await findByRole('heading', { name: 'Кошельки', level: 1 });
    expect(statusRow()).toHaveTextContent('Только на устройстве');
    expect(statusRow()).toHaveTextContent('Офлайн');
    expect(statusRow().querySelectorAll('[role="status"]')).toHaveLength(2);
    expect(statusRow().querySelector('[data-keep]')).toHaveTextContent('Офлайн'); // «Офлайн» не сжимается, сокращается соседний индикатор
    const word = Array.from(document.querySelectorAll('.sticky span')).find((s) => s.textContent === 'Finora') as HTMLElement;
    expect(word.className).toContain('sr-only');
  });

  it('с сетью слово «Finora» видно всегда', async () => {
    renderAt('/wallets');
    await findByRole('heading', { name: 'Кошельки', level: 1 });
    const word = Array.from(document.querySelectorAll('.sticky span')).find((s) => s.textContent === 'Finora') as HTMLElement;
    expect(word.className).not.toContain('sr-only');
  });
});

describe('каркас: планшет и ПК', () => {
  it('боковая панель включается с 768px (md), нижняя панель на этой ширине скрыта', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const aside = document.querySelector('aside') as HTMLElement;
    expect(aside.className).toContain('md:flex');
    expect(aside.className).not.toContain('lg:flex');
    const bottom = screen.getAllByRole('navigation', { name: 'Основная навигация' }).find((n) => n.className.includes('bottom-0')) as HTMLElement;
    expect(bottom.className).toContain('md:hidden');
    // под нижней панелью остаётся запас с учётом «чёлки» снизу (safe-area)
    expect((document.getElementById('main') as HTMLElement).className).toContain('env(safe-area-inset-bottom)');
  });
});
