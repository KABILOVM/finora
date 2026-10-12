import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VAPID_PUBLIC_KEY_LENGTH, readVapidConfig } from './config';
import {
  DENIED_HELP,
  classifySupport,
  ensureSubscription,
  explainSupport,
  getBrowserSubscription,
  iosVersion,
  matchesVapidKey,
  readPermission,
  requestPermission,
  toSubscriptionInput,
  unsubscribeThisDevice,
  type SupportEnv,
} from './subscription';
import { AUTH_SECRET, ENDPOINT, P256DH, UA, VAPID_PUBLIC, VAPID_PUBLIC_OTHER, installFakeBrowser, type FakeBrowser } from './__fixtures__/pushKit';

const keyOf = (k: string) => {
  const r = readVapidConfig({ VITE_VAPID_PUBLIC_KEY: k });
  if (!r.ok) throw new Error('ключ теста неверен');
  return r.bytes;
};

let browser: FakeBrowser | null = null;
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  browser?.restore();
  browser = null;
  vi.useRealTimers();
});

const env = (o: Partial<SupportEnv> = {}): SupportEnv => ({
  userAgent: UA.android,
  maxTouchPoints: 5,
  standalone: false,
  secure: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  ...o,
});

describe('classifySupport: что умеет устройство', () => {
  it('Android/ПК с push — supported', () => {
    expect(classifySupport(env())).toBe('supported');
    expect(classifySupport(env({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', maxTouchPoints: 0 }))).toBe('supported');
  });

  it('iPhone в обычной вкладке Safari — «добавьте на экран Домой» (даже если PushManager в вкладке есть или нет)', () => {
    expect(classifySupport(env({ userAgent: UA.iphone, standalone: false }))).toBe('ios-install');
    expect(classifySupport(env({ userAgent: UA.iphone, standalone: false, hasPushManager: false }))).toBe('ios-install');
  });

  it('iPhone с экрана «Домой», iOS 16.4 и новее — supported; iOS ниже 16.4 — «обновите iOS» даже с экрана «Домой»', () => {
    expect(classifySupport(env({ userAgent: UA.iphone, standalone: true }))).toBe('supported');
    expect(classifySupport(env({ userAgent: UA.iphone164, standalone: true }))).toBe('supported');
    expect(classifySupport(env({ userAgent: UA.iphone.replace('17_2', '16_3'), standalone: true }))).toBe('ios-old');
    expect(classifySupport(env({ userAgent: UA.iphoneOld, standalone: true }))).toBe('ios-old');
    expect(classifySupport(env({ userAgent: UA.iphoneOld, standalone: false }))).toBe('ios-old');
    expect(classifySupport(env({ userAgent: UA.iphone.replace('17_2', '16_10'), standalone: true }))).toBe('supported');
  });

  it('iPad под видом Mac (версию не видно): по экрану-касанию узнаём iOS и требуем «Домой»', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
    expect(iosVersion(mac)).toBeNull();
    expect(classifySupport(env({ userAgent: mac, maxTouchPoints: 5, standalone: false }))).toBe('ios-install');
    expect(classifySupport(env({ userAgent: mac, maxTouchPoints: 5, standalone: true }))).toBe('supported');
    // настоящий Mac (касаний нет) — обычный браузер
    expect(classifySupport(env({ userAgent: mac, maxTouchPoints: 0 }))).toBe('supported');
  });

  it('нет защищённого контекста / сервис-воркера / PushManager / Notification — недоступно', () => {
    expect(classifySupport(env({ secure: false }))).toBe('insecure');
    expect(classifySupport(env({ hasServiceWorker: false }))).toBe('unsupported');
    expect(classifySupport(env({ hasPushManager: false }))).toBe('unsupported');
    expect(classifySupport(env({ hasNotification: false }))).toBe('unsupported');
  });

  it('iosVersion разбирает версию из строки браузера', () => {
    expect(iosVersion(UA.iphone)).toBeCloseTo(17.02);
    expect(iosVersion(UA.iphone164)).toBeCloseTo(16.04);
    expect(iosVersion('Mozilla/5.0 (iPad; CPU OS 15_6 like Mac OS X)')).toBeCloseTo(15.06);
    expect(iosVersion(UA.android)).toBeNull();
    expect(iosVersion('')).toBeNull();
  });

  it('объяснения: у каждой причины есть понятный русский текст; для iPhone — про «Домой» и раздел «Установка на телефон»', () => {
    expect(explainSupport('supported')).toBeNull();
    expect(explainSupport('ios-install')).toMatch(/«Домой»/);
    expect(explainSupport('ios-install')).toMatch(/Установка на телефон/);
    expect(explainSupport('ios-old')).toMatch(/16\.4/);
    expect(explainSupport('insecure')).toMatch(/https/);
    expect(explainSupport('unsupported')).toMatch(/браузер/);
    expect(DENIED_HELP).toMatch(/Настройки → Уведомления → Sumoima/);
  });
});

describe('разрешение на уведомления', () => {
  it('читает текущее состояние; без Notification — unsupported', () => {
    browser = installFakeBrowser({ permission: 'granted' });
    expect(readPermission()).toBe('granted');
    browser.state.permission = 'denied';
    expect(readPermission()).toBe('denied');
    browser.restore();
    browser = installFakeBrowser({ without: ['Notification'] });
    expect(readPermission()).toBe('unsupported');
  });

  it('requestPermission: ответ «разрешить» / «запретить» / окно закрыли (default)', async () => {
    browser = installFakeBrowser({ permission: 'default', answer: 'granted' });
    expect(await requestPermission()).toBe('granted');
    browser.restore();
    browser = installFakeBrowser({ permission: 'default', answer: 'denied' });
    expect(await requestPermission()).toBe('denied');
    browser.restore();
    browser = installFakeBrowser({ permission: 'default', answer: 'default' });
    expect(await requestPermission()).toBe('default');
  });

  it('старый Safari: requestPermission принимает только функцию и ничего не возвращает — тоже работает', async () => {
    browser = installFakeBrowser({ permission: 'default' });
    (window as unknown as { Notification: unknown }).Notification = {
      get permission() {
        return 'granted';
      },
      requestPermission: (cb: (p: string) => void) => {
        setTimeout(() => cb('granted'), 0);
      },
    };
    expect(await requestPermission()).toBe('granted');
  });

  it('requestPermission не бросает, даже если браузер упал', async () => {
    browser = installFakeBrowser({ permission: 'default' });
    (window as unknown as { Notification: unknown }).Notification = {
      permission: 'default',
      requestPermission: () => {
        throw new Error('сломано');
      },
    };
    expect(await requestPermission()).toBe('default');
    browser.restore();
    browser = installFakeBrowser({ without: ['Notification'] });
    expect(await requestPermission()).toBe('unsupported');
  });
});

describe('ensureSubscription: оформление подписки', () => {
  it('разрешение выдано, подписки нет — subscribe с userVisibleOnly и ключом VAPID; подписка в виде для таблицы', async () => {
    browser = installFakeBrowser({ permission: 'granted' });
    const r = await ensureSubscription(keyOf(VAPID_PUBLIC));
    expect(r.ok).toBe(true);
    expect(browser.state.subscribeCalls).toHaveLength(1);
    const call = browser.state.subscribeCalls[0]!;
    expect(call.userVisibleOnly).toBe(true);
    expect(Array.from(call.applicationServerKey!)).toEqual(Array.from(keyOf(VAPID_PUBLIC)));
    if (r.ok) {
      expect(r.input).toMatchObject({ endpoint: ENDPOINT, p256dh: P256DH, authSecret: AUTH_SECRET });
      expect(r.input.deviceId.length).toBeGreaterThanOrEqual(8);
      expect(r.input.userAgent.length).toBeLessThanOrEqual(300);
    }
  });

  it('вопрос о разрешении здесь НЕ задаётся: нет разрешения — отказ без обращения к subscribe и без requestPermission', async () => {
    browser = installFakeBrowser({ permission: 'default' });
    expect(await ensureSubscription(keyOf(VAPID_PUBLIC))).toMatchObject({ ok: false, reason: 'no-permission' });
    expect(browser.state.permissionRequests).toBe(0);
    expect(browser.state.subscribeCalls).toEqual([]);
    browser.state.permission = 'denied';
    const denied = await ensureSubscription(keyOf(VAPID_PUBLIC));
    expect(denied).toMatchObject({ ok: false, reason: 'denied', message: DENIED_HELP });
    expect(browser.state.permissionRequests).toBe(0);
  });

  it('действующая подписка с тем же ключом берётся как есть (subscribe не вызывается); с другим ключом — снимается и оформляется новая', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const same = await ensureSubscription(keyOf(VAPID_PUBLIC));
    expect(same.ok).toBe(true);
    expect(browser.state.subscribeCalls).toEqual([]);

    const old = browser.state.sub!;
    const other = await ensureSubscription(keyOf(VAPID_PUBLIC_OTHER));
    expect(other.ok).toBe(true);
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.state.subscribeCalls).toHaveLength(1);
  });

  it('fresh: прежняя подписка снимается и оформляется новая', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const old = browser.state.sub!;
    browser.state.nextEndpoint = 'https://fcm.googleapis.com/fcm/send/bmV3LW9uZQ';
    const r = await ensureSubscription(keyOf(VAPID_PUBLIC), { fresh: true });
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(r.ok && r.input.endpoint).toBe('https://fcm.googleapis.com/fcm/send/bmV3LW9uZQ');
  });

  it('браузер отказал: NotAllowedError → «запрещено», остальное → «не получилось», текст без технических подробностей', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribeError: Object.assign(new Error('Registration failed - permission denied'), { name: 'NotAllowedError' }) });
    expect(await ensureSubscription(keyOf(VAPID_PUBLIC))).toMatchObject({ ok: false, reason: 'denied' });
    browser.restore();
    browser = installFakeBrowser({ permission: 'granted', subscribeError: Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' }) });
    const r = await ensureSubscription(keyOf(VAPID_PUBLIC));
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    if (!r.ok) expect(r.message).not.toMatch(/push service error|Registration/);
  });

  it('subscribe завис — через 30 секунд «служба не отвечает»', async () => {
    vi.useFakeTimers();
    browser = installFakeBrowser({ permission: 'granted', subscribeError: 'hang' });
    const pending = ensureSubscription(keyOf(VAPID_PUBLIC));
    await vi.advanceTimersByTimeAsync(30_100);
    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('сервис-воркер не запустился — через 10 секунд «модуль ещё не запущен»', async () => {
    vi.useFakeTimers();
    browser = installFakeBrowser({ permission: 'granted' });
    (navigator as unknown as { serviceWorker: { ready: Promise<never> } }).serviceWorker.ready = new Promise(() => undefined);
    const pending = ensureSubscription(keyOf(VAPID_PUBLIC));
    await vi.advanceTimersByTimeAsync(10_100);
    expect(await pending).toMatchObject({ ok: false, reason: 'no-worker' });
  });

  it('устройство без push — unsupported, без обращений к браузеру', async () => {
    browser = installFakeBrowser({ permission: 'granted', without: ['PushManager'] });
    expect(await ensureSubscription(keyOf(VAPID_PUBLIC))).toMatchObject({ ok: false, reason: 'unsupported' });
    browser.restore();
    browser = installFakeBrowser({ permission: 'granted', userAgent: UA.iphone, standalone: false });
    expect(await ensureSubscription(keyOf(VAPID_PUBLIC))).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('браузер выдал подписку без ключей — «неожиданный вид», а не падение', async () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    browser.state.sub!.toJSON = () => ({ endpoint: ENDPOINT }) as never;
    browser.state.sub!.getKey = () => null;
    expect(await ensureSubscription(keyOf(VAPID_PUBLIC))).toMatchObject({ ok: false, reason: 'bad-subscription' });
  });
});

describe('вспомогательное', () => {
  it('toSubscriptionInput: ключи берёт из toJSON, а если их там нет — из getKey; userAgent режет до 300', () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const sub = browser.state.sub as unknown as PushSubscription;
    expect(toSubscriptionInput(sub, 'dev-12345678', 'u'.repeat(900))).toEqual({ deviceId: 'dev-12345678', endpoint: ENDPOINT, p256dh: P256DH, authSecret: AUTH_SECRET, userAgent: 'u'.repeat(300) });
    (sub as unknown as { toJSON: () => unknown }).toJSON = () => ({ endpoint: ENDPOINT });
    const viaGetKey = toSubscriptionInput(sub, 'dev-12345678', 'ua');
    expect(viaGetKey?.p256dh).toBe(P256DH);
    expect(viaGetKey?.authSecret).toBe(AUTH_SECRET);
    (sub as unknown as { toJSON: () => unknown }).toJSON = () => {
      throw new Error('нет');
    };
    expect(toSubscriptionInput(sub, 'dev-12345678', 'ua')).toBeNull();
  });

  it('matchesVapidKey сравнивает ключ подписки с ключом сервера', () => {
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    const sub = browser.state.sub as unknown as PushSubscription;
    expect(matchesVapidKey(sub, keyOf(VAPID_PUBLIC))).toBe(true);
    expect(matchesVapidKey(sub, keyOf(VAPID_PUBLIC_OTHER))).toBe(false);
    expect(VAPID_PUBLIC).toHaveLength(VAPID_PUBLIC_KEY_LENGTH);
  });

  it('getBrowserSubscription и unsubscribeThisDevice', async () => {
    browser = installFakeBrowser({ permission: 'granted' });
    expect(await getBrowserSubscription()).toBeNull();
    expect(await unsubscribeThisDevice()).toBe(true);
    browser.restore();
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    expect(await getBrowserSubscription()).not.toBeNull();
    expect(await unsubscribeThisDevice()).toBe(true);
    expect(browser.state.sub).toBeNull();
    browser.restore();
    browser = installFakeBrowser({ permission: 'granted', subscribed: true });
    browser.state.sub!.unsubscribe.mockRejectedValueOnce(new Error('нет'));
    expect(await unsubscribeThisDevice()).toBe(false);
  });
});
