import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@/components/testUtils';
import { isDeviceOptedOut } from '@/push/deviceFlag';
import { AUTH_SECRET, ENDPOINT, ENDPOINT_2, OTHER_USER, P256DH, UA, USER, fakeCloud, type FakeBrowser } from '@/push/__fixtures__/pushKit';
import { btn, click, hourSelect, maybeBtn, openReminders, pageText, seeText, text } from '@/push/__fixtures__/openReminders';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

let browser: FakeBrowser | null = null;
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  browser?.restore();
  browser = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const DEVICE_ROW = (id: string) => ({ endpoint: ENDPOINT, device_id: id, p256dh: P256DH, auth_secret: AUTH_SECRET });
const deviceId = () => localStorage.getItem('finora:deviceId') ?? '';

describe('Напоминания: состояния, в которых включить нельзя', () => {
  it('локальный режим: объясняет «нужно облако», кнопок нет, к серверу не ходит', async () => {
    const { cloud, browser: b } = await openReminders({ local: true, browser: { permission: 'default' } });
    browser = b;
    expect(text('Напоминания работают только при входе в облако.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(cloud.calls).toEqual([]);
    expect(b!.state.permissionRequests).toBe(0);
  });

  it('владелец не настроил ключ (пусто или заготовка): «не настроены владельцем», кнопки нет', async () => {
    for (const vapid of ['', 'YOUR-VAPID-PUBLIC-KEY']) {
      const { browser: b } = await openReminders({ vapid });
      browser = b;
      expect(text(/пока не настроены владельцем приложения/)).toBeTruthy();
      expect(maybeBtn('Включить напоминания')).toBeNull();
      b!.restore();
      document.body.innerHTML = '';
    }
  });

  it('iPhone в обычной вкладке Safari: объяснение про экран «Домой» и ссылка на раздел установки; вопроса о разрешении нет', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'default', userAgent: UA.iphone, standalone: false, without: ['PushManager'] } });
    browser = b;
    expect(text(/только в приложении, добавленном на экран «Домой»/)).toBeTruthy();
    expect(text(/Установка на телефон/)).toBeTruthy();
    expect(maybeBtn('Включить напоминания')).toBeNull();
    expect(cloud.calls).toEqual([]);
    expect(b!.state.permissionRequests).toBe(0);
  });

  it('iPhone со старой iOS: просит обновить систему', async () => {
    const { browser: b } = await openReminders({ browser: { userAgent: UA.iphoneOld, standalone: true } });
    browser = b;
    expect(text(/iOS 16\.4/)).toBeTruthy();
    expect(maybeBtn('Включить напоминания')).toBeNull();
  });

  it('браузер без push: понятное объяснение', async () => {
    const { browser: b } = await openReminders({ browser: { without: ['PushManager', 'Notification'] } });
    browser = b;
    expect(text(/не умеет присылать уведомления/)).toBeTruthy();
    expect(maybeBtn('Включить напоминания')).toBeNull();
  });

  it('разрешение запрещено в настройках: объяснение, как включить, кнопки включения нет, вопрос не задаётся', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'denied' } });
    browser = b;
    await seeText('Напоминания выключены.');
    expect(text(/Настройки → Уведомления → Finora/)).toBeTruthy();
    expect(maybeBtn('Включить напоминания')).toBeNull();
    expect(b!.state.permissionRequests).toBe(0);
    expect(cloud.calls.every((c) => c.op === 'select')).toBe(true);
  });

  it('не получилось прочитать настройки (в базе нет таблиц): понятная причина и «Повторить»; после починки всё открывается', async () => {
    const cloud = fakeCloud();
    cloud.failNext('reminder_settings', { code: '42P01', message: 'relation does not exist' }, 404);
    const { browser: b } = await openReminders({ cloud, browser: { permission: 'default' } });
    browser = b;
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/обновить схему базы/));
    expect(pageText()).not.toMatch(/relation|does not exist/);
    expect(maybeBtn('Включить напоминания')).toBeNull();
    await click('Повторить');
    await seeText('Напоминания выключены.');
    expect(btn('Включить напоминания')).toBeEnabled();
  });
});

describe('Напоминания: включение', () => {
  it('до нажатия кнопки ничего не спрашивается и не пишется; «выключены»', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'default' } });
    browser = b;
    await seeText('Напоминания выключены.');
    expect(btn('Включить напоминания')).toBeEnabled();
    expect(b!.state.permissionRequests).toBe(0);
    expect(b!.state.subscribeCalls).toEqual([]);
    expect(cloud.calls.every((c) => c.op === 'select')).toBe(true);
  });

  it('полный путь: разрешить → подписка → запись подписки → настройки; «включено» появляется только после ответа сервера', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'default', answer: 'granted' } });
    browser = b;
    await seeText('Напоминания выключены.');
    const release = cloud.hold();
    await click('Включить напоминания');
    // сервер ещё не ответил: «включено» нет, кнопка занята
    await waitFor(() => expect(b!.state.subscribeCalls).toHaveLength(1));
    expect(b!.state.permissionRequests).toBe(1);
    expect(text('Напоминания включены на этом устройстве.')).toBeNull();
    expect(text('Напоминания выключены.')).toBeTruthy();
    expect(btn('Включить напоминания')).toBeDisabled();
    await act(async () => release());
    await seeText('Напоминания включены на этом устройстве.');

    expect(b!.state.subscribeCalls[0]).toMatchObject({ userVisibleOnly: true });
    expect(cloud.tables.push_subscriptions).toHaveLength(1);
    expect(cloud.tables.push_subscriptions[0]).toMatchObject({ endpoint: ENDPOINT, device_id: deviceId(), p256dh: P256DH, auth_secret: AUTH_SECRET, revoked_at: null });
    expect(cloud.tables.reminder_settings[0]).toMatchObject({ enabled: true, hour_local: 9, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    // user_id нигде в теле не отправлен
    expect(cloud.calls.every((c) => !c.payload || !('user_id' in c.payload))).toBe(true);
    // настройки появились, по умолчанию «названия» выключены
    expect(hourSelect().value).toBe('9');
    expect(screen.getByRole('switch', { name: 'Показывать названия в уведомлении' }).getAttribute('aria-checked')).toBe('false');
    expect(maybeBtn('Включить напоминания')).toBeNull();
    expect(btn('Выключить на этом устройстве')).toBeEnabled();
    // личное на экран не попадает
    for (const secret of [ENDPOINT, P256DH, AUTH_SECRET, USER, 'me@example.com']) expect(pageText()).not.toContain(secret);
  });

  it('двойное нажатие безопасно: одно разрешение, одна подписка, одна строка', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'default' } });
    browser = b;
    await seeText('Напоминания выключены.');
    const button = btn('Включить напоминания');
    const release = cloud.hold();
    await act(async () => {
      button.click();
      button.click();
      button.click();
    });
    await act(async () => release());
    await seeText('Напоминания включены на этом устройстве.');
    expect(b!.state.permissionRequests).toBe(1);
    expect(b!.state.subscribeCalls).toHaveLength(1);
    expect(cloud.tables.push_subscriptions).toHaveLength(1);
    expect(cloud.tables.reminder_settings).toHaveLength(1);
  });

  it('человек нажал «Запретить»: показывается, как включить в настройках; подписки и записей нет', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'default', answer: 'denied' } });
    browser = b;
    await seeText('Напоминания выключены.');
    await click('Включить напоминания');
    await seeText(/Настройки → Уведомления → Finora/);
    expect(b!.state.subscribeCalls).toEqual([]);
    expect(cloud.calls.filter((c) => c.op !== 'select')).toEqual([]);
    expect(maybeBtn('Включить напоминания')).toBeNull();
    expect(text('Напоминания выключены.')).toBeTruthy();
  });

  it('человек закрыл окно вопроса: просим нажать ещё раз, кнопка остаётся', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'default', answer: 'default' } });
    browser = b;
    await seeText('Напоминания выключены.');
    await click('Включить напоминания');
    await seeText(/Разрешение на уведомления не получено/);
    expect(btn('Включить напоминания')).toBeEnabled();
    expect(cloud.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('браузер знает, что сети нет: честное сообщение, вопрос о разрешении не задаётся, «включено» нет', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'default' } });
    browser = b;
    await seeText('Напоминания выключены.');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await click('Включить напоминания');
    await seeText(/Нет связи с сервером/);
    expect(b!.state.permissionRequests).toBe(0);
    expect(text('Напоминания выключены.')).toBeTruthy();
    expect(cloud.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('сеть пропала уже после выдачи разрешения: запись не прошла — «включено» не показывается; повторное нажатие доделывает дело', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'granted' } });
    browser = b;
    await seeText('Напоминания выключены.');
    cloud.offline = true;
    await click('Включить напоминания');
    await seeText(/Нет связи с сервером/);
    expect(text('Напоминания включены на этом устройстве.')).toBeNull();
    expect(cloud.tables.reminder_settings).toHaveLength(0);
    cloud.offline = false;
    await click('Включить напоминания');
    await seeText('Напоминания включены на этом устройстве.');
    expect(cloud.tables.push_subscriptions.filter((r) => r.revoked_at === null)).toHaveLength(1);
  });

  it('браузер отказал оформить подписку: причина по-русски, на сервер ничего не записано', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'granted', subscribeError: Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' }) } });
    browser = b;
    await seeText('Напоминания выключены.');
    await click('Включить напоминания');
    await seeText(/Не получилось включить уведомления на этом устройстве/);
    expect(pageText()).not.toMatch(/push service error|Registration/);
    expect(cloud.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('подписка записалась, а включить напоминания в настройках не вышло: честно говорим об этом и не показываем «включено»', async () => {
    const { cloud, browser: b } = await openReminders({ browser: { permission: 'granted' } });
    browser = b;
    await seeText('Напоминания выключены.');
    cloud.failNext('reminder_settings:upsert', { code: 'XX000' }, 500);
    await click('Включить напоминания');
    await seeText(/Устройство подключено, но включить напоминания не удалось/);
    expect(text('Напоминания включены на этом устройстве.')).toBeNull();
    await click('Включить напоминания');
    await seeText('Напоминания включены на этом устройстве.');
  });

  it('в браузере осталась подписка, которую сервер за этим человеком не знает (чужая на общем телефоне): включение оформляет НОВУЮ, чужая запись не тронута', async () => {
    const cloud = fakeCloud();
    cloud.tables.push_subscriptions.push({ id: 'x', user_id: OTHER_USER, endpoint: ENDPOINT, device_id: 'shared-phone', revoked_at: null });
    const { browser: b } = await openReminders({ cloud, browser: { permission: 'granted', subscribed: true } });
    browser = b;
    const stale = b!.state.sub!;
    b!.state.nextEndpoint = ENDPOINT_2;
    await seeText('Напоминания выключены.');
    await click('Включить напоминания');
    await seeText('Напоминания включены на этом устройстве.');
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    const mine = cloud.tables.push_subscriptions.filter((r) => r.user_id === USER);
    expect(mine.map((r) => [r.endpoint, r.revoked_at])).toEqual([[ENDPOINT_2, null]]);
    expect(cloud.tables.push_subscriptions.find((r) => r.user_id === OTHER_USER)).toMatchObject({ endpoint: ENDPOINT, revoked_at: null });
  });

  it('включено на другом устройстве, а здесь нет: так и написано; кнопка «Включить на этом устройстве» добавляет только это устройство и не меняет час', async () => {
    const cloud = fakeCloud({ settings: { enabled: true, hour_local: 20 }, subscriptions: [{ endpoint: ENDPOINT_2, device_id: 'phone-other' }] });
    const { browser: b } = await openReminders({ cloud, browser: { permission: 'granted' } });
    browser = b;
    await seeText('Напоминания включены для вашего аккаунта, но не на этом устройстве.');
    expect(hourSelect().value).toBe('20');
    await click('Включить на этом устройстве');
    await seeText('Напоминания включены на этом устройстве.');
    expect(cloud.tables.reminder_settings[0]!.hour_local).toBe(20);
    expect(cloud.tables.push_subscriptions.filter((r) => r.revoked_at === null).map((r) => r.endpoint).sort()).toEqual([ENDPOINT, ENDPOINT_2].sort());
  });
});

describe('Напоминания: выключение на этом устройстве', () => {
  it('другие устройства остаются: подписка этого отозвана, на аккаунте «включено» сохраняется, устройство помечено «не подписывать обратно»', async () => {
    localStorage.setItem('finora:deviceId', 'device-this-0001');
    const cloud = fakeCloud({ settings: { enabled: true }, subscriptions: [DEVICE_ROW('device-this-0001'), { endpoint: ENDPOINT_2, device_id: 'phone-other' }] });
    const { browser: b } = await openReminders({ cloud, browser: { permission: 'granted', subscribed: true } });
    browser = b;
    await seeText('Напоминания включены на этом устройстве.');
    await click('Выключить на этом устройстве');
    await seeText(/На этом устройстве напоминания выключены\. На других устройствах они остаются\./);
    expect(cloud.tables.push_subscriptions.find((r) => r.endpoint === ENDPOINT)!.revoked_at).not.toBeNull();
    expect(cloud.tables.push_subscriptions.find((r) => r.endpoint === ENDPOINT_2)!.revoked_at).toBeNull();
    expect(cloud.tables.reminder_settings[0]!.enabled).toBe(true);
    expect(b!.state.sub).toBeNull(); // в браузере подписка тоже снята
    expect(isDeviceOptedOut(USER)).toBe(true);
    expect(text('Напоминания включены для вашего аккаунта, но не на этом устройстве.')).toBeTruthy();
    expect(cloud.calls.every((c) => c.op !== ('delete' as never))).toBe(true);
  });

  it('это было единственное устройство: напоминания на аккаунте выключаются (enabled=false)', async () => {
    localStorage.setItem('finora:deviceId', 'device-this-0001');
    const cloud = fakeCloud({ settings: { enabled: true }, subscriptions: [DEVICE_ROW('device-this-0001')] });
    const { browser: b } = await openReminders({ cloud, browser: { permission: 'granted', subscribed: true } });
    browser = b;
    await seeText('Напоминания включены на этом устройстве.');
    await click('Выключить на этом устройстве');
    await seeText('Напоминания выключены.');
    expect(cloud.tables.reminder_settings[0]!.enabled).toBe(false);
    expect(cloud.tables.push_subscriptions.every((r) => r.revoked_at !== null)).toBe(true);
    expect(maybeBtn('Включить напоминания')).toBeTruthy();
  });

  it('нет сети: ничего не меняется (ни в базе, ни на экране), сообщение понятное', async () => {
    localStorage.setItem('finora:deviceId', 'device-this-0001');
    const cloud = fakeCloud({ settings: { enabled: true }, subscriptions: [DEVICE_ROW('device-this-0001')] });
    const { browser: b } = await openReminders({ cloud, browser: { permission: 'granted', subscribed: true } });
    browser = b;
    await seeText('Напоминания включены на этом устройстве.');
    cloud.offline = true;
    await click('Выключить на этом устройстве');
    await seeText(/Нет связи с сервером/);
    expect(text('Напоминания включены на этом устройстве.')).toBeTruthy();
    expect(cloud.tables.push_subscriptions[0]!.revoked_at).toBeNull();
    expect(b!.state.sub).not.toBeNull();
    expect(isDeviceOptedOut(USER)).toBe(false);
  });

  it('повторное «Включить» после выключения снимает пометку и подписывает заново', async () => {
    localStorage.setItem('finora:deviceId', 'device-this-0001');
    const cloud = fakeCloud({ settings: { enabled: true }, subscriptions: [DEVICE_ROW('device-this-0001')] });
    const { browser: b } = await openReminders({ cloud, browser: { permission: 'granted', subscribed: true } });
    browser = b;
    await seeText('Напоминания включены на этом устройстве.');
    await click('Выключить на этом устройстве');
    await seeText('Напоминания выключены.');
    await click('Включить напоминания');
    await seeText('Напоминания включены на этом устройстве.');
    expect(isDeviceOptedOut(USER)).toBe(false);
    expect(cloud.tables.push_subscriptions.filter((r) => r.revoked_at === null)).toHaveLength(1);
  });
});
