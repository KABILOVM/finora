import { lazy } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { findByRole, render, screen, user, waitFor } from '@/components/testUtils';
import { AppShell } from './AppShell';
import { isChunkLoadError } from './SectionBoundary';

/** Страница, которая падает при отрисовке, пока стоит флаг. */
const bomb = { armed: true };
function Bomb() {
  if (bomb.armed) throw new Error('Сломалась страница');
  return <h1>Починилась</h1>;
}

/** Страница, код которой не скачался (как отвечает Chrome при обрыве сети). */
const NotLoaded = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: http://x/assets/Page-1.js')));

function renderAt(path: string) {
  return render(
    <ErrorBoundary onReload={() => {}}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<h1>Главная</h1>} />
            <Route path="/transactions" element={<h1>Операции</h1>} />
            <Route path="/analytics" element={<Bomb />} />
            <Route path="/wallets" element={<NotLoaded />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ErrorBoundary>,
  );
}

const card = () => document.querySelector('[data-section-error]');
const navs = () => screen.queryAllByRole('navigation', { name: 'Основная навигация' });

let errorSpy: ReturnType<typeof vi.spyOn>;
// React в dev-режиме пробрасывает ошибку рендера в window 'error'; jsdom печатает её в консоль, если событие не отменено.
const muteWindowError = (e: ErrorEvent) => e.preventDefault();
beforeEach(() => {
  bomb.armed = true;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('error', muteWindowError);
});
afterEach(() => {
  window.removeEventListener('error', muteWindowError);
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('страница упала: «Раздел не загрузился», меню остаётся', () => {
  it('карточка — внутри main, навигация на месте, экрана «Что-то пошло не так» нет', async () => {
    renderAt('/analytics');
    expect(await findByRole('alert')).toHaveTextContent('Раздел не загрузился');
    expect(document.getElementById('main')?.contains(card())).toBe(true);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(navs().length).toBeGreaterThan(0);
    expect(screen.queryByText('Что-то пошло не так')).toBeNull();
  });

  it('«Повторить» рисует раздел заново', async () => {
    renderAt('/analytics');
    await findByRole('alert');
    bomb.armed = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await findByRole('heading', { name: 'Починилась', level: 1 })).toBeInTheDocument();
    expect(card()).toBeNull();
  });

  it('«На главную» уводит на «Главную» без перезагрузки; там карточки уже нет', async () => {
    renderAt('/analytics');
    await findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'На главную' }));
    expect(await findByRole('heading', { name: 'Главная', level: 1 })).toBeInTheDocument();
    expect(card()).toBeNull();
  });

  it('переход по меню сбрасывает карточку: другой раздел открывается как обычно', async () => {
    renderAt('/analytics');
    await findByRole('alert');
    await user.click(screen.getAllByRole('link', { name: 'Операции' })[0] as HTMLElement);
    expect(await findByRole('heading', { name: 'Операции', level: 1 })).toBeInTheDocument();
    expect(card()).toBeNull();
  });
});

describe('код страницы не скачался', () => {
  it('понятный текст про интернет; «Повторить» перезагружает (React.lazy запомнил отказ), «На главную» есть', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderAt('/wallets');
    expect(await findByRole('alert')).toHaveTextContent('Проверьте интернет');
    expect(screen.getByRole('button', { name: 'На главную' })).toBeInTheDocument();
    expect(navs().length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('без сети и без service worker перезагрузка открыла бы страницу браузера — вместо неё подсказка дождаться связи', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderAt('/wallets');
    await findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByText(/Дождитесь связи/)).toBeInTheDocument());
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('«Главная» упала', () => {
  it('кнопки «На главную» нет — только «Повторить»; меню остаётся', async () => {
    function HomeBomb(): never {
      throw new Error('Сломалась главная');
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomeBomb />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await findByRole('alert');
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'На главную' })).toBeNull();
    expect(navs().length).toBeGreaterThan(0);
  });
});

describe('isChunkLoadError', () => {
  it('узнаёт отказ загрузки кода в Chrome, Firefox, Safari и Vite; обычные ошибки — нет', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
    expect(isChunkLoadError('просто строка')).toBe(false);
  });
});
