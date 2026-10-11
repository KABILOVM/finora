import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEnvProvider } from '@/app/env';
import { defaultDeps } from '@/app/deps';
import { render } from '@/components/testUtils';
import PushKeeper, { KEEPER_MIN_INTERVAL_MS, type PushKeeperProps } from './PushKeeper';
import type { KeeperOutcome } from './keeper';
import { readVapidConfig } from './config';
import { MSG_NAVIGATE, MSG_SUBSCRIPTION_CHANGED } from './navigate';
import { ENDPOINT, VAPID_PUBLIC, fakeCloud, installFakeBrowser, type FakeBrowser, type FakeCloud } from './__fixtures__/pushKit';

let browser: FakeBrowser | null = null;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  browser?.restore();
  browser = null;
  vi.useRealTimers();
  window.location.hash = '';
});

const deps: PushKeeperProps['deps'] = {
  vapid: () => readVapidConfig({ VITE_VAPID_PUBLIC_KEY: VAPID_PUBLIC }),
  deviceId: () => 'device-keeper-1',
  timezone: () => 'Asia/Dushanbe',
};

function mount(cloud: FakeCloud | null, props: Partial<PushKeeperProps> = {}) {
  const results: KeeperOutcome[] = [];
  const view = render(
    <AppEnvProvider value={{ client: cloud?.client ?? null, deps: defaultDeps }}>
      <PushKeeper deps={deps} startDelayMs={10} onResult={(o) => results.push(o)} {...props} />
    </AppEnvProvider>,
  );
  return { results, view };
}
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
};

describe('PushKeeper', () => {
  it('ничего не рисует и без провайдеров не падает (локальный режим): ни запросов, ни подписок', async () => {
    browser = installFakeBrowser({ permission: 'granted' });
    const results: KeeperOutcome[] = [];
    const view = render(<PushKeeper deps={deps} startDelayMs={10} onResult={(o) => results.push(o)} />);
    expect(view.container.innerHTML).toBe('');
    await tick(1000);
    expect(results).toEqual([]);
    expect(browser.state.subscribeCalls).toEqual([]);
  });

  it('с облаком: после короткой паузы делает одну сверку; невидимый', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const cloud = fakeCloud({ settings: { enabled: true }, subscriptions: [{ endpoint: ENDPOINT, device_id: 'device-keeper-1' }] });
    const { results, view } = mount(cloud);
    expect(view.container.innerHTML).toBe('');
    expect(results).toEqual([]);
    await tick(50);
    expect(results).toEqual(['ok']);
  });

  it('возвращение на вкладку чаще раза в 5 минут не запускает сверку; позже — запускает; скрытая вкладка — нет', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const cloud = fakeCloud({ settings: { enabled: true }, subscriptions: [{ endpoint: ENDPOINT, device_id: 'device-keeper-1' }] });
    const { results } = mount(cloud);
    await tick(50);
    expect(results).toHaveLength(1);

    setVisibility('visible');
    await tick(10);
    expect(results).toHaveLength(1); // слишком рано

    await tick(KEEPER_MIN_INTERVAL_MS);
    setVisibility('hidden');
    await tick(10);
    expect(results).toHaveLength(1); // вкладка скрыта

    setVisibility('visible');
    await tick(10);
    expect(results).toHaveLength(2);
    setVisibility('visible');
  });

  it('сообщение от сервис-воркера «подписку сменили» запускает сверку сразу, не дожидаясь паузы', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const cloud = fakeCloud({ settings: { enabled: true }, subscriptions: [{ endpoint: ENDPOINT, device_id: 'device-keeper-1' }] });
    const { results } = mount(cloud);
    await tick(50);
    expect(results).toHaveLength(1);
    act(() => browser!.fireMessage({ type: MSG_SUBSCRIPTION_CHANGED }));
    await tick(10);
    expect(results).toHaveLength(2);
    act(() => browser!.fireMessage({ type: 'что-то-другое' }));
    act(() => browser!.fireMessage('строка'));
    act(() => browser!.fireMessage(null));
    await tick(10);
    expect(results).toHaveLength(2);
  });

  it('сообщение «перейти на путь»: внутренний путь принимается, чужой адрес — нет', async () => {
    browser = installFakeBrowser({ permission: 'granted' });
    mount(fakeCloud());
    act(() => browser!.fireMessage({ type: MSG_NAVIGATE, path: '/debts/1' }));
    expect(window.location.hash).toBe('#/debts/1');
    for (const bad of ['//evil.com', 'javascript:alert(1)', 'https://evil', '\\evil', '/a\nb', 5, null]) {
      act(() => browser!.fireMessage({ type: MSG_NAVIGATE, path: bad }));
      expect(window.location.hash, String(bad)).toBe('#/debts/1');
    }
  });

  it('после размонтирования сверок больше нет', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const cloud = fakeCloud({ settings: { enabled: true }, subscriptions: [{ endpoint: ENDPOINT, device_id: 'device-keeper-1' }] });
    const { results, view } = mount(cloud, { startDelayMs: 1000 });
    view.unmount();
    await tick(5000);
    setVisibility('visible');
    act(() => browser!.fireMessage({ type: MSG_SUBSCRIPTION_CHANGED }));
    await tick(10);
    expect(results).toEqual([]);
    expect(cloud.calls).toEqual([]);
  });

  it('подписку сейчас меняет другая вкладка или кнопка раздела (блокировка занята) — сверка пропускается, а не ломает чужую работу', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const asked: unknown[] = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async (name: string, options: unknown, cb: (lock: unknown) => unknown) => (asked.push([name, options]), cb(null)) },
    });
    const cloud = fakeCloud({ settings: { enabled: true } });
    const { results } = mount(cloud);
    await tick(50);
    expect(results).toEqual(['skipped-busy']);
    expect(asked).toEqual([['finora-push-subscription', { ifAvailable: true }]]);
    expect(cloud.calls).toEqual([]);
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('сбой внутри сверки не доходит до экрана и не пишет console.error', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const cloud = fakeCloud({ settings: { enabled: true } });
    cloud.offline = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { results } = mount(cloud);
    await tick(50);
    expect(results).toEqual(['failed']);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
