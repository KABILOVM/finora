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

describe('плашка локального режима: одна строка с действием', () => {
  it('на «Главной»: «Облако не подключено» и ссылка «Сделать копию» в «Настройки»', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    const el = banner() as HTMLElement;
    expect(el).not.toBeNull();
    // видимая часть — коротко: заголовок и действие; полная фраза — для скринридера
    const visible = Array.from(el.querySelectorAll('strong, a')).map((n) => n.textContent?.trim());
    expect(visible).toEqual(['Облако не подключено', 'Сделать копию']);
    expect(el.textContent).toContain('данные хранятся только на этом устройстве');
    const link = el.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/settings');
  });

  it('ссылка ведёт в «Настройки»', async () => {
    renderAt('/');
    await findByRole('heading', { name: 'Главная', level: 1 });
    await user.click(screen.getByRole('link', { name: /Сделать копию/ }));
    expect(await findByRole('heading', { name: 'Настройки', level: 1 })).toBeInTheDocument();
  });

  it('в самих «Настройках» плашка остаётся, но без ссылки (резервная копия — там же)', async () => {
    renderAt('/settings');
    await findByRole('heading', { name: 'Настройки', level: 1 });
    expect(banner()).not.toBeNull();
    expect(banner()?.querySelector('a')).toBeNull();
  });

  it('на «Операциях» и «Кошельках» плашки нет', async () => {
    renderAt('/transactions');
    await findByRole('heading', { name: 'Операции', level: 1 });
    expect(banner()).toBeNull();
  });
});
