import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { findByRole, render, screen } from './components/testUtils';
import { UpdatePromptHost } from './components/UpdatePrompt';

// Новая версия ждёт: подсказка «Доступна новая версия» обязана быть видна — ровно одна.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [true, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
  window.location.hash = '#/';
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('подсказка об обновлении', () => {
  it('само приложение (App) её не рисует: настоящая стоит снаружи, в main.tsx', async () => {
    render(<App />);
    await findByRole('heading', { name: 'Главная', level: 1 });
    expect(screen.queryByText('Доступна новая версия')).toBeNull();
  });

  it('в оболочке, как в main.tsx, подсказка одна — не две', async () => {
    render(
      <UpdatePromptHost>
        <App />
      </UpdatePromptHost>,
    );
    await findByRole('heading', { name: 'Главная', level: 1 });
    expect(screen.getAllByText('Доступна новая версия')).toHaveLength(1);
  });
});
