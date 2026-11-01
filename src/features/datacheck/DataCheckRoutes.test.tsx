import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';
import { findByRole, screen } from '@/components/testUtils';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const renderAt = (path: string) => renderAppRoot(<AppRoutes />, { path, deps: makeTestDeps().deps });
const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('«Проверка данных» внутри «Операций»', () => {
  it('/transactions/check открывает экран проверки; подсвечена вкладка «Операции» (нижняя и боковая панели), а не «Ещё»', async () => {
    renderAt('/transactions/check');
    expect(await findByRole('heading', { name: 'Проверка данных', level: 1 })).toBeInTheDocument();
    const active = Array.from(document.querySelectorAll('[aria-current="page"]')).map((l) => norm(l.textContent));
    expect(active).toEqual(['Операции', 'Операции']); // нижняя панель телефона и боковая панель ПК
  });

  it('старый адрес /settings/data-check (закладка, ссылка) ведёт на тот же экран', async () => {
    renderAt('/settings/data-check');
    expect(await findByRole('heading', { name: 'Проверка данных', level: 1 })).toBeInTheDocument();
    // «Назад» над заголовком — в «Операции», а не в «Настройки»
    const back = screen.getAllByRole('link', { name: /Операции/ });
    expect(back.some((l) => l.getAttribute('href') === '/transactions' && l.getAttribute('aria-current') === null)).toBe(true);
  });

  it('в «Настройках» отдельной строки «Проверка данных» больше нет', async () => {
    renderAt('/settings');
    expect(await findByRole('heading', { name: 'Настройки', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Проверка данных/ })).toBeNull();
  });
});
