// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PUSH_PAYLOAD_MAX_BYTES, PUSH_TTL_SECONDS, classifyPushError, createHandler, createWebPushSender, uuidV5, type DebtLite, type PushSub, type WebPushLike } from '../../supabase/functions/send-reminders/index';
import { CRON, FakeStore, USER_A, USER_B, USER_C, captureConsole, deps, fakeSender, request, settings, sub } from './testkit';

const RULE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе

const log = captureConsole();
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const allText = () => log.text();

describe('плановый запуск: окно, дубли, сбои', () => {
  const rule = { id: RULE, note: 'Аренда', frequency: 'monthly' as const, intervalN: 1, startOn: '2026-01-10', endOn: null };

  function setup(opts: { now?: Date } = {}) {
    const store = new FakeStore();
    store.settings = [settings(USER_A)];
    store.subs.set(USER_A, [sub('a-phone')]);
    store.rules.set(USER_A, [rule]); // 10 октября — платёж сегодня
    const send = fakeSender();
    const clock = { now: opts.now ?? NOW };
    const h = createHandler(deps({ store, send, now: () => clock.now }));
    const run = async () => json(await h(request('POST', { token: CRON, body: {} })));
    return { store, send, clock, run };
  }

  it('в окне: одно сообщение со ссылкой на платежи; суммы и названия не пишутся (show_details = false)', async () => {
    const { send, run } = setup();
    const r = await run();
    expect(r).toMatchObject({ users: 1, inWindow: 1, sent: 1, notified: 1 });
    expect(send.bodies()).toEqual([{ title: 'Finora', body: 'Сегодня 1 платёж.', url: '/recurring', tag: 'finora-payments' }]);
    expect(send.calls[0]!.ttl).toBe(12 * 60 * 60);
    expect(send.calls[0]!.body.length).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
  });

  it('show_details = true добавляет название', async () => {
    const { send, store, run } = setup();
    store.settings = [settings(USER_A, { showDetails: true })];
    await run();
    expect(send.bodies()[0]!.body).toBe('Сегодня 1 платёж (Аренда).');
  });

  it('вне окна ничего не уходит и журнал не пишется: раньше часа и через 6 часов', async () => {
    for (const iso of ['2026-10-10T03:59:00Z', '2026-10-10T10:00:00Z']) {
      const { send, store, run } = setup({ now: new Date(iso) });
      const r = await run();
      expect(r, iso).toMatchObject({ users: 1, inWindow: 0, skippedOutsideWindow: 1, sent: 0 });
      expect(send.calls).toEqual([]);
      expect(store.log.size).toBe(0);
    }
  });

  it('окно по часовому поясу человека: тот же момент у одного в окне, у другого нет; неверная зона пропускает только себя', async () => {
    const { store, send, run } = setup();
    store.settings = [settings(USER_A), settings(USER_B, { timezone: 'America/New_York' }), settings(USER_C, { timezone: 'Mars/Phobos' })];
    store.subs.set(USER_B, [sub('b-phone')]);
    store.subs.set(USER_C, [sub('c-phone')]);
    store.rules.set(USER_B, [rule]);
    store.rules.set(USER_C, [rule]);
    const r = await run();
    expect(r).toMatchObject({ users: 3, inWindow: 1, skippedOutsideWindow: 1, skippedBadTimezone: 1, sent: 1, errors: 0 });
    expect(send.calls.map((c) => c.subId)).toEqual(['a-phone']);
  });

  it('повтор в тот же день не шлёт то же второй раз (журнал), на следующий день — снова', async () => {
    const { send, clock, run } = setup();
    await run();
    expect(send.calls).toHaveLength(1);
    clock.now = new Date('2026-10-10T05:10:00Z'); // 10:10 — тоже в окне
    expect(await run()).toMatchObject({ inWindow: 1, sent: 0, skippedAlreadySent: 1 });
    expect(send.calls).toHaveLength(1);
    clock.now = new Date('2026-10-11T04:10:00Z');
    expect(await run()).toMatchObject({ sent: 1 }); // вчерашний платёж просрочен и всё ещё не проведён
    expect(send.bodies()[1]!.body).toBe('Просрочено: 1 платёж.');
  });

  it('поздний пункт в тот же день: уходит только новое', async () => {
    const { send, clock, store, run } = setup();
    await run();
    const second = { ...rule, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', note: 'Интернет' };
    store.rules.set(USER_A, [rule, second]);
    clock.now = new Date('2026-10-10T06:10:00Z');
    await run();
    expect(send.bodies().map((b) => b.body)).toEqual(['Сегодня 1 платёж.', 'Сегодня 1 платёж.']);
    expect(send.calls).toHaveLength(2);
  });

  it('обработанные платежи не напоминаются: проведён, пропущен (удалён) — операция с id v5(правило, дата) есть', async () => {
    const { send, store, run } = setup();
    store.transactionIds.add(await uuidV5(RULE, '2026-10-10'));
    expect(await run()).toMatchObject({ sent: 0, skippedNothingToSend: 1 });
    expect(send.calls).toEqual([]);
    expect(store.log.size).toBe(0);
  });

  it('нет подписок → ничего не пишется в журнал (иначе напоминание пропало бы навсегда)', async () => {
    const { send, store, run } = setup();
    store.subs.set(USER_A, []);
    expect(await run()).toMatchObject({ skippedNoSubscriptions: 1, sent: 0 });
    expect(store.log.size).toBe(0);
    expect(store.calls).not.toContain(`insertLog:${USER_A}`);
    expect(send.calls).toEqual([]);
  });

  it('все выключено у человека (три галочки сняты) — пропуск', async () => {
    const { send, store, run } = setup();
    store.settings = [settings(USER_A, { remindPayments: false, remindDebts: false, remindDaily: false })];
    expect(await run()).toMatchObject({ inWindow: 1, skippedNothingToSend: 1 });
    expect(send.calls).toEqual([]);
  });

  it('никто не принял (сбой сервиса) → записи запуска убираются, следующий час пробует снова и доставляет', async () => {
    const { send, store, clock, run } = setup();
    send.outcomes.set('a-phone', { outcome: 'failed', status: 503 });
    expect(await run()).toMatchObject({ sent: 0, failed: 1, failedStatuses: { '503': 1 }, notified: 0 });
    expect(store.log.size).toBe(0);
    send.outcomes.delete('a-phone');
    clock.now = new Date('2026-10-10T05:10:00Z');
    expect(await run()).toMatchObject({ sent: 1, notified: 1 });
    expect(send.calls).toHaveLength(2);
    expect(store.log.size).toBe(1);
  });

  it('отправитель бросил исключение — то же самое, что сбой', async () => {
    const { send, store, run } = setup();
    send.outcomes.set('a-phone', 'throw');
    expect(await run()).toMatchObject({ failed: 1, sent: 0 });
    expect(store.log.size).toBe(0);
  });

  it('подписка мертва (410): отзывается, не считается сбоем, записи остаются (повторять некуда)', async () => {
    const { send, store, run } = setup();
    send.outcomes.set('a-phone', { outcome: 'dead', status: 410 });
    expect(await run()).toMatchObject({ sent: 0, failed: 0, revoked: 1, notified: 0 });
    expect(store.revoked).toEqual(['a-phone']);
    expect(store.log.size).toBe(1);
  });

  it('мертва одна, другая дала сбой → записи убираются; одна принята, другая сбой → остаются', async () => {
    const { send, store, run } = setup();
    store.subs.set(USER_A, [sub('a1'), sub('a2')]);
    send.outcomes.set('a1', { outcome: 'dead', status: 404 });
    send.outcomes.set('a2', { outcome: 'failed', status: 500 });
    expect(await run()).toMatchObject({ sent: 0, failed: 1, revoked: 1 });
    expect(store.log.size).toBe(0);
    store.revoked = [];
    send.outcomes.clear();
    send.outcomes.set('a2', { outcome: 'failed', status: 500 });
    expect(await run()).toMatchObject({ sent: 1, failed: 1, notified: 1 });
    expect(store.log.size).toBe(1);
  });

  it('сбой отзыва подписки или удаления журнала считается ошибкой, но остальные пользователи обрабатываются', async () => {
    const { send, store, run } = setup();
    store.settings = [settings(USER_A), settings(USER_B)];
    store.subs.set(USER_B, [sub('b-phone')]);
    store.rules.set(USER_B, [rule]);
    send.outcomes.set('a-phone', { outcome: 'dead', status: 410 });
    store.failing.add('revokeSubscription');
    const r = await run();
    expect(r).toMatchObject({ users: 2, sent: 1, notified: 1, errors: 1 });
  });

  it('ошибка базы у одного пользователя не мешает остальным; в журнале нет его данных', async () => {
    const { send, store, run } = setup();
    store.settings = [settings(USER_A), settings(USER_B)];
    store.subs.set(USER_B, [sub('b-phone')]);
    store.rules.set(USER_B, [rule]);
    store.failing.add(`listRules:${USER_A}`);
    const r = await run();
    expect(r).toMatchObject({ users: 2, errors: 1, sent: 1 });
    expect(send.calls.map((c) => c.subId)).toEqual(['b-phone']);
    expect(allText()).not.toContain(USER_A);
  });

  it('постраничное чтение настроек: все пользователи обработаны, повторов нет', async () => {
    const { send, store, run } = setup();
    store.pageSize = 2;
    const ids = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    store.settings = ids.map((id) => settings(id));
    for (const id of ids) {
      store.subs.set(id, [sub(`s-${id.slice(-1)}`)]);
      store.rules.set(id, [rule]);
    }
    const r = await run();
    expect(r).toMatchObject({ users: 7, sent: 7 });
    expect(send.calls.map((c) => c.subId).sort()).toEqual(ids.map((id) => `s-${id.slice(-1)}`));
  });

  it('сервер игнорирует курсор страницы — люди не идут по кругу (каждый обработан один раз)', async () => {
    const { send, store, run } = setup();
    store.settings = [settings(USER_A), settings(USER_B)];
    store.subs.set(USER_B, [sub('b-phone')]);
    store.rules.set(USER_B, [rule]);
    const page = await store.listEnabledSettings(null);
    store.listEnabledSettings = async () => page; // всегда одна и та же страница
    const r = await run();
    expect(r).toMatchObject({ users: 2, sent: 2 });
    expect(send.calls).toHaveLength(2);
  });

  it('срок выполнения: после 90 секунд новые люди не начинаются (их догонит следующий час), уже начатые завершены', async () => {
    const store = new FakeStore();
    store.settings = [settings(USER_A), settings(USER_B), settings(USER_C)];
    for (const u of [USER_A, USER_B, USER_C]) {
      store.subs.set(u, [sub(`s-${u.slice(0, 2)}`)]);
      store.rules.set(u, [rule]);
    }
    const send = fakeSender();
    let t = 0;
    const clock = { ms: () => (t += 50_000) };
    const h = createHandler(deps({ store, send, now: () => NOW, clockMs: () => clock.ms() }));
    const r = await json(await h(request('POST', { token: CRON, body: {} })));
    expect(r).toMatchObject({ users: 3, sent: 1, skippedTimeBudget: 2, errors: 0 });
    // следующий час (часы пошли заново): пропущенные получают своё напоминание, первый — уже нет
    clock.ms = () => 0;
    const again = await json(await h(request('POST', { token: CRON, body: {} })));
    expect(again).toMatchObject({ users: 3, sent: 2, skippedAlreadySent: 1, skippedTimeBudget: 0 });
    expect(send.calls).toHaveLength(3);
  });

  it('сообщение каждому уходит только на его подписки', async () => {
    const { send, store, run } = setup();
    store.settings = [settings(USER_A), settings(USER_B, { remindPayments: false, remindDaily: true })];
    store.subs.set(USER_B, [sub('b-phone'), sub('b-tab')]);
    await run();
    const byUser = send.calls.map((c) => `${c.subId}:${JSON.parse(c.body).tag}`).sort();
    expect(byUser).toEqual(['a-phone:finora-payments', 'b-phone:finora-daily', 'b-tab:finora-daily']);
  });

  it('напоминание «внесите траты»: есть операция за сегодня — молчит, нет — одно сообщение', async () => {
    const { send, store, clock, run } = setup();
    store.settings = [settings(USER_A, { remindPayments: false, remindDebts: false, remindDaily: true })];
    store.liveTxDates.set(USER_A, new Set(['2026-10-10']));
    expect(await run()).toMatchObject({ sent: 0, skippedNothingToSend: 1 });
    store.liveTxDates.set(USER_A, new Set(['2026-10-09']));
    await run();
    expect(send.bodies()).toEqual([{ title: 'Finora', body: 'Сегодня ещё нет записей. Внесите траты и доходы.', url: '/', tag: 'finora-daily' }]);
    clock.now = new Date('2026-10-10T06:00:00Z');
    expect(await run()).toMatchObject({ sent: 0, skippedAlreadySent: 1 });
  });

  it('долги: срок сегодня, завтра и просрочен; остаток 0 или другая сторона — молчит', async () => {
    const { send, store, run } = setup();
    store.rules.set(USER_A, []);
    const debt = (id: string, dueOn: string, o: Partial<DebtLite> = {}): DebtLite => ({ id, direction: 'lent', counterparty: 'Рустам', principalMinor: 1000, currency: 'TJS', dueOn, ...o });
    store.debts.set(USER_A, [debt('d1', '2026-10-10'), debt('d2', '2026-10-11'), debt('d3', '2026-10-01'), debt('d4', '2026-10-12'), debt('d5', '2026-08-01'), debt('d6', '2026-10-10')]);
    store.wallets.set('w1', 'TJS');
    store.debtTxs = [{ debtId: 'd6', kind: 'income', walletId: 'w1', amountMinor: 1000 }]; // d6 погашен
    await run();
    expect(send.bodies()).toEqual([{ title: 'Finora', body: 'Долги: срок подошёл у 3.', url: '/debts', tag: 'finora-debts' }]);
  });
});

describe('отправка через web-push (подменённый пакет)', () => {
  const VAPID = { subject: 'mailto:owner@example.org', publicKey: 'B'.repeat(87), privateKey: 'p'.repeat(43) };
  const SUB: PushSub = { id: 's1', endpoint: 'https://fcm.googleapis.com/fcm/send/секрет-адрес', p256dh: 'ключ-клиента', authSecret: 'секрет-авторизации' };

  function lib(fail?: (n: number) => unknown) {
    const calls: Array<{ subscription: unknown; payload: string; options: unknown }> = [];
    const wp: WebPushLike & { vapid: unknown[][] } = {
      vapid: [],
      setVapidDetails(...a) {
        this.vapid.push(a);
      },
      async sendNotification(subscription, payload, options) {
        calls.push({ subscription, payload, options });
        const e = fail?.(calls.length);
        if (e !== undefined) throw e;
        return { statusCode: 201 };
      },
    };
    return { wp, calls };
  }

  it('передаёт адрес, ключи, текст и срок хранения; VAPID задаётся один раз на все отправки', async () => {
    const { wp, calls } = lib();
    const load = vi.fn(async () => wp);
    const send = createWebPushSender(VAPID, load);
    expect(await send(SUB, '{"title":"Finora"}', { ttl: PUSH_TTL_SECONDS })).toEqual({ outcome: 'ok' });
    await send({ ...SUB, id: 's2' }, '{"x":1}', { ttl: 60 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(wp.vapid).toEqual([[VAPID.subject, VAPID.publicKey, VAPID.privateKey]]);
    expect(calls[0]).toEqual({
      subscription: { endpoint: SUB.endpoint, keys: { p256dh: SUB.p256dh, auth: SUB.authSecret } },
      payload: '{"title":"Finora"}',
      options: { TTL: 43_200, urgency: 'normal', timeout: 10_000 },
    });
    expect((calls[1]!.options as { TTL: number }).TTL).toBe(60);
  });

  it('ответ 404 и 410 — подписка мертва; прочие — сбой с кодом; в результате нет ни адреса, ни ключей, и ничего не печатается', async () => {
    for (const [code, outcome] of [[404, 'dead'], [410, 'dead'], [400, 'failed'], [401, 'failed'], [403, 'failed'], [413, 'failed'], [429, 'failed'], [500, 'failed'], [503, 'failed']] as const) {
      const { wp } = lib(() => Object.assign(new Error(`Received unexpected response code ${code} для ${SUB.endpoint}`), { statusCode: code, endpoint: SUB.endpoint, body: SUB.authSecret }));
      const r = await createWebPushSender(VAPID, async () => wp)(SUB, '{}', { ttl: 1 });
      expect(r, String(code)).toEqual({ outcome, status: code });
      expect(JSON.stringify(r)).not.toMatch(/fcm|секрет|ключ/);
    }
    expect(log.errors.join('\n')).not.toMatch(/fcm|секрет|ключ/);
  });

  it('ошибка без кода (сеть, таймаут) — сбой без кода; бросили не Error — тоже', async () => {
    for (const e of [new Error('ECONNRESET ' + SUB.endpoint), 'строка', null, 42, { statusCode: '410' }, { statusCode: 410.5 }]) {
      const { wp } = lib(() => e);
      expect(await createWebPushSender(VAPID, async () => wp)(SUB, '{}', { ttl: 1 })).toEqual({ outcome: 'failed', status: undefined });
    }
    expect(classifyPushError({ statusCode: 410 })).toEqual({ outcome: 'dead', status: 410 });
    expect(classifyPushError(undefined)).toEqual({ outcome: 'failed', status: undefined });
  });

  it('пакет не загрузился или ключи не приняты — сбой (не «мертва»), в следующий раз новая попытка, ключи в журнал не попадают', async () => {
    let attempt = 0;
    const { wp } = lib();
    const load = vi.fn(async () => {
      if (++attempt === 1) throw new Error('Module not found npm:web-push');
      return wp;
    });
    const send = createWebPushSender(VAPID, load);
    expect(await send(SUB, '{}', { ttl: 1 })).toEqual({ outcome: 'failed' });
    expect(await send(SUB, '{}', { ttl: 1 })).toEqual({ outcome: 'ok' });
    expect(load).toHaveBeenCalledTimes(2);

    const badKeys: WebPushLike = {
      setVapidDetails() {
        throw new Error(`Vapid public key is invalid: ${VAPID.publicKey} / ${VAPID.privateKey}`);
      },
      sendNotification: async () => ({}),
    };
    expect(await createWebPushSender(VAPID, async () => badKeys)(SUB, '{}', { ttl: 1 })).toEqual({ outcome: 'failed' });
    expect(log.errors.join('\n')).not.toMatch(new RegExp(`${VAPID.publicKey}|${VAPID.privateKey}`));
  });

  it('вместе с обработчиком: мёртвая подписка отзывается, живая получает; сообщение целиком в пределах размера', async () => {
    const store = new FakeStore();
    store.settings = [settings(USER_A)];
    store.subs.set(USER_A, [sub('alive'), sub('gone')]);
    store.rules.set(USER_A, [{ id: RULE, note: 'Аренда', frequency: 'monthly', intervalN: 1, startOn: '2026-01-10', endOn: null }]);
    const sent: string[] = [];
    const { wp } = lib();
    wp.sendNotification = async (subscription, payload) => {
      sent.push(payload);
      if (subscription.endpoint.endsWith('/gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return {};
    };
    const send = createWebPushSender(VAPID, async () => wp);
    const h = createHandler(deps({ store, send, now: () => NOW }));
    const r = await json(await h(request('POST', { token: CRON, body: {} })));
    expect(r).toMatchObject({ sent: 1, failed: 0, revoked: 1, notified: 1 });
    expect(store.revoked).toEqual(['gone']);
    expect(sent).toHaveLength(2);
    expect(new TextEncoder().encode(sent[0]).length).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
  });
});
