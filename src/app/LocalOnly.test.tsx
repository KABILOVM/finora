import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { findByRole, screen, user } from '@/components/testUtils';
import { makeTestDeps, renderAppRoot } from './testkit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const renderAt = (path: string) => renderAppRoot(<AppRoutes />, { path, deps: makeTestDeps().deps });
const banner = () => document.querySelector('[data-testid="local-mode-banner"]') as HTMLElement | null;

describe('локальный режим: значок в шапке вместо плашки над страницей', () => {
  it('плашки «Облако не подключено · Сделать копию» над «Главной» больше нет: она повторяла значок', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    expect(banner()).toBeNull();
    expect(screen.queryByText('Сделать копию')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('значок «Только на устройстве» — ссылка в «Настройки» (к резервной копии), доступное имя говорит об этом', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('Только на устройстве')) as HTMLElement;
    expect(status).toBeTruthy();
    expect(status.getAttribute('title')).toContain('Облако не подключено');
    expect(status.getAttribute('title')).toContain('сделать копию');
    const link = status.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/settings');
    await user.click(link);
    expect(await findByRole('heading', { name: 'Настройки', level: 1 })).toBeInTheDocument();
  });

  it('плашки нет ни в «Настройках», ни на «Операциях»', async () => {
    renderAt('/settings');
    await findByRole('heading', { name: 'Настройки', level: 1 });
    expect(banner()).toBeNull();
  });
});
