import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { releasePushOnThisDevice } from './release';
import { ENDPOINT, ENDPOINT_2, UA, fakeCloud, installFakeBrowser, type FakeBrowser } from './__fixtures__/pushKit';

let browser: FakeBrowser | null = null;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('finora:deviceId', 'device-this-0001');
});
afterEach(() => {
  browser?.restore();
  browser = null;
  vi.useRealTimers();
});

describe('releasePushOnThisDevice: освободить устройство при выходе из аккаунта', () => {
  it('отзывает подписки этого устройства на сервере и снимает подписку в браузере; настройки аккаунта и другие устройства не трогает', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const c = fakeCloud({ settings: { enabled: true }, subscriptions: [{ endpoint: ENDPOINT, device_id: 'device-this-0001' }, { endpoint: ENDPOINT_2, device_id: 'phone' }] });
    await releasePushOnThisDevice(c.client);
    expect(c.tables.push_subscriptions.find((r) => r.endpoint === ENDPOINT)!.revoked_at).not.toBeNull();
    expect(c.tables.push_subscriptions.find((r) => r.endpoint === ENDPOINT_2)!.revoked_at).toBeNull();
    expect(c.tables.reminder_settings[0]!.enabled).toBe(true);
    expect(browser.state.sub).toBeNull();
  });

  it('нет сети: сервер недоступен, но подписка в браузере всё равно снимается; ошибок нет', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const c = fakeCloud({ subscriptions: [{ endpoint: ENDPOINT, device_id: 'device-this-0001' }] });
    c.offline = true;
    await expect(releasePushOnThisDevice(c.client)).resolves.toBeUndefined();
    expect(browser.state.sub).toBeNull();
    expect(c.tables.push_subscriptions[0]!.revoked_at).toBeNull();
  });

  it('сервер завис: выход не ждёт дольше заданного времени', async () => {
    vi.useFakeTimers();
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const c = fakeCloud();
    c.hold();
    const p = releasePushOnThisDevice(c.client, 500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toBeUndefined();
  });

  it('нет облака / устройство без push / разрешения нет и подписки нет — ничего не делает', async () => {
    browser = installFakeBrowser({ permission: 'default' });
    const c = fakeCloud();
    await releasePushOnThisDevice(null);
    await releasePushOnThisDevice(c.client);
    expect(c.calls).toEqual([]);
    browser.restore();
    browser = installFakeBrowser({ permission: 'granted', userAgent: UA.iphone, standalone: false });
    await releasePushOnThisDevice(c.client);
    expect(c.calls).toEqual([]);
  });
});
