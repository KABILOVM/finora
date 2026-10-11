// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../supabase/functions/send-reminders/index';
import { CRON, FakeStore, FUNCTION_URL, USER_A, USER_B, captureConsole, deps, envOf, fakeJwt, fakeSender, forbiddenStore, request, settings, sub } from './testkit';

/* ---------------------------------------------------------------------------------------------
 * Нападение на HTTP-обработчик send-reminders: авторизация, тело, методы, зависшие зависимости.
 * ------------------------------------------------------------------------------------------- */

const out = captureConsole();
afterEach(() => vi.useRealTimers());

const call = async (h: ReturnType<typeof createHandler>, r: Request) => {
  const res = await h(r);
  return { status: res.status, text: await res.text() };
};

describe('авторизация: почти верные секреты и странные заголовки не пускают ни к базе, ни к рассылке', () => {
  const h = () => createHandler(deps());
  const near = [
    CRON.slice(0, -1),
    `${CRON}x`,
    ` ${CRON.toUpperCase()}`,
    CRON.toUpperCase(),
    CRON.replace(/-/g, '_'),
    `${CRON.slice(0, 10)}${CRON.slice(10).toUpperCase()}`,
    `Bearer ${CRON}`,
    '',
    ' ',
    'null',
    'undefined',
    '0',
    'a'.repeat(4097),
    `${CRON}${CRON}`,
  ];

  it.each(near)('токен %j → 401, база не тронута', async (token) => {
    const r = await call(h(), request('POST', { token: token === '' ? null : token, body: {}, authorization: `Bearer ${token}` }));
    expect(r.status).toBe(401);
  });

  it('другие схемы и регистры: Basic, Token, Bearer без пробела, два заголовка Authorization — 401; bearer в нижнем регистре — тот же секрет', async () => {
    const send = (authorization: string) => call(h(), request('POST', { authorization, body: {} }));
    expect((await send(`Basic ${Buffer.from(`x:${CRON}`).toString('base64')}`)).status).toBe(401);
    expect((await send(`Token ${CRON}`)).status).toBe(401);
    expect((await send(`Bearer${CRON}`)).status).toBe(401);
    expect((await send(`Bearer ${CRON}, Bearer x`)).status).toBe(401);
    expect((await send(`Bearer x, Bearer ${CRON}`)).status).toBe(401);
    // два заголовка разом: Headers склеивает их через запятую
    const headers = new Headers();
    headers.append('authorization', 'Bearer wrong');
    headers.append('authorization', `Bearer ${CRON}`);
    const two = await createHandler(deps())(new Request(FUNCTION_URL, { method: 'POST', headers, body: '{}' }));
    expect(two.status).toBe(401);
  });

  it('секрет в адресе, в теле или в чужом заголовке не заменяет Authorization', async () => {
    const hh = h();
    const url = `${FUNCTION_URL}?authorization=${CRON}&token=${CRON}`;
    const viaQuery = await hh(new Request(url, { method: 'POST', body: JSON.stringify({ token: CRON }), headers: { apikey: CRON, 'x-cron-secret': CRON, cookie: `sb=${CRON}` } }));
    expect(viaQuery.status).toBe(401);
  });

  it('токен, похожий на JWT, но подписанный чужим: сервер авторизации не знает его → 401, ничего не уходит', async () => {
    const send = fakeSender();
    const res = await call(createHandler(deps({ send, verifyJwt: async () => null })), request('POST', { token: fakeJwt('stolen'), body: { action: 'test' } }));
    expect(res.status).toBe(401);
    expect(send.calls).toEqual([]);
  });

  it('401 не различает «нет заголовка», «чужой секрет» и «чужой JWT»: одинаковый ответ (нечего подбирать)', async () => {
    const bodies = new Set<string>();
    for (const r of [request('POST', { body: {} }), request('POST', { token: 'x'.repeat(40), body: {} }), request('POST', { token: fakeJwt(), body: { action: 'test' } })]) {
      const res = await createHandler(deps())(r);
      expect(res.status).toBe(401);
      bodies.add(await res.text());
    }
    expect([...bodies]).toEqual(['{"ok":false,"error":"unauthorized"}']);
  });
});

describe('тело и методы', () => {
  const h = () => createHandler(deps());
  it('громадное тело без Content-Length (поток) с верным секретом → 400, а не падение', async () => {
    const big = new Blob(['{"a":"' + 'x'.repeat(5_000_000) + '"}']).stream();
    const r = new Request(FUNCTION_URL, { method: 'POST', headers: { authorization: `Bearer ${CRON}` }, body: big, duplex: 'half' } as RequestInit);
    const res = await h()(r);
    expect(res.status).toBe(400);
  });
  it('глубоко вложенный JSON, массив, строка, число, null и «пустые» тела', async () => {
    const deep = '['.repeat(3000) + ']'.repeat(3000);
    for (const raw of [deep, '[]', '"x"', '123', 'null', 'true', '{"a":', '\u0000', '{} {}']) {
      const res = await h()(request('POST', { token: CRON, rawBody: raw }));
      expect(res.status, raw.slice(0, 20)).toBe(400);
    }
    for (const raw of ['', '   ', '\n{}\n', '﻿{}']) {
      const res = await createHandler(deps({ store: new FakeStore() }))(request('POST', { token: CRON, rawBody: raw }));
      expect(res.status, JSON.stringify(raw)).toBe(200);
    }
  });
  it('прототипные ключи и чужие поля в тесте пользователя не включают ничего лишнего', async () => {
    const send = fakeSender();
    const store = new FakeStore();
    store.subs.set(USER_A, [sub('a1')]);
    store.subs.set(USER_B, [sub('b1')]);
    const handler = createHandler(deps({ store, send, verifyJwt: async () => USER_A }));
    const raw = '{"action":"test","__proto__":{"action":"cron"},"constructor":{"prototype":{"x":1}},"userId":"' + USER_B + '","user_id":"' + USER_B + '","all":true}';
    const res = await call(handler, request('POST', { token: fakeJwt(), rawBody: raw }));
    expect(res.status).toBe(200);
    expect(send.calls.map((c) => c.subId)).toEqual(['a1']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it('методы кроме POST и OPTIONS не доходят до секрета', async () => {
    for (const m of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const res = await createHandler(deps({ store: forbiddenStore() }))(request(m, { token: CRON }));
      expect(res.status, m).toBe(405);
    }
  });
});

describe('зависшая отправка не должна подвешивать весь запуск и «съедать» напоминания', () => {
  /** Отправитель, который никогда не отвечает (сервер push принял соединение и молчит). */
  const hang: ReturnType<typeof fakeSender> = Object.assign(
    (async () => new Promise<never>(() => undefined)) as unknown as ReturnType<typeof fakeSender>,
    { calls: [], outcomes: new Map(), bodies: () => [] },
  );

  it('контроль: тот же сценарий без зависания завершается сразу (тест не падает из-за поддельных часов)', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.settings = [settings(USER_A, { remindPayments: false, remindDebts: false, remindDaily: true })];
    store.subs.set(USER_A, [sub('a1')]);
    const good = fakeSender();
    const handler = createHandler({ env: envOf(), now: () => new Date('2026-10-10T04:10:00Z'), store, send: good, verifyJwt: async () => null });
    let settled = false;
    const run = handler(request('POST', { token: CRON, body: {} })).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
    await run;
    expect(good.calls.map((c) => c.subId)).toEqual(['a1']);
  });

  it('у первого человека отправка зависла: запуск завершается за разумный срок, второй человек получает своё, запись первого не съедена', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.settings = [settings(USER_A, { remindPayments: false, remindDebts: false, remindDaily: true }), settings(USER_B, { remindPayments: false, remindDebts: false, remindDaily: true })];
    store.subs.set(USER_A, [sub('a1')]);
    store.subs.set(USER_B, [sub('b1')]);
    const good = fakeSender();
    const send = (async (s, body, opts) => (s.id === 'a1' ? hang(s, body, opts) : good(s, body, opts))) as typeof good;
    const handler = createHandler({ env: envOf(), now: () => new Date('2026-10-10T04:10:00Z'), store, send, verifyJwt: async () => null });

    let settled = false;
    const run = handler(request('POST', { token: CRON, body: {} })).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(45_000); // меньше бюджета запуска (90 с), больше срока ответа любого push-сервиса (10 с)
    expect(settled, 'запуск не завершился за 45 с: одна зависшая отправка держит всех').toBe(true);
    await run;
    expect(good.calls.map((c) => c.subId)).toEqual(['b1']);
    // у A никто не принял: запись о «отправлено» убрана, следующий час повторит
    expect([...store.log].filter((k) => k.startsWith(USER_A))).toEqual([]);
    expect(out.text()).not.toMatch(/fcm\.googleapis|a1/);
  });
});
