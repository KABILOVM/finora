// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteServer, type PgliteServer } from '../../tests/sync/pglite';
import { makeJwt } from '../../tests/sync/postgrestEmulator';
import { createHandler, ownedSubscriptions, parseClaimRow, type EndpointClaim, type HandlerDeps, type PushSub } from '../../supabase/functions/send-reminders/index';
import { createPgrestEmulator, type PgrestEmulator } from './pgrestEmulator';
import { admin, logRows, rule, settings, sql, useServer, wallet } from './pgliteKit';
import { CRON, FakeStore, USER_A, USER_B, USER_C, captureConsole, deps, envOf, fakeSender, request, settings as settingsRow, sub, type FakeSender } from './testkit';

/* ---------------------------------------------------------------------------------------------
 * Один телефон — один хозяин. Схема разрешает одинаковый адрес push у двух людей (один вышел без отзыва подписки или без
 * сети, второй вошёл на том же телефоне); функция обязана слать только тому, кто подтвердил устройство позже, и не «съедать»
 * напоминание пропущенного. Три слоя: чистое правило, обработчик на хранилище в памяти, настоящая схема в PGlite.
 * НЕ живой Supabase.
 * ------------------------------------------------------------------------------------------- */

const claim = (id: string, endpoint: string, lastSeenAt: string): EndpointClaim => ({ id, endpoint, lastSeenAt });
const S = (id: string, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`): PushSub => ({ ...sub(id), endpoint });
const E1 = 'https://web.push.apple.com/shared-phone-1';

describe('ownedSubscriptions: чистое правило «хозяин адреса»', () => {
  it('у адреса нет соседей — подписка остаётся, даже если время непонятное', () => {
    expect(ownedSubscriptions([S('a', E1)], [claim('a', E1, '2026-10-01T10:00:00+00:00')]).map((s) => s.id)).toEqual(['a']);
    expect(ownedSubscriptions([S('a', E1)], [claim('a', E1, '')]).map((s) => s.id)).toEqual(['a']);
    expect(ownedSubscriptions([S('a', E1)], [claim('a', E1, 'не дата')]).map((s) => s.id)).toEqual(['a']);
  });

  it('два человека на одном адресе: остаётся тот, кто подтвердил позже; порядок строк не важен', () => {
    const older = claim('a', E1, '2026-10-01T10:00:00+00:00');
    const newer = claim('b', E1, '2026-10-09T10:00:00+00:00');
    for (const claims of [[older, newer], [newer, older]]) {
      expect(ownedSubscriptions([S('a', E1)], claims)).toEqual([]);
      expect(ownedSubscriptions([S('b', E1)], claims).map((s) => s.id)).toEqual(['b']);
    }
  });

  it('трое на одном адресе: хозяин один — самый поздний', () => {
    const claims = [claim('a', E1, '2026-10-01T10:00:00Z'), claim('b', E1, '2026-10-05T10:00:00Z'), claim('c', E1, '2026-10-03T10:00:00Z')];
    expect(ownedSubscriptions([S('a', E1), S('b', E1), S('c', E1)], claims).map((s) => s.id)).toEqual(['b']);
  });

  it('равное время — не доказано, не шлём никому', () => {
    const claims = [claim('a', E1, '2026-10-09T10:00:00+00:00'), claim('b', E1, '2026-10-09T10:00:00+00:00')];
    expect(ownedSubscriptions([S('a', E1)], claims)).toEqual([]);
    expect(ownedSubscriptions([S('b', E1)], claims)).toEqual([]);
  });

  it('время сравнивается как момент, а не как текст: Z, +00:00 и пояс +05:00', () => {
    // 15:00 в поясе +05:00 — это 10:00 UTC: ровно то же время, что у соседа
    expect(ownedSubscriptions([S('a', E1)], [claim('a', E1, '2026-10-09T15:00:00+05:00'), claim('b', E1, '2026-10-09T10:00:00Z')])).toEqual([]);
    // «позже» по тексту ('2026-10-09T12…' > '2026-10-09T11…'), но раньше по моменту (пояс +05:00)
    expect(ownedSubscriptions([S('a', E1)], [claim('a', E1, '2026-10-09T12:00:00+05:00'), claim('b', E1, '2026-10-09T11:00:00+00:00')])).toEqual([]);
    expect(ownedSubscriptions([S('b', E1)], [claim('a', E1, '2026-10-09T12:00:00+05:00'), claim('b', E1, '2026-10-09T11:00:00+00:00')]).map((s) => s.id)).toEqual(['b']);
  });

  it('непонятное время у кого-то из двоих — хозяина не доказать: адрес никому', () => {
    for (const bad of ['', 'вчера', 'NaN']) {
      expect(ownedSubscriptions([S('a', E1)], [claim('a', E1, '2026-10-09T10:00:00Z'), claim('b', E1, bad)]), `сосед ${JSON.stringify(bad)}`).toEqual([]);
      expect(ownedSubscriptions([S('a', E1)], [claim('a', E1, bad), claim('b', E1, '2026-10-01T10:00:00Z')]), `своё ${JSON.stringify(bad)}`).toEqual([]);
    }
  });

  it('своей строки нет среди действующих (отозвали между запросами) — не шлём', () => {
    expect(ownedSubscriptions([S('a', E1)], [])).toEqual([]);
    expect(ownedSubscriptions([S('a', E1)], [claim('b', E1, '2026-10-09T10:00:00Z')])).toEqual([]);
  });

  it('адреса независимы: общий проигран, свой отдельный остался; чужие адреса в списке не мешают', () => {
    const own = S('a2', 'https://fcm.googleapis.com/fcm/send/a2');
    const shared = S('a1', E1);
    const claims = [
      claim('a1', E1, '2026-10-01T10:00:00Z'),
      claim('b1', E1, '2026-10-09T10:00:00Z'),
      claim('a2', own.endpoint, '2026-10-01T10:00:00Z'),
      claim('x', 'https://fcm.googleapis.com/fcm/send/other', '2030-01-01T00:00:00Z'),
    ];
    expect(ownedSubscriptions([shared, own], claims).map((s) => s.id)).toEqual(['a2']);
  });

  it('адрес сравнивается точно: похожий адрес (приставка, регистр) — другое устройство', () => {
    const claims = [claim('a', 'https://fcm.googleapis.com/fcm/send/abc', '2026-10-01T10:00:00Z'), claim('b', 'https://fcm.googleapis.com/fcm/send/abcd', '2026-10-09T10:00:00Z'), claim('c', 'https://fcm.googleapis.com/fcm/send/ABC', '2026-10-09T10:00:00Z')];
    expect(ownedSubscriptions([S('a', 'https://fcm.googleapis.com/fcm/send/abc')], claims).map((s) => s.id)).toEqual(['a']);
  });

  it('входные списки не меняются, подписки возвращаются теми же объектами', () => {
    const mine = S('b', E1);
    const subs = [mine, S('a', E1)];
    const claims = [claim('a', E1, '2026-10-01T10:00:00Z'), claim('b', E1, '2026-10-09T10:00:00Z')];
    const snapshot = JSON.stringify({ subs, claims });
    const out = ownedSubscriptions(subs, claims);
    expect(out[0]).toBe(mine);
    expect(JSON.stringify({ subs, claims })).toBe(snapshot);
  });
});

describe('parseClaimRow: строка выборки «кто ещё на этом адресе»', () => {
  const ID = 'AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  it('обычная строка: id в нижнем регистре, адрес берётся из запроса, а не из ответа', () => {
    expect(parseClaimRow({ id: ID, last_seen_at: '2026-10-09T10:00:00+00:00', endpoint: 'https://evil.example/x' }, E1)).toEqual({ id: ID.toLowerCase(), endpoint: E1, lastSeenAt: '2026-10-09T10:00:00+00:00' });
  });
  it('нет понятного времени — строка всё равно считается (с пустым временем: она не даст отдать адрес)', () => {
    expect(parseClaimRow({ id: ID }, E1)).toMatchObject({ lastSeenAt: '' });
    expect(parseClaimRow({ id: ID, last_seen_at: 12345 }, E1)).toMatchObject({ lastSeenAt: '' });
    expect(parseClaimRow({ id: ID, last_seen_at: null }, E1)).toMatchObject({ lastSeenAt: '' });
  });
  it('не объект или нет настоящего id — пропуск', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { id: 5 }, { id: 'не-uuid' }, { id: '' }]) expect(parseClaimRow(bad, E1), JSON.stringify(bad)).toBeNull();
  });
});

describe('обработчик: общий адрес (хранилище в памяти)', () => {
  const out = captureConsole();
  const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе
  const RULE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const rule1 = { id: RULE, note: 'Кредит Ахмада', frequency: 'monthly' as const, intervalN: 1, startOn: '2026-01-10', endOn: null };
  const PHONE = 'https://web.push.apple.com/shared-phone';
  const onPhone = (id: string): PushSub => ({ ...sub(id), endpoint: PHONE });

  function setup(seen: Record<string, string>) {
    const store = new FakeStore();
    store.settings = [settingsRow(USER_A, { showDetails: true }), settingsRow(USER_B, { showDetails: true })];
    store.subs.set(USER_A, [onPhone('a-phone')]);
    store.subs.set(USER_B, [onPhone('b-phone')]);
    for (const [id, t] of Object.entries(seen)) store.lastSeen.set(id, t);
    store.rules.set(USER_A, [{ ...rule1, note: 'Кредит Ахмада' }]);
    store.rules.set(USER_B, [{ ...rule1, note: 'Аренда Беху' }]);
    const send = fakeSender();
    const h = createHandler(deps({ store, send, now: () => NOW }));
    const cron = async () => (await (await h(request('POST', { token: CRON, body: {} }))).json()) as Record<string, unknown>;
    return { store, send, h, cron };
  }

  it('кто подтвердил позже — тот и получает; у другого запись в журнал не пишется (придёт, когда он подпишет своё)', async () => {
    const { store, send, cron } = setup({ 'a-phone': '2026-10-01T10:00:00+00:00', 'b-phone': '2026-10-09T10:00:00+00:00' });
    const r = await cron();
    expect(r).toMatchObject({ users: 2, sent: 1, notified: 1, skippedSharedEndpoint: 1, skippedNoSubscriptions: 1, errors: 0 });
    expect(send.calls.map((c) => c.subId)).toEqual(['b-phone']);
    expect(send.bodies()[0]!.body).toBe('Сегодня 1 платёж (Аренда Беху).');
    expect([...store.log].filter((k) => k.startsWith(USER_A))).toEqual([]);
    expect([...store.log].filter((k) => k.startsWith(USER_B))).not.toEqual([]);
    expect(out.logs.join('\n')).toMatch(/общих адресов пропущено 1/); // в журнале функции видно, почему у человека тихо
    expect(out.text()).not.toMatch(/web\.push\.apple|shared-phone|a-phone|b-phone/);
  });

  it('вернулся прежний хозяин и подтвердил устройство снова — теперь напоминания его, а не чужие', async () => {
    const { send, store, cron } = setup({ 'a-phone': '2026-10-01T10:00:00+00:00', 'b-phone': '2026-10-09T10:00:00+00:00' });
    await cron();
    expect(send.calls.map((c) => c.subId)).toEqual(['b-phone']);
    store.lastSeen.set('a-phone', '2026-10-10T03:00:00+00:00'); // А снова вошёл на этом телефоне
    store.log.clear();
    send.calls.length = 0;
    await cron();
    expect(send.calls.map((c) => c.subId)).toEqual(['a-phone']);
    expect(send.bodies()[0]!.body).toBe('Сегодня 1 платёж (Кредит Ахмада).');
  });

  it('одинаковое время — никому; человек не теряет журнал', async () => {
    const same = '2026-10-09T10:00:00+00:00';
    const { send, store, cron } = setup({ 'a-phone': same, 'b-phone': same });
    expect(await cron()).toMatchObject({ sent: 0, skippedSharedEndpoint: 2, skippedNoSubscriptions: 2 });
    expect(send.calls).toEqual([]);
    expect(store.log.size).toBe(0);
  });

  it('отозванная подписка соседа хозяином не считается: у человека с единственной живой строкой напоминание идёт', async () => {
    const { send, store, cron } = setup({ 'a-phone': '2026-10-01T10:00:00+00:00', 'b-phone': '2026-10-09T10:00:00+00:00' });
    store.revoked.push('b-phone');
    await cron();
    expect(send.calls.map((c) => c.subId)).toEqual(['a-phone']);
  });

  it('у человека два устройства: общий адрес проигран, второе устройство получает', async () => {
    const { store, send, cron } = setup({ 'a-phone': '2026-10-01T10:00:00+00:00', 'b-phone': '2026-10-09T10:00:00+00:00' });
    store.subs.set(USER_A, [onPhone('a-phone'), sub('a-laptop', 'web.push.apple.com')]);
    expect(await cron()).toMatchObject({ skippedSharedEndpoint: 1, notified: 2 });
    expect(send.calls.map((c) => c.subId).sort()).toEqual(['a-laptop', 'b-phone']);
  });

  it('«Проверить уведомление»: пробное сообщение не уходит на устройство, которым пользуется другой; ответ — ok, sent 0', async () => {
    const { store, send } = setup({ 'a-phone': '2026-10-01T10:00:00+00:00', 'b-phone': '2026-10-09T10:00:00+00:00' });
    const h = createHandler(deps({ store, send, now: () => NOW, verifyJwt: async () => USER_A }));
    const res = await h(request('POST', { token: 'aaa.bbb.ccc', body: { action: 'test' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, mode: 'test', sent: 0, failed: 0, skippedSharedEndpoint: 1 });
    expect(send.calls).toEqual([]);
    expect(store.log.size).toBe(0);
  });

  it('адрес не от известного push-сервиса: чужих строк по нему не читаем вовсе', async () => {
    const store = new FakeStore();
    store.settings = [settingsRow(USER_A)];
    store.subs.set(USER_A, [{ ...sub('a-evil'), endpoint: 'https://evil.example/push' }]);
    store.rules.set(USER_A, [rule1]);
    const h = createHandler(deps({ store, send: fakeSender(), now: () => NOW }));
    const r = (await (await h(request('POST', { token: CRON, body: {} }))).json()) as Record<string, unknown>;
    expect(r).toMatchObject({ skippedBadEndpoint: 1, skippedNoSubscriptions: 1, skippedSharedEndpoint: 0 });
    expect(store.calls).not.toContain('listLiveEndpointClaims');
  });

  it('не удалось выяснить хозяина (ошибка базы): человек пропущен, ничего не отправлено и не записано, остальные обработаны; в журнале нет адресов', async () => {
    const { store, send, cron } = setup({ 'a-phone': '2026-10-01T10:00:00+00:00', 'b-phone': '2026-10-09T10:00:00+00:00' });
    store.subs.set(USER_C, [sub('c-own')]);
    store.settings.push(settingsRow(USER_C));
    store.rules.set(USER_C, [rule1]);
    store.failing.add('listLiveEndpointClaims');
    const r = await cron();
    expect(r).toMatchObject({ users: 3, sent: 0, errors: 3 });
    expect(send.calls).toEqual([]);
    expect(store.log.size).toBe(0);
    expect(out.text()).not.toMatch(/web\.push\.apple|fcm\.googleapis|shared-phone|a-phone|b-phone/);
    // база ожила — следующий запуск доставляет
    store.failing.clear();
    await cron();
    expect(send.calls.map((c) => c.subId).sort()).toEqual(['b-phone', 'c-own']);
  });

  it('то же для «Проверить уведомление»: ошибка базы — 502 db_read_failed, без отправки', async () => {
    const s = setup({ 'a-phone': '2026-10-01T10:00:00+00:00' });
    s.store.failing.add('listLiveEndpointClaims');
    const h = createHandler(deps({ store: s.store, send: s.send, now: () => NOW, verifyJwt: async () => USER_A }));
    const res = await h(request('POST', { token: 'aaa.bbb.ccc', body: { action: 'test' } }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'db_read_failed' });
    expect(s.send.calls).toEqual([]);
  });
});

/* ------------------------------ настоящая схема и настоящее хранилище (PGlite) ------------------------------ */

const BASE = 'http://postgrest.test';
const SB_KEY = 'sb_secret_sharedphone-key-0000000';
const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе
const SA = '11111111-1111-4111-8111-111111111111';
const SB = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const PHONE = 'https://web.push.apple.com/shared-phone-endpoint-0001';

describe('общий адрес в настоящей схеме (PostgREST-хранилище против PGlite)', () => {
  let server: PgliteServer;
  let emu: PgrestEmulator;
  let sender: FakeSender;

  const handler = (over: HandlerDeps = {}) => createHandler({ env: envOf({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SB_KEY }), now: () => NOW, fetchImpl: emu.fetch, send: sender, ...over });
  const cron = async (over: HandlerDeps = {}) => {
    const r = await handler(over)(request('POST', { token: CRON, body: {} }));
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const claimsCalls = () => emu.log.filter((c) => c.table === 'push_subscriptions' && c.method === 'GET' && /endpoint=eq\./.test(decodeURIComponent(c.query)));

  /** Что делает приложение при входе человека: сохраняет подписку этого браузера за ним (от его имени, под защитой строк). */
  async function subscribe(user: string, id: string, endpoint: string, lastSeen: string, revokedAt: string | null = null): Promise<void> {
    await sql(
      user,
      `insert into public.push_subscriptions (id, device_id, endpoint, p256dh, auth_secret, user_agent, last_seen_at, revoked_at)
       values ($1, 'dev', $2, $3, $4, '', $5, $6)
       on conflict (user_id, endpoint) do update set last_seen_at = excluded.last_seen_at, revoked_at = excluded.revoked_at`,
      [id, endpoint, `p256dh-${id}`.padEnd(30, 'x'), `auth-${id}`.padEnd(12, 'x'), lastSeen, revokedAt],
    );
  }
  async function twoPeople(details = true): Promise<void> {
    await settings(USER_A, { details });
    await settings(USER_B, { details });
    await rule(USER_A, { walletId: await wallet(USER_A), note: 'Кредит Ахмада' });
    await rule(USER_B, { walletId: await wallet(USER_B), note: 'Аренда Беху' });
  }
  const textsTo = (endpoint: string) => sender.calls.filter((c) => c.endpoint === endpoint).map((c) => (JSON.parse(c.body) as { body: string }).body);

  beforeAll(async () => {
    server = await createPgliteServer();
    useServer(server);
    for (const u of [USER_A, USER_B, USER_C]) await server.addUser(u);
  }, 60_000);
  afterAll(async () => {
    await server?.close();
  });
  const resetAll = () =>
    admin(`truncate public.push_log, public.push_subscriptions, public.reminder_settings, public.transactions, public.recurring_rules, public.debts, public.budgets, public.categories, public.wallets, public.settings cascade`);
  beforeEach(async () => {
    await resetAll();
    emu = createPgrestEmulator(server, { base: BASE, serviceKey: SB_KEY });
    sender = fakeSender();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('дубль подписки у двух людей (оба действуют): шлём только поздно подтвердившему, при любом порядке вставки строк', async () => {
    for (const order of ['a-first', 'b-first'] as const) {
      await resetAll();
      sender = fakeSender();
      await twoPeople();
      if (order === 'a-first') {
        await subscribe(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
        await subscribe(USER_B, SB, PHONE, '2026-10-09T10:00:00Z');
      } else {
        await subscribe(USER_B, SB, PHONE, '2026-10-09T10:00:00Z');
        await subscribe(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
      }
      const r = await cron();
      expect(r.body, order).toMatchObject({ sent: 1, skippedSharedEndpoint: 1, errors: 0 });
      expect(textsTo(PHONE), order).toEqual(['Сегодня 1 платёж (Аренда Беху).']);
      expect((await logRows(USER_A)).length, `${order}: журнал пропущенного пуст`).toBe(0);
      expect((await logRows(USER_B)).length, order).toBeGreaterThan(0);
    }
  });

  it('вернувшийся хозяин (подтвердил позже) получает своё, а не сосед', async () => {
    await twoPeople();
    await subscribe(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
    await subscribe(USER_B, SB, PHONE, '2026-10-09T10:00:00Z');
    await subscribe(USER_A, SA, PHONE, '2026-10-10T03:00:00Z'); // А вошёл снова и подтвердил устройство
    await cron();
    expect(textsTo(PHONE)).toEqual(['Сегодня 1 платёж (Кредит Ахмада).']);
  });

  it('запрос «кто на этом адресе» узкий: только id и время, один адрес за запрос, только действующие, лимит; ключей и user_id не читает', async () => {
    await twoPeople();
    await subscribe(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
    await subscribe(USER_B, SB, PHONE, '2026-10-09T10:00:00Z');
    await cron();
    const calls = claimsCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      const q = new URLSearchParams(c.query);
      expect(q.get('select')).toBe('id,last_seen_at');
      expect(q.get('endpoint')).toBe(`eq.${PHONE}`);
      expect(q.get('revoked_at')).toBe('is.null');
      expect(Number(q.get('limit'))).toBeGreaterThan(0);
      expect(Number(q.get('limit'))).toBeLessThanOrEqual(100);
      expect([...q.keys()].sort()).toEqual(['endpoint', 'limit', 'order', 'revoked_at', 'select']);
    }
  });

  it('отозванная строка соседа хозяином не считается (человек сам снял устройство): у оставшегося с живой строкой напоминание идёт', async () => {
    await twoPeople();
    await subscribe(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
    await subscribe(USER_B, SB, PHONE, '2026-10-09T10:00:00Z', '2026-10-09T12:00:00Z');
    await cron();
    expect(sender.calls.map((c) => c.subId)).toEqual([SA]);
  });

  it('равное время (до микросекунды) — никому, журнал пуст у обоих', async () => {
    await twoPeople();
    await subscribe(USER_A, SA, PHONE, '2026-10-09T10:00:00.123456Z');
    await subscribe(USER_B, SB, PHONE, '2026-10-09T10:00:00.123456Z');
    const r = await cron();
    expect(r.body).toMatchObject({ sent: 0, skippedSharedEndpoint: 2 });
    expect(sender.calls).toEqual([]);
    expect(await logRows()).toEqual([]);
  });

  it('похожие адреса — разные устройства (точное сравнение): ни префикс, ни регистр хозяина не меняют', async () => {
    await twoPeople();
    await subscribe(USER_A, SA, 'https://fcm.googleapis.com/fcm/send/abc', '2026-10-01T10:00:00Z');
    await subscribe(USER_B, SB, 'https://fcm.googleapis.com/fcm/send/abcd', '2026-10-09T10:00:00Z');
    await subscribe(USER_C, SC, 'https://fcm.googleapis.com/fcm/send/ABC', '2026-10-09T10:00:00Z');
    const r = await cron();
    expect(r.body).toMatchObject({ skippedSharedEndpoint: 0 });
    expect(sender.calls.map((c) => c.subId).sort()).toEqual([SA, SB]); // у C напоминаний не включено
  });

  it('адрес со знаками запятая, скобки, кавычки, & и %: ищется точно, чужой фильтр подставить нельзя', async () => {
    const weird = 'https://fcm.googleapis.com/fcm/send/a,b)(&revoked_at=is.null&limit=1%20"q\'*';
    await twoPeople();
    await subscribe(USER_A, SA, weird, '2026-10-01T10:00:00Z');
    await subscribe(USER_B, SB, weird, '2026-10-09T10:00:00Z');
    const r = await cron();
    expect(r.body).toMatchObject({ sent: 1, skippedSharedEndpoint: 1, errors: 0 });
    expect(sender.calls.map((c) => c.subId)).toEqual([SB]);
    for (const c of claimsCalls()) expect([...new URLSearchParams(c.query).keys()].sort()).toEqual(['endpoint', 'limit', 'order', 'revoked_at', 'select']);
  });

  it('база не ответила на вопрос «чей адрес»: человек пропущен до следующего часа, ничего не отправлено и не записано; потом доставляется', async () => {
    await twoPeople(false);
    await subscribe(USER_A, SA, 'https://fcm.googleapis.com/fcm/send/phone-a', '2026-10-01T10:00:00Z');
    const failing: typeof emu.fetch = async (url, init) => (decodeURIComponent(String(url)).includes('select=id,last_seen_at') ? new Response('{"code":"XX000"}', { status: 500 }) : emu.fetch(url, init));
    const r = await cron({ fetchImpl: failing });
    expect(r.body).toMatchObject({ sent: 0, errors: 1 });
    expect(sender.calls).toEqual([]);
    expect(await logRows(USER_A)).toEqual([]);
    expect((await cron()).body).toMatchObject({ sent: 1, errors: 0 });
    expect(sender.calls.map((c) => c.subId)).toEqual([SA]);
  });

  it('«Проверить уведомление» от имени вытесненного человека: на чужой экран не уходит, у вошедшего позже — уходит', async () => {
    await subscribe(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
    await subscribe(USER_B, SB, PHONE, '2026-10-09T10:00:00Z');
    const test = (user: string) => handler()(request('POST', { token: makeJwt({ sub: user, exp: Math.floor(Date.now() / 1000) + 3600 }), body: { action: 'test' } }));
    const fromA = await test(USER_A);
    expect(await fromA.json()).toMatchObject({ ok: true, sent: 0, skippedSharedEndpoint: 1 });
    expect(sender.calls).toEqual([]);
    const fromB = await test(USER_B);
    expect(await fromB.json()).toMatchObject({ ok: true, sent: 1, skippedSharedEndpoint: 0 });
    expect(sender.calls.map((c) => c.subId)).toEqual([SB]);
  });

  it('вытесненная подписка не отзывается и не меняется (хозяин может вернуться): строки в базе целы', async () => {
    await twoPeople();
    await subscribe(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
    await subscribe(USER_B, SB, PHONE, '2026-10-09T10:00:00Z');
    const before = await admin(`select * from public.push_subscriptions order by id`);
    await cron();
    expect(await admin(`select * from public.push_subscriptions order by id`)).toEqual(before);
    expect(emu.log.filter((c) => c.method !== 'GET' && c.table === 'push_subscriptions')).toEqual([]);
  });
});
