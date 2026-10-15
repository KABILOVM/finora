import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REQUEST_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  listActiveSubscriptions,
  parseSettingsRow,
  parseSubscriptionRows,
  readReminderSettings,
  revokeDeviceSubscriptions,
  revokeOtherEndpointsOfDevice,
  saveReminderSettings,
  saveSubscription,
  sendTestReminder,
  settingsToColumns,
  subscriptionToRow,
} from './api';
import { DEFAULT_REMINDER_SETTINGS, type PushSubscriptionInput } from './contract';
import { AUTH_SECRET, ENDPOINT, ENDPOINT_2, OTHER_USER, P256DH, USER, fakeCloud } from './__fixtures__/pushKit';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SUB: PushSubscriptionInput = { deviceId: 'device-aaaa-1111', endpoint: ENDPOINT, p256dh: P256DH, authSecret: AUTH_SECRET, userAgent: 'Mozilla/5.0 test' };
const noUserIdSent = (c: ReturnType<typeof fakeCloud>) => c.calls.every((x) => x.payload === undefined || !('user_id' in x.payload));

describe('без облака (локальный режим)', () => {
  it('каждая операция честно отвечает «нужен вход в облако», ничего не бросает', async () => {
    const results = [
      await readReminderSettings(null),
      await saveReminderSettings(null, { enabled: true }),
      await listActiveSubscriptions(null),
      await saveSubscription(null, SUB),
      await revokeDeviceSubscriptions(null, { deviceId: 'd', endpoint: null }),
      await sendTestReminder(null),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, error: { kind: 'no-cloud' } });
    expect(await revokeOtherEndpointsOfDevice(null, 'd', ENDPOINT)).toBe(false);
  });
});

describe('настройки напоминаний', () => {
  it('строки ещё нет — value: null (значит, всё выключено)', async () => {
    const c = fakeCloud();
    expect(await readReminderSettings(c.client)).toEqual({ ok: true, value: null });
  });

  it('читает строку и переводит snake_case в camelCase', async () => {
    const c = fakeCloud({ settings: { enabled: true, hour_local: 21, timezone: 'Europe/Moscow', remind_payments: false, remind_debts: true, remind_daily: true, remind_budgets: true, show_details: true } });
    expect(await readReminderSettings(c.client)).toEqual({
      ok: true,
      value: { enabled: true, hourLocal: 21, timezone: 'Europe/Moscow', remindPayments: false, remindDebts: true, remindDaily: true, remindBudgets: true, showDetails: true },
    });
  });

  it('строка без колонки remind_budgets (схему ещё не обновили) читается как «лимиты выключены»', async () => {
    const c = fakeCloud({ settings: { enabled: true, hour_local: 9, timezone: 'UTC', remind_payments: true } });
    const r = await readReminderSettings(c.client);
    expect(r.ok && r.value?.remindBudgets).toBe(false);
  });

  it('чужие строки не читаются (имитация RLS): видна только своя', async () => {
    const c = fakeCloud({ settings: { enabled: true, hour_local: 7 } });
    c.tables.reminder_settings.push({ user_id: OTHER_USER, enabled: true, hour_local: 3, timezone: 'UTC' });
    const r = await readReminderSettings(c.client);
    expect(r.ok && r.value?.hourLocal).toBe(7);
  });

  it('данным ответа не верим вслепую: неверные типы и диапазоны заменяются значениями по умолчанию', () => {
    const d = DEFAULT_REMINDER_SETTINGS;
    expect(parseSettingsRow({ enabled: 'yes', hour_local: 99, timezone: 123, remind_payments: 1, remind_debts: null, remind_daily: 'true', show_details: {} })).toEqual(d);
    expect(parseSettingsRow({ hour_local: 9.5, timezone: 'x'.repeat(65) })).toEqual(d);
    expect(parseSettingsRow({ hour_local: -1, timezone: 'Не/Зона' })).toEqual(d);
    expect(parseSettingsRow({ hour_local: 0, timezone: 'UTC' })).toEqual({ ...d, hourLocal: 0, timezone: 'UTC' });
    for (const junk of [null, undefined, 5, 'строка', [], [{ enabled: true }]]) expect(parseSettingsRow(junk)).toBeNull();
  });

  it('первое сохранение создаёт строку: в теле только изменения (без user_id), конфликт по user_id; ответ сервера — то, что вернётся', async () => {
    const c = fakeCloud();
    const r = await saveReminderSettings(c.client, { enabled: true, timezone: 'Asia/Dushanbe' });
    expect(r).toMatchObject({ ok: true, value: { enabled: true, hourLocal: 9, timezone: 'Asia/Dushanbe', remindPayments: true, showDetails: false } });
    expect(c.tables.reminder_settings).toHaveLength(1);
    const call = c.calls.find((x) => x.op === 'upsert')!;
    expect(call.table).toBe('reminder_settings');
    expect(call.options).toEqual({ onConflict: 'user_id' });
    expect(Object.keys(call.payload!).sort()).toEqual(['enabled', 'timezone', 'updated_at']);
    expect(noUserIdSent(c)).toBe(true);
  });

  it('повторное сохранение правит только названные колонки, остальные не трогает, второй строки не появляется', async () => {
    const c = fakeCloud({ settings: { enabled: true, hour_local: 18, remind_daily: true, show_details: true, timezone: 'Europe/Moscow' } });
    const r = await saveReminderSettings(c.client, { hourLocal: 20 });
    expect(r).toMatchObject({ ok: true, value: { hourLocal: 20, remindDaily: true, showDetails: true, timezone: 'Europe/Moscow', enabled: true } });
    expect(c.tables.reminder_settings).toHaveLength(1);
    expect(c.tables.reminder_settings[0]).toMatchObject({ hour_local: 20, remind_daily: true, show_details: true });
  });

  it('переключатель лимитов бюджета: колонка remind_budgets, остальные настройки не трогаются', async () => {
    const c = fakeCloud({ settings: { enabled: true, hour_local: 18, remind_daily: true, timezone: 'Europe/Moscow' } });
    const r = await saveReminderSettings(c.client, { remindBudgets: true });
    expect(r).toMatchObject({ ok: true, value: { remindBudgets: true, remindDaily: true, hourLocal: 18 } });
    expect(c.tables.reminder_settings[0]).toMatchObject({ remind_budgets: true, remind_daily: true, hour_local: 18 });
    expect(settingsToColumns({ remindBudgets: false })).toEqual({ remind_budgets: false });
    expect(await saveReminderSettings(c.client, { remindBudgets: 'yes' } as never)).toMatchObject({ ok: false, error: { kind: 'invalid' } });
  });

  it('неверные изменения не уходят на сервер вообще (invalid, ни одного запроса)', async () => {
    const c = fakeCloud();
    const bad: Array<Record<string, unknown>> = [
      { hourLocal: 24 },
      { hourLocal: -1 },
      { hourLocal: 9.5 },
      { hourLocal: '9' },
      { hourLocal: NaN },
      { timezone: 'Not/AZone' },
      { timezone: '' },
      { timezone: 'x'.repeat(65) },
      { enabled: 'true' },
      { remindDaily: 1 },
      { remindBudgets: 0 },
      { showDetails: null },
    ];
    for (const b of bad) expect(await saveReminderSettings(c.client, b as never), JSON.stringify(b)).toMatchObject({ ok: false, error: { kind: 'invalid' } });
    expect(c.calls).toEqual([]);
    expect(settingsToColumns({})).toEqual({});
    expect(settingsToColumns({ hourLocal: 23, remindPayments: false })).toEqual({ hour_local: 23, remind_payments: false });
  });

  it('человеческие ошибки: нет сети, нет таблиц, нет прав, сессия, сервер — без английского текста сервера', async () => {
    const c = fakeCloud();
    const cases: Array<[string, { code?: string; message?: string }, number, string]> = [
      ['table', { code: '42P01', message: 'relation "reminder_settings" does not exist' }, 404, 'no-tables'],
      ['table', { code: 'PGRST205', message: "Could not find the table 'public.reminder_settings' in the schema cache" }, 404, 'no-tables'],
      ['table', { code: 'PGRST204', message: "Could not find the 'show_details' column" }, 400, 'no-tables'],
      ['table', { code: '42501', message: 'permission denied for table reminder_settings' }, 403, 'denied'],
      ['table', { code: 'PGRST301', message: 'JWT expired' }, 401, 'auth'],
      ['table', { message: 'whatever' }, 401, 'auth'],
      ['table', { code: 'XX000', message: 'internal secret detail' }, 500, 'server'],
    ];
    for (const [, error, status, kind] of cases) {
      c.failNext('reminder_settings', error, status);
      const r = await saveReminderSettings(c.client, { enabled: true });
      expect(r).toMatchObject({ ok: false, error: { kind } });
      if (!r.ok) {
        expect(r.error.message).toMatch(/[а-яё]/i);
        expect(r.error.message).not.toMatch(/relation|schema cache|JWT|permission denied|internal secret|column/i);
      }
    }
    c.offline = true;
    expect(await saveReminderSettings(c.client, { enabled: true })).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(await readReminderSettings(c.client)).toMatchObject({ ok: false, error: { kind: 'offline' } });
  });

  it('браузер знает, что сети нет — запрос даже не отправляется', async () => {
    const c = fakeCloud();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await saveReminderSettings(c.client, { enabled: true })).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(await sendTestReminder(c.client)).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(c.calls).toEqual([]);
    expect(c.invokes).toEqual([]);
  });

  it('сервер не отвечает — через 15 секунд «не ответил вовремя»', async () => {
    vi.useFakeTimers();
    const c = fakeCloud();
    c.hold();
    const pending = readReminderSettings(c.client);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });
});

describe('подписки устройств', () => {
  it('сохраняет подписку: колонки на месте, конфликт по (user_id, endpoint), user_id не отправляется', async () => {
    const c = fakeCloud();
    expect(await saveSubscription(c.client, SUB)).toEqual({ ok: true, value: true });
    const call = c.calls.find((x) => x.op === 'upsert')!;
    expect(call.table).toBe('push_subscriptions');
    expect(call.options).toEqual({ onConflict: 'user_id,endpoint' });
    expect(call.payload).toMatchObject({ device_id: SUB.deviceId, endpoint: ENDPOINT, p256dh: P256DH, auth_secret: AUTH_SECRET, user_agent: 'Mozilla/5.0 test', revoked_at: null });
    expect(noUserIdSent(c)).toBe(true);
    expect(c.tables.push_subscriptions).toHaveLength(1);
  });

  it('повторная подписка с тем же адресом не плодит строк и СНИМАЕТ прежнюю отписку', async () => {
    const c = fakeCloud({ subscriptions: [{ endpoint: ENDPOINT, device_id: SUB.deviceId, p256dh: 'старый-ключ-старый-ключ', auth_secret: 'старый-секрет', revoked_at: '2026-10-01T00:00:00Z' }] });
    expect(await saveSubscription(c.client, SUB)).toEqual({ ok: true, value: true });
    expect(c.tables.push_subscriptions).toHaveLength(1);
    expect(c.tables.push_subscriptions[0]).toMatchObject({ revoked_at: null, p256dh: P256DH });
  });

  it('userAgent обрезается до 300 символов', () => {
    const row = subscriptionToRow({ ...SUB, userAgent: 'u'.repeat(1000) }, 'now');
    expect(String(row?.user_agent)).toHaveLength(300);
  });

  it('подписка не по ограничениям таблицы не уходит на сервер: адрес не https, короткие ключи, пустой/длинный id устройства, слишком длинный адрес', async () => {
    const c = fakeCloud();
    const bad: PushSubscriptionInput[] = [
      { ...SUB, endpoint: 'http://push.example/abc' },
      { ...SUB, endpoint: 'https://a' },
      { ...SUB, endpoint: `https://push.example/${'a'.repeat(2100)}` },
      { ...SUB, p256dh: 'коротко' },
      { ...SUB, authSecret: '1234567' },
      { ...SUB, deviceId: '' },
      { ...SUB, deviceId: 'd'.repeat(65) },
      { ...SUB, endpoint: 5 as never },
    ];
    for (const b of bad) {
      const r = await saveSubscription(c.client, b);
      expect(r).toMatchObject({ ok: false, error: { kind: 'invalid' } });
    }
    expect(c.calls).toEqual([]);
  });

  it('в тексте ошибки нет ни адреса push, ни ключей', async () => {
    const c = fakeCloud();
    c.failNext('push_subscriptions', { code: '23514', message: `new row violates check constraint for ${ENDPOINT} ${P256DH}` }, 400);
    const r = await saveSubscription(c.client, SUB);
    expect(r.ok).toBe(false);
    const text = JSON.stringify(r);
    for (const secret of [ENDPOINT, P256DH, AUTH_SECRET, 'fcm.googleapis.com']) expect(text).not.toContain(secret);
  });

  it('список действующих: без отозванных и без чужих; мусорные строки отбрасываются', async () => {
    const c = fakeCloud({
      subscriptions: [
        { endpoint: ENDPOINT, device_id: 'd1' },
        { endpoint: ENDPOINT_2, device_id: 'd2', revoked_at: '2026-10-01T00:00:00Z' },
      ],
    });
    c.tables.push_subscriptions.push({ user_id: OTHER_USER, endpoint: 'https://push.example/other', device_id: 'x', revoked_at: null });
    expect(await listActiveSubscriptions(c.client)).toEqual({ ok: true, value: [{ deviceId: 'd1', endpoint: ENDPOINT }] });
    expect(parseSubscriptionRows([{ endpoint: 5, device_id: 'd' }, { endpoint: 'https://x', device_id: null }, null, 'x', { endpoint: 'https://ok.example/1', device_id: 'd', revoked_at: null }])).toEqual([{ deviceId: 'd', endpoint: 'https://ok.example/1' }]);
    expect(parseSubscriptionRows({ not: 'array' })).toEqual([]);
  });

  it('отзыв подписок ЭТОГО устройства: строки по id устройства и по адресу помечаются revoked_at, чужие устройства и чужой пользователь целы; удалений нет', async () => {
    const c = fakeCloud({
      subscriptions: [
        { endpoint: ENDPOINT, device_id: 'mine' },
        { endpoint: 'https://push.example/old-one', device_id: 'mine' }, // прежний адрес этого же устройства
        { endpoint: 'https://push.example/after-reset', device_id: 'другой-id-после-очистки' }, // адрес совпадёт с текущим
        { endpoint: ENDPOINT_2, device_id: 'phone' },
      ],
    });
    c.tables.push_subscriptions[2]!.endpoint = ENDPOINT; // тот же адрес под другим id устройства
    c.tables.push_subscriptions.push({ user_id: OTHER_USER, endpoint: 'https://push.example/someone-else', device_id: 'mine', revoked_at: null });
    const r = await revokeDeviceSubscriptions(c.client, { deviceId: 'mine', endpoint: ENDPOINT });
    expect(r).toEqual({ ok: true, value: { remaining: 1 } });
    const rows = c.tables.push_subscriptions;
    expect(rows.filter((x) => x.user_id === USER && x.revoked_at === null).map((x) => x.endpoint)).toEqual([ENDPOINT_2]);
    expect(rows.find((x) => x.user_id === OTHER_USER)!.revoked_at).toBeNull();
    expect(c.calls.map((x) => x.op).every((op) => op === 'update' || op === 'select')).toBe(true);
  });

  it('отзыв без сети не врёт: возвращает ошибку, строки не тронуты', async () => {
    const c = fakeCloud({ subscriptions: [{ endpoint: ENDPOINT, device_id: 'mine' }] });
    c.offline = true;
    expect(await revokeDeviceSubscriptions(c.client, { deviceId: 'mine', endpoint: ENDPOINT })).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(c.tables.push_subscriptions[0]!.revoked_at).toBeNull();
  });

  it('прежние адреса устройства отзываются, текущий остаётся', async () => {
    const c = fakeCloud({ subscriptions: [{ endpoint: 'https://push.example/old', device_id: 'mine' }, { endpoint: ENDPOINT, device_id: 'mine' }] });
    expect(await revokeOtherEndpointsOfDevice(c.client, 'mine', ENDPOINT)).toBe(true);
    expect(c.tables.push_subscriptions.map((x) => [x.endpoint, x.revoked_at === null])).toEqual([['https://push.example/old', false], [ENDPOINT, true]]);
  });
});

describe('«Проверить уведомление» (функция send-reminders)', () => {
  it('зовёт функцию send-reminders с телом {action:"test"}; успех — сколько устройств', async () => {
    const c = fakeCloud();
    c.fn.sent = 2;
    expect(await sendTestReminder(c.client)).toEqual({ ok: true, value: { sent: 2 } });
    expect(c.invokes).toEqual([{ name: 'send-reminders', options: { body: { action: 'test' } } }]);
  });

  it('ответ-строка JSON тоже читается', async () => {
    const c = fakeCloud();
    c.fn.mode = 'string-body';
    c.fn.sent = 3;
    expect(await sendTestReminder(c.client)).toEqual({ ok: true, value: { sent: 3 } });
  });

  it('ни одной подписки, ok:false, мусорный ответ — разные понятные причины', async () => {
    const c = fakeCloud();
    c.fn.mode = 'none';
    expect(await sendTestReminder(c.client)).toMatchObject({ ok: false, error: { kind: 'no-subscriptions' } });
    c.fn.mode = 'not-ok';
    expect(await sendTestReminder(c.client)).toMatchObject({ ok: false, error: { kind: 'server' } });
    c.fn.mode = 'garbage';
    expect(await sendTestReminder(c.client)).toMatchObject({ ok: false, error: { kind: 'server' } });
  });

  it('ошибки по-русски: функция не развёрнута (404), ключи не настроены (500), нет входа (401), слишком часто (429), сервер (503), нет сети, relay', async () => {
    const c = fakeCloud();
    const expected: Array<[typeof c.fn.mode, string, RegExp]> = [
      ['http-404', 'function-missing', /не развёрнута/],
      ['http-500', 'not-configured', /не настроены ключи/],
      ['http-401', 'auth', /Войдите заново/],
      ['http-429', 'rate-limited', /Слишком часто/],
      ['http-503', 'server', /недоступен/],
      ['network', 'offline', /Нет связи/],
      ['relay', 'server', /недоступен/],
    ];
    for (const [mode, kind, text] of expected) {
      c.fn.mode = mode;
      const r = await sendTestReminder(c.client);
      expect(r, mode).toMatchObject({ ok: false, error: { kind } });
      if (!r.ok) expect(r.error.message).toMatch(text);
    }
  });

  it('функция зависла — через 25 секунд «не ответил вовремя»', async () => {
    vi.useFakeTimers();
    const c = fakeCloud();
    c.fn.mode = 'hang';
    const pending = sendTestReminder(c.client);
    await vi.advanceTimersByTimeAsync(TEST_TIMEOUT_MS + 10);
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });
});
