import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_USER_ID } from '@/auth/config';
import { DEFAULT_REMINDER_SETTINGS } from './contract';
import { readVapidConfig } from './config';
import { setDeviceOptedOut } from './deviceFlag';
import { runKeeperCheck, type KeeperDeps } from './keeper';
import { ENDPOINT, ENDPOINT_2, OTHER_USER, UA, USER, VAPID_PUBLIC, VAPID_PUBLIC_OTHER, fakeCloud, installFakeBrowser, type FakeBrowser, type FakeCloud } from './__fixtures__/pushKit';

const DEVICE = 'device-keeper-1';
const vapid = (k = VAPID_PUBLIC) => (() => readVapidConfig({ VITE_VAPID_PUBLIC_KEY: k })) as KeeperDeps['vapid'];
const base: Partial<KeeperDeps> = { vapid: vapid(), deviceId: () => DEVICE, timezone: () => 'Asia/Dushanbe' };

let browser: FakeBrowser | null = null;
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  browser?.restore();
  browser = null;
});

const writes = (c: FakeCloud) => c.calls.filter((x) => x.op !== 'select');
const enabledCloud = (extra: Parameters<typeof fakeCloud>[0] = {}) => fakeCloud({ settings: { enabled: true, timezone: 'Asia/Dushanbe' }, ...extra });

describe('runKeeperCheck: условия, при которых сторож молчит', () => {
  it('нет облака / не настроено владельцем / устройство не умеет push / нет разрешения / нет сети — ни одного обращения к серверу', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const c = enabledCloud();
    expect(await runKeeperCheck(null, base)).toBe('skipped-no-cloud');
    expect(await runKeeperCheck(c.client, { ...base, vapid: () => ({ ok: false, reason: 'missing' }) })).toBe('skipped-not-configured');
    expect(await runKeeperCheck(c.client, { ...base, support: () => 'ios-install' })).toBe('skipped-unsupported');
    expect(await runKeeperCheck(c.client, { ...base, online: () => false })).toBe('skipped-offline');
    for (const p of ['default', 'denied'] as const) {
      browser.state.permission = p;
      expect(await runKeeperCheck(c.client, base)).toBe('skipped-permission');
    }
    expect(c.calls).toEqual([]);
    expect(browser.state.permissionRequests).toBe(0); // сторож НИКОГДА не задаёт вопрос о разрешении
    expect(browser.state.subscribeCalls).toEqual([]);
  });

  it('никто не вошёл или это локальный режим — молчит', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const noOne = fakeCloud({ userId: null });
    expect(await runKeeperCheck(noOne.client, base)).toBe('skipped-signed-out');
    const local = enabledCloud();
    (local.client.auth as unknown as { getSession: unknown }).getSession = async () => ({ data: { session: { user: { id: LOCAL_USER_ID } } } });
    expect(await runKeeperCheck(local.client, base)).toBe('skipped-signed-out');
    expect(noOne.calls).toEqual([]);
    expect(local.calls).toEqual([]);
  });

  it('напоминания не включены (строки нет или enabled=false) — ничего не пишет и не подписывает', async () => {
    browser = installFakeBrowser({ permission: 'granted' });
    for (const c of [fakeCloud(), fakeCloud({ settings: { enabled: false } })]) {
      expect(await runKeeperCheck(c.client, base)).toBe('skipped-disabled');
      expect(writes(c)).toEqual([]);
    }
    expect(browser.state.subscribeCalls).toEqual([]);
  });

  it('человек выключил напоминания на ЭТОМ устройстве — сторож не подписывает его обратно, хотя на аккаунте они включены', async () => {
    browser = installFakeBrowser({ permission: 'granted' });
    const c = enabledCloud();
    setDeviceOptedOut(USER, true);
    expect(await runKeeperCheck(c.client, base)).toBe('skipped-device-off');
    expect(browser.state.subscribeCalls).toEqual([]);
    expect(writes(c)).toEqual([]);
    // у другого пользователя на этом же устройстве отметки нет
    setDeviceOptedOut(USER, false);
    expect(await runKeeperCheck(c.client, base)).toBe('updated');
  });
});

describe('runKeeperCheck: сверка подписки', () => {
  it('всё в порядке (подписка в браузере записана на сервере, пояс тот же) — ничего не пишет', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const c = enabledCloud({ subscriptions: [{ endpoint: ENDPOINT, device_id: DEVICE }] });
    expect(await runKeeperCheck(c.client, base)).toBe('ok');
    expect(writes(c)).toEqual([]);
    expect(browser.state.subscribeCalls).toEqual([]);
  });

  it('часовой пояс устройства изменился — обновляется ТОЛЬКО timezone', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const c = enabledCloud({ subscriptions: [{ endpoint: ENDPOINT, device_id: DEVICE }] });
    expect(await runKeeperCheck(c.client, { ...base, timezone: () => 'Europe/Moscow' })).toBe('updated');
    const w = writes(c);
    expect(w).toHaveLength(1);
    expect(Object.keys(w[0]!.payload!).sort()).toEqual(['timezone', 'updated_at']);
    expect(c.tables.reminder_settings[0]).toMatchObject({ timezone: 'Europe/Moscow', enabled: true, hour_local: DEFAULT_REMINDER_SETTINGS.hourLocal });
  });

  it('разрешение есть, а подписки в браузере нет — подписывается заново и сохраняет', async () => {
    browser = installFakeBrowser({ permission: 'granted' });
    const c = enabledCloud();
    expect(await runKeeperCheck(c.client, base)).toBe('updated');
    expect(browser.state.subscribeCalls).toHaveLength(1);
    expect(browser.state.permissionRequests).toBe(0);
    expect(c.tables.push_subscriptions).toHaveLength(1);
    expect(c.tables.push_subscriptions[0]).toMatchObject({ endpoint: ENDPOINT, device_id: DEVICE, revoked_at: null });
  });

  it('адреса в браузере нет среди записей пользователя (браузер сам его сменил или он чужой) — оформляется СВОЯ новая подписка, а не забирается найденная', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: ENDPOINT_2 });
    const first = browser.state.sub!;
    browser.state.nextEndpoint = ENDPOINT;
    const c = enabledCloud({ subscriptions: [{ endpoint: 'https://push.example.test/old-endpoint-of-this-device', device_id: DEVICE }] });
    expect(await runKeeperCheck(c.client, base)).toBe('updated');
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.state.sub!.endpoint).toBe(ENDPOINT);
    const active = c.tables.push_subscriptions.filter((r) => r.user_id === USER && r.revoked_at === null);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ endpoint: ENDPOINT, device_id: DEVICE });
  });

  it('подписку создал другой человек на этом же телефоне (у этого пользователя записей для устройства нет) — оформляется СВОЯ новая, чужая снимается', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: ENDPOINT });
    const first = browser.state.sub!;
    browser.state.nextEndpoint = ENDPOINT_2;
    const c = enabledCloud();
    c.tables.push_subscriptions.push({ id: 'x', user_id: OTHER_USER, endpoint: ENDPOINT, device_id: DEVICE, revoked_at: null });
    expect(await runKeeperCheck(c.client, base)).toBe('updated');
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.state.sub!.endpoint).toBe(ENDPOINT_2);
    const mine = c.tables.push_subscriptions.filter((r) => r.user_id === USER);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ endpoint: ENDPOINT_2, revoked_at: null });
    expect(c.tables.push_subscriptions.find((r) => r.user_id === OTHER_USER)!.endpoint).toBe(ENDPOINT); // чужую запись не трогаем
  });

  it('ключ сервера (VAPID) сменили — прежняя подписка снимается, оформляется новая с новым ключом', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const old = browser.state.sub!;
    browser.state.nextEndpoint = ENDPOINT_2;
    const c = enabledCloud({ subscriptions: [{ endpoint: ENDPOINT, device_id: DEVICE }] });
    expect(await runKeeperCheck(c.client, { ...base, vapid: vapid(VAPID_PUBLIC_OTHER) })).toBe('updated');
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(c.tables.push_subscriptions.filter((r) => r.revoked_at === null).map((r) => r.endpoint)).toEqual([ENDPOINT_2]);
  });
});

describe('runKeeperCheck: сбои не бросают исключений', () => {
  it('сервер не отвечает / нет таблиц / сеть пропала по пути — «failed», без записей и без падения', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const c = enabledCloud({ subscriptions: [{ endpoint: ENDPOINT, device_id: DEVICE }] });
    c.failNext('reminder_settings', { code: '42P01' }, 404);
    expect(await runKeeperCheck(c.client, base)).toBe('failed');
    c.failNext('push_subscriptions', { code: 'XX000' }, 500);
    expect(await runKeeperCheck(c.client, base)).toBe('failed');
    c.offline = true;
    expect(await runKeeperCheck(c.client, base)).toBe('failed');
    expect(writes(c)).toEqual([]);
  });

  it('браузер отказал в подписке — «failed», сервер не меняется', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribeError: new Error('push service error') });
    const c = enabledCloud();
    expect(await runKeeperCheck(c.client, base)).toBe('failed');
    expect(writes(c)).toEqual([]);
  });

  it('любое неожиданное исключение внутри поглощается', async () => {
    const c = enabledCloud();
    const boom = (): never => {
      throw new Error('сломалось окружение');
    };
    expect(await runKeeperCheck(c.client, { ...base, support: boom })).toBe('failed');
    expect(await runKeeperCheck(c.client, { ...base, browserSubscription: () => Promise.reject(new Error('x')) , support: () => 'supported', permission: () => 'granted', online: () => true })).toBe('failed');
  });

  it('на iPhone в обычной вкладке (без «Домой») сторож молчит и не трогает сервер', async () => {
    browser = installFakeBrowser({ permission: 'granted', userAgent: UA.iphone, standalone: false });
    const c = enabledCloud();
    expect(await runKeeperCheck(c.client, base)).toBe('skipped-unsupported');
    expect(c.calls).toEqual([]);
  });
});
