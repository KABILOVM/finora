// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PUSH_TTL_SECONDS, createHandler } from '../../supabase/functions/send-reminders/index';
import { CRON, FakeStore, SERVICE_KEY, URL_BASE, USER_A, USER_B, USER_C, captureConsole, deps, envOf, fakeJwt, fakeSender, request, settings, sub } from './testkit';

const RULE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе

const log = captureConsole();

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const allText = () => log.text();

describe('протокол: CORS, методы, заголовок Authorization', () => {
  it('OPTIONS: 204 с заголовками CORS, без проверки настроек и без тела', async () => {
    const h = createHandler(deps({ env: envOf({ CRON_SECRET: undefined }) }));
    const r = await h(request('OPTIONS'));
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const allowed = (r.headers.get('access-control-allow-headers') ?? '').split(',').map((s) => s.trim());
    for (const name of ['authorization', 'apikey', 'content-type', 'x-client-info']) expect(allowed).toContain(name);
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
    expect(await r.text()).toBe('');
  });

  it.each(['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('%s → 405 JSON, даже с верным секретом; хранилище не трогается', async (method) => {
    const h = createHandler(deps());
    const r = await h(request(method, { token: CRON }));
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toContain('POST');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    if (method !== 'HEAD') expect(await json(r)).toEqual({ ok: false, error: 'method_not_allowed' });
  });

  it('нет заголовка / не Bearer / пустой токен / чужой секрет / секрет с приставкой и суффиксом → 401, ничего не читается и не отправляется', async () => {
    const send = fakeSender();
    const h = createHandler(deps({ send }));
    const bad: Array<Parameters<typeof request>[1]> = [
      {},
      { authorization: '' },
      { authorization: 'Basic abc' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer ' },
      { authorization: `Token ${CRON}` },
      { token: 'x' },
      { token: CRON.slice(0, -1) },
      { token: `${CRON}x` },
      { token: `${CRON}%20` },
      { token: CRON.toUpperCase() },
      { token: 'z'.repeat(CRON.length) },
      { token: 'A'.repeat(5000) },
      { authorization: `Bearer ${CRON} extra` },
    ];
    for (const init of bad) {
      const r = await h(request('POST', { ...init, body: {} }));
      expect(r.status, JSON.stringify(init).slice(0, 60)).toBe(401);
      expect(await json(r)).toEqual({ ok: false, error: 'unauthorized' });
      expect(r.headers.get('access-control-allow-origin')).toBe('*');
    }
    expect(send.calls).toEqual([]);
  });

  it('все ответы — JSON без кэша, с CORS', async () => {
    const store = new FakeStore();
    const h = createHandler(deps({ store }));
    for (const r of [await h(request('POST', { token: CRON, body: {} })), await h(request('POST', { token: 'bad' })), await h(request('GET'))]) {
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('access-control-allow-origin')).toBe('*');
    }
  });
});

describe('настройки: «не настроено» — 500 без подробностей', () => {
  const cases: Array<[string, Record<string, string | undefined>]> = [
    ['нет CRON_SECRET', { CRON_SECRET: undefined }],
    ['CRON_SECRET короче 32', { CRON_SECRET: 'c'.repeat(31) }],
    ['нет SUPABASE_SERVICE_ROLE_KEY', { SUPABASE_SERVICE_ROLE_KEY: undefined }],
    ['нет SUPABASE_URL', { SUPABASE_URL: '' }],
    ['нет VAPID_PUBLIC_KEY', { VAPID_PUBLIC_KEY: undefined }],
    ['нет VAPID_PRIVATE_KEY', { VAPID_PRIVATE_KEY: undefined }],
    ['неверный VAPID_SUBJECT', { VAPID_SUBJECT: 'owner@example.org' }],
  ];

  it.each(cases)('%s → 500 not_configured; даже с «верным» секретом ничего не делает', async (_n, patch) => {
    const send = fakeSender();
    const h = createHandler(deps({ env: envOf(patch), send }));
    for (const token of [CRON, 'c'.repeat(31), 'anything-else', null]) {
      const r = await h(request('POST', { token, body: {} }));
      expect(r.status).toBe(500);
      expect(await json(r)).toEqual({ ok: false, error: 'not_configured' });
    }
    expect(send.calls).toEqual([]);
  });

  it('в журнале названы переменные, но не их значения', async () => {
    const h = createHandler(deps({ env: envOf({ CRON_SECRET: 'short-secret-value', VAPID_PRIVATE_KEY: 'bad-key-value' }) }));
    await h(request('POST', { token: 'short-secret-value', body: {} }));
    const text = allText();
    expect(text).toContain('CRON_SECRET');
    expect(text).toContain('VAPID_PRIVATE_KEY');
    expect(text).not.toMatch(/short-secret-value|bad-key-value/);
  });
});

describe('плановый запуск: тело и ответ', () => {
  it('тело — пусто или {}; всё остальное → 400 (в том числе action: test с секретом расписания)', async () => {
    const store = new FakeStore();
    const h = createHandler(deps({ store }));
    expect((await h(request('POST', { token: CRON, rawBody: '' }))).status).toBe(200);
    expect((await h(request('POST', { token: CRON, body: {} }))).status).toBe(200);
    for (const rawBody of ['{"action":"test"}', '{"a":1}', '[]', '"x"', '5', 'null', '{оборванный', 'x'.repeat(5000)]) {
      const r = await h(request('POST', { token: CRON, rawBody }));
      expect(r.status, rawBody.slice(0, 20)).toBe(400);
      expect(await json(r)).toEqual({ ok: false, error: 'bad_request' });
    }
  });

  it('ответ — только счётчики; ни секретов, ни адресов подписок, ни ключей', async () => {
    const store = new FakeStore();
    store.settings = [settings(USER_A)];
    store.subs.set(USER_A, [sub('s1')]);
    store.liveTxDates.set(USER_A, new Set());
    store.rules.set(USER_A, [{ id: RULE, note: 'СекретнаяЗаметка', frequency: 'monthly', intervalN: 1, startOn: '2026-01-10', endOn: null }]);
    const h = createHandler(deps({ store, now: () => NOW }));
    const r = await h(request('POST', { token: CRON, body: {} }));
    const body = await json(r);
    const text = JSON.stringify(body);
    expect(r.status).toBe(200);
    expect(body).toMatchObject({ ok: true, mode: 'cron', users: 1, inWindow: 1, sent: 1, failed: 0, revoked: 0, notified: 1, errors: 0 });
    for (const v of Object.values(body)) expect(['number', 'boolean', 'string', 'object']).toContain(typeof v);
    expect(text).not.toMatch(/fcm\.googleapis|p256dh|auth-s1|СекретнаяЗаметка|cron-secret|sb_secret|aaaaaaaa/);
    expect(allText()).not.toMatch(/fcm\.googleapis|p256dh|auth-s1|СекретнаяЗаметка|cron-secret|sb_secret/);
  });

  it('не удалось прочитать настройки → 502 db_read_failed без подробностей', async () => {
    const store = new FakeStore();
    store.failing.add('listEnabledSettings');
    const h = createHandler(deps({ store }));
    const r = await h(request('POST', { token: CRON, body: {} }));
    expect(r.status).toBe(502);
    expect(await json(r)).toEqual({ ok: false, error: 'db_read_failed' });
    expect(allText()).not.toContain(SERVICE_KEY);
  });

  it('непредвиденная ошибка → 500 internal, а не обрыв; в журнал — только имя ошибки, без текста', async () => {
    const h = createHandler(
      deps({
        now: () => {
          throw new TypeError('внутри секрет https://fcm.googleapis.com/x');
        },
      }),
    );
    const r = await h(request('POST', { token: CRON, body: {} }));
    expect(r.status).toBe(500);
    expect(await json(r)).toEqual({ ok: false, error: 'internal' });
    expect(allText()).toContain('TypeError');
    expect(allText()).not.toContain('fcm.googleapis');
  });

  it('база недоступна по сети → 502; адрес и ключ в журнал не попадают', async () => {
    const h = createHandler({ env: envOf(), now: () => NOW, fetchImpl: () => Promise.reject(new TypeError(`сеть: ${URL_BASE} ${SERVICE_KEY}`)), send: fakeSender() });
    const r = await h(request('POST', { token: CRON, body: {} }));
    expect(r.status).toBe(502);
    expect(await json(r)).toEqual({ ok: false, error: 'db_read_failed' });
    expect(allText()).not.toContain(SERVICE_KEY);
    expect(allText()).not.toContain('proj.supabase.co');
  });
});

describe('«Проверить уведомление»: токен пользователя', () => {
  const TOKEN = fakeJwt('a');
  const asUser = (id: string | null) => async (jwt: string) => (jwt === TOKEN ? id : null);

  function setup(extra: Partial<Parameters<typeof deps>[0]> = {}) {
    const store = new FakeStore();
    store.subs.set(USER_A, [sub('a-phone'), sub('a-laptop', 'web.push.apple.com')]);
    store.subs.set(USER_B, [sub('b-phone')]);
    const send = fakeSender();
    const h = createHandler(deps({ store, send, verifyJwt: asUser(USER_A), now: () => NOW, ...extra }));
    return { store, send, h };
  }
  const test = (token: string | null = TOKEN, body: unknown = { action: 'test' }) => request('POST', { token, body });

  it('шлёт пробное сообщение на ВСЕ активные подписки этого пользователя и ни на чьи другие', async () => {
    const { h, send, store } = setup();
    const r = await h(test());
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ ok: true, mode: 'test', sent: 2, failed: 0, revoked: 0 });
    expect(send.calls.map((c) => c.subId).sort()).toEqual(['a-laptop', 'a-phone']);
    expect(send.bodies()[0]).toEqual({ title: 'Finora', body: 'Проверка связи: уведомления работают.', url: '/', tag: 'finora-test' });
    expect(send.calls.every((c) => c.ttl === PUSH_TTL_SECONDS)).toBe(true);
    // журнал и настройки не трогаются: тест не требует включённых напоминаний и ничего не записывает (читаются только подписки
    // и сверка, чей это адрес)
    expect(store.calls.filter((c) => !c.startsWith('listSubscriptions') && c !== 'listLiveEndpointClaims')).toEqual([]);
    expect(store.log.size).toBe(0);
  });

  it('чужой id в теле, в адресе или в заголовках ничего не меняет: берётся только пользователь из токена', async () => {
    const { h, send } = setup();
    const req = new Request('https://proj.supabase.co/functions/v1/send-reminders?user_id=' + USER_B, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'x-user-id': USER_B, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'test', userId: USER_B, user_id: USER_B, sub: USER_B }),
    });
    const r = await h(req);
    expect(r.status).toBe(200);
    expect(send.calls.map((c) => c.subId)).not.toContain('b-phone');
    expect(send.calls).toHaveLength(2);
  });

  it('пользователь B получает только свои подписки', async () => {
    const { h, send } = setup({ verifyJwt: async () => USER_B });
    await h(test());
    expect(send.calls.map((c) => c.subId)).toEqual(['b-phone']);
  });

  it('поддельный, просроченный и чужой токен → 401, ничего не отправляется', async () => {
    const { h, send } = setup();
    for (const token of [fakeJwt('forged'), fakeJwt('expired'), 'aaa.bbb.ccc']) {
      const r = await h(test(token));
      expect(r.status).toBe(401);
      expect(await json(r)).toEqual({ ok: false, error: 'unauthorized' });
    }
    expect(send.calls).toEqual([]);
  });

  it('токен не похож на JWT → 401 без обращения к серверу авторизации', async () => {
    const verify = vi.fn(async () => USER_A);
    const { h } = setup({ verifyJwt: verify });
    for (const token of ['just-a-word', 'a.b', 'a.b.c.d', 'a b.c.d', `${'a'.repeat(5000)}.b.c`]) expect((await h(test(token))).status, token.slice(0, 20)).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it('сервер авторизации недоступен → 503, ничего не отправляется, ключи в журнал не попадают', async () => {
    const { h, send } = setup({
      verifyJwt: async () => {
        throw new Error(`обрыв ${SERVICE_KEY}`);
      },
    });
    const r = await h(test());
    expect(r.status).toBe(503);
    expect(await json(r)).toEqual({ ok: false, error: 'auth_unavailable' });
    expect(send.calls).toEqual([]);
    expect(allText()).not.toContain(SERVICE_KEY);
  });

  it('тело: только {"action":"test"}; пользователь не может запустить общий рассылочный запуск', async () => {
    const { h, send, store } = setup();
    store.settings = [settings(USER_A), settings(USER_B)];
    for (const body of [{}, { action: 'run' }, { action: 'cron' }, { action: 'TEST' }, { action: ['test'] }, [], 'test', null, { Action: 'test' }]) {
      const r = await h(test(TOKEN, body));
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await h(request('POST', { token: TOKEN, rawBody: 'не json' }))).status).toBe(400);
    expect((await h(request('POST', { token: TOKEN, rawBody: '' }))).status).toBe(400);
    expect(send.calls).toEqual([]);
    expect(store.calls).not.toContain('listEnabledSettings');
  });

  it('токен вместо секрета расписания и секрет вместо токена не взаимозаменяемы', async () => {
    const { h, send } = setup();
    expect((await h(request('POST', { token: TOKEN, body: {} }))).status).toBe(400); // пользователь + пустое тело
    expect((await h(request('POST', { token: CRON, body: { action: 'test' } }))).status).toBe(400); // расписание + test
    expect(send.calls).toEqual([]);
  });

  it('нет ни одной подписки → 200, ok и sent = 0 (приложение объяснит, что делать)', async () => {
    const { h, send } = setup({ verifyJwt: async () => USER_C });
    const r = await h(test());
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ ok: true, sent: 0, failed: 0 });
    expect(send.calls).toEqual([]);
  });

  it('все отправки не удались → ok: false; часть удалась → ok: true', async () => {
    const { h, send } = setup();
    send.outcomes.set('a-phone', { outcome: 'failed', status: 500 });
    send.outcomes.set('a-laptop', { outcome: 'failed', status: 403 });
    const bad = await json(await h(test()));
    expect(bad).toMatchObject({ ok: false, sent: 0, failed: 2, failedStatuses: { '403': 1, '500': 1 } });
    send.outcomes.set('a-laptop', { outcome: 'ok' });
    expect(await json(await h(test()))).toMatchObject({ ok: true, sent: 1, failed: 1 });
  });

  it('отправитель бросил исключение — считается сбоем; адрес подписки в журнал и ответ не попадает', async () => {
    const { h, send } = setup();
    send.outcomes.set('a-phone', 'throw');
    const r = await h(test());
    const body = await json(r);
    expect(body).toMatchObject({ sent: 1, failed: 1 });
    expect(JSON.stringify(body)).not.toContain('fcm.googleapis');
    expect(allText()).not.toContain('fcm.googleapis');
  });

  it('подписка вернула 410 или 404 → revoked_at, сбоем не считается', async () => {
    const { h, send, store } = setup();
    send.outcomes.set('a-phone', { outcome: 'dead', status: 410 });
    const r = await h(test());
    expect(await json(r)).toMatchObject({ ok: true, sent: 1, failed: 0, revoked: 1 });
    expect(store.revoked).toEqual(['a-phone']);
    // все подписки мертвы: не ошибка, но и не «отправлено»
    send.outcomes.set('a-laptop', { outcome: 'dead', status: 404 });
    store.revoked = [];
    store.subs.set(USER_A, [sub('a-phone'), sub('a-laptop')]);
    expect(await json(await h(test()))).toMatchObject({ ok: true, sent: 0, failed: 0, revoked: 2 });
  });

  it('адрес не от известного push-сервиса не получает ничего (защита от чужих адресов в таблице)', async () => {
    const { h, send, store } = setup();
    store.subs.set(USER_A, [sub('good'), sub('evil', 'evil.example'), sub('internal', '169.254.169.254')]);
    const body = await json(await h(test()));
    expect(send.calls.map((c) => c.subId)).toEqual(['good']);
    expect(body).toMatchObject({ sent: 1, skippedBadEndpoint: 2 });
  });

  it('не больше 5 проб в минуту на человека; у другого счётчик свой; через минуту снова можно', async () => {
    let now = NOW.getTime();
    const who = { current: USER_A };
    const { h } = setup({ now: () => new Date(now), verifyJwt: async () => who.current });
    for (let i = 0; i < 5; i++) expect((await h(test())).status).toBe(200);
    const sixth = await h(test());
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('retry-after')).toBe('60');
    expect(await json(sixth)).toEqual({ ok: false, error: 'rate_limited' });
    who.current = USER_B;
    expect((await h(test())).status).toBe(200);
    who.current = USER_A;
    now += 61_000;
    expect((await h(test())).status).toBe(200);
  });

  it('проба не требует включённых напоминаний (settings.enabled = false) и не читает настройки', async () => {
    const { h, store } = setup();
    store.settings = [settings(USER_A, { remindPayments: false, remindDebts: false })];
    expect((await h(test())).status).toBe(200);
    expect(store.calls).not.toContain('listEnabledSettings');
  });

  it('ошибка чтения подписок → 502 без подробностей', async () => {
    const { h, store } = setup();
    store.failing.add('listSubscriptions');
    const r = await h(test());
    expect(r.status).toBe(502);
    expect(await json(r)).toEqual({ ok: false, error: 'db_read_failed' });
  });
});
