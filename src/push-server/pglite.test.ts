// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteServer, type PgliteServer } from '../../tests/sync/pglite';
import { makeJwt } from '../../tests/sync/postgrestEmulator';
import { createHandler, uuidV5, type HandlerDeps } from '../../supabase/functions/send-reminders/index';
import { createPgrestEmulator, type PgrestEmulator } from './pgrestEmulator';
import { admin, debt, logRows, revokedIds, rule, settings, sql, subscription, tx, useServer, wallet } from './pgliteKit';
import { CRON, USER_A, USER_B, USER_C, envOf, fakeSender, request, type FakeSender } from './testkit';

/* ---------------------------------------------------------------------------------------------
 * Функция send-reminders НАСТОЯЩИМ кодом (createPostgrestStore + createJwtVerifier) против НАСТОЯЩЕЙ supabase/schema.sql в PGlite:
 * неверное имя колонки, фильтр или таблицы ломает запрос здесь так же, как сломал бы на живом Supabase. Данные пользователей
 * кладутся от их имени (триггеры и RLS работают); функция ходит как service_role. НЕ живой Supabase: PostgREST и Auth — подмена.
 * ------------------------------------------------------------------------------------------- */

const BASE = 'http://postgrest.test';
const JWT_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl'; // выглядит как JWT; подпись не проверяется
const SB_KEY = 'sb_secret_test-key-000000000000';
const TS = '2026-10-01T10:00:00Z';
const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе, 10 октября

let server: PgliteServer;
let emu: PgrestEmulator;
let serviceKey = SB_KEY;

const state: { send: FakeSender; now: Date } = { send: fakeSender(), now: NOW };

function handler(over: HandlerDeps = {}) {
  return createHandler({ env: envOf({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: serviceKey }), now: () => state.now, fetchImpl: emu.fetch, send: state.send, ...over });
}
const cron = async (over: HandlerDeps = {}) => {
  const r = await handler(over)(request('POST', { token: CRON, body: {} }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const bodies = () => state.send.bodies();

beforeAll(async () => {
  server = await createPgliteServer();
  useServer(server);
  for (const u of [USER_A, USER_B, USER_C]) await server.addUser(u);
}, 60_000);
afterAll(async () => {
  await server?.close();
});
beforeEach(async () => {
  await admin(`truncate public.push_log, public.push_subscriptions, public.reminder_settings, public.transactions, public.recurring_rules, public.debts, public.budgets, public.categories, public.wallets, public.settings cascade`);
  serviceKey = SB_KEY;
  emu = createPgrestEmulator(server, { base: BASE, serviceKey });
  state.send = fakeSender();
  state.now = NOW;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('настоящая схема: что напоминается, а что нет', () => {
  async function fullDay(user: string) {
    const w = await wallet(user);
    const wUsd = await wallet(user, 'USD');
    const wDead = await wallet(user, 'TJS', true);
    const rules = {
      today: await rule(user, { walletId: w, note: 'Аренда', startOn: '2026-01-10' }),
      late: await rule(user, { walletId: w, note: 'Интернет', startOn: '2026-01-07' }), // 7 октября: просрочен на 3 дня
      income: await rule(user, { walletId: w, note: 'Зарплата', kind: 'income', startOn: '2026-01-10' }),
      auto: await rule(user, { walletId: w, note: 'Авто', startOn: '2026-01-10', autoPost: 1 }),
      archived: await rule(user, { walletId: w, note: 'Архив', startOn: '2026-01-10', archived: true }),
      deleted: await rule(user, { walletId: w, note: 'Удалён', startOn: '2026-01-10', deleted: true }),
      done: await rule(user, { walletId: w, note: 'Проведён', startOn: '2026-01-10' }),
      skipped: await rule(user, { walletId: w, note: 'Пропущен', startOn: '2026-01-10' }),
      tooOld: await rule(user, { walletId: w, note: 'Давно', startOn: '2026-01-02' }), // 2 октября: 8 суток назад
      future: await rule(user, { walletId: w, note: 'Будущий', startOn: '2026-11-01' }),
      ended: await rule(user, { walletId: w, note: 'Закончен', startOn: '2026-01-10', endOn: '2026-09-30' }),
    };
    await tx(user, { walletId: w, occurredOn: '2026-10-10', id: await uuidV5(rules.done, '2026-10-10') }); // проведён
    await tx(user, { walletId: w, occurredOn: '2026-10-10', id: await uuidV5(rules.skipped, '2026-10-10'), deleted: true }); // пропущен (удалённая операция)
    const debts = {
      today: await debt(user, { dueOn: '2026-10-10', counterparty: 'Рустам' }),
      tomorrow: await debt(user, { dueOn: '2026-10-11', counterparty: 'Саид', principal: 1000 }),
      overdue30: await debt(user, { dueOn: '2026-09-10', counterparty: 'Нодир' }), // ровно 30 суток
      overdue31: await debt(user, { dueOn: '2026-09-09', counterparty: 'Давно' }),
      dayAfter: await debt(user, { dueOn: '2026-10-12', counterparty: 'Позже' }),
      noDue: await debt(user, { dueOn: null, counterparty: 'Без срока' }),
      closed: await debt(user, { dueOn: '2026-10-10', counterparty: 'Закрыт', closed: true }),
      archived: await debt(user, { dueOn: '2026-10-10', counterparty: 'Архив', archived: true }),
      deleted: await debt(user, { dueOn: '2026-10-10', counterparty: 'Удалён', deleted: true }),
      paid: await debt(user, { dueOn: '2026-10-10', counterparty: 'Погашен' }),
      overpaid: await debt(user, { dueOn: '2026-10-10', counterparty: 'Переплата' }),
      usdPay: await debt(user, { dueOn: '2026-10-10', counterparty: 'Валюта' }),
      issueOnly: await debt(user, { dueOn: '2026-10-10', counterparty: 'Выдача', direction: 'borrowed' }),
      partial: await debt(user, { dueOn: '2026-10-10', counterparty: 'Частично' }),
      deadWallet: await debt(user, { dueOn: '2026-10-10', counterparty: 'Закрыт кошельком', principal: 500 }),
      deletedPay: await debt(user, { dueOn: '2026-10-10', counterparty: 'Платёж удалён', principal: 1000 }),
    };
    await tx(user, { walletId: w, occurredOn: '2026-10-01', kind: 'income', debtId: debts.paid, amount: 1000 });
    await tx(user, { walletId: w, occurredOn: '2026-10-01', kind: 'income', debtId: debts.overpaid, amount: 1500 });
    await tx(user, { walletId: wUsd, occurredOn: '2026-10-01', kind: 'income', debtId: debts.usdPay, amount: 1000 }); // другая валюта: не считается
    await tx(user, { walletId: w, occurredOn: '2026-10-01', kind: 'income', debtId: debts.issueOnly, amount: 1000 }); // получение долга, а не платёж
    await tx(user, { walletId: w, occurredOn: '2026-10-01', kind: 'income', debtId: debts.partial, amount: 400 });
    await tx(user, { walletId: w, occurredOn: '2026-10-02', kind: 'income', debtId: debts.partial, amount: 100, deleted: true }); // удалённая не считается
    await tx(user, { walletId: wDead, occurredOn: '2026-10-01', kind: 'income', debtId: debts.deadWallet, amount: 500 }); // кошелёк удалён, платёж остаётся платежом
    await tx(user, { walletId: w, occurredOn: '2026-10-01', kind: 'income', debtId: debts.deletedPay, amount: 1000, deleted: true }); // удалённый платёж долг не гасит
    return { w, rules, debts };
  }

  it('полный день: платежи (сегодня и просроченные), долги (срок, остаток, валюта), дубликатов нет; суммы и названия не пишутся', async () => {
    await settings(USER_A);
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const d = await fullDay(USER_A);
    const r = await cron();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, users: 1, inWindow: 1, sent: 1, notified: 1, errors: 0 });
    // платежи: Аренда, Зарплата (сегодня) и Интернет (просрочен). Долги: сегодня, завтра, 30 суток, валюта, выдача, частично, удалённый платёж = 7
    expect(bodies()).toEqual([{ title: 'Sumoima', body: 'Сегодня 2 платежа, просрочено 1. Долги: срок подошёл у 7.', url: '/', tag: 'finora-reminder' }]);
    expect(state.send.calls[0]!.body).not.toMatch(/777777|Аренда|Рустам/);
    const log = await logRows(USER_A);
    expect(log.map((l) => `${l.kind}:${l.ref}`).sort()).toEqual(
      [
        `payment:${d.rules.today}:2026-10-10`,
        `payment:${d.rules.income}:2026-10-10`,
        `payment:${d.rules.late}:2026-10-07`,
        `debt:${d.debts.today}`,
        `debt:${d.debts.tomorrow}`,
        `debt:${d.debts.overdue30}`,
        `debt:${d.debts.usdPay}`,
        `debt:${d.debts.issueOnly}`,
        `debt:${d.debts.partial}`,
        `debt:${d.debts.deletedPay}`,
      ].sort(),
    );
    expect(log.every((l) => l.sent_on === '2026-10-10' && l.user_id === USER_A)).toBe(true);
    // тот же час ещё раз: журнал не даёт отправить дубль
    const again = await cron();
    expect(again.body).toMatchObject({ sent: 0, skippedAlreadySent: 1 });
    expect(bodies()).toHaveLength(1);
    expect(await logRows(USER_A)).toHaveLength(10);
  });

  it('show_details = true: названия платежей и имена должников, суммы — никогда', async () => {
    await settings(USER_A, { details: true });
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const w = await wallet(USER_A);
    await rule(USER_A, { walletId: w, note: 'Аренда 🏠' });
    await debt(USER_A, { dueOn: '2026-10-11', counterparty: 'Рустам Каримов', principal: 987654 });
    await cron();
    expect(bodies()[0]!.body).toBe('Сегодня 1 платёж (Аренда 🏠). Долги: срок подошёл у 1 (Рустам Каримов).');
    expect(state.send.calls[0]!.body).not.toMatch(/987654|777777/);
  });

  it('чужие данные не влияют: платежи, долги и операции B не попадают в напоминание A и наоборот', async () => {
    const SA = '11111111-1111-4111-8111-111111111111';
    const SB = '22222222-2222-4222-8222-222222222222';
    await settings(USER_A, { debts: false });
    await settings(USER_B, { payments: false });
    await subscription(USER_A, SA);
    await subscription(USER_B, SB);
    const wa = await wallet(USER_A);
    const wb = await wallet(USER_B);
    await rule(USER_B, { walletId: wb, note: 'Только у B' });
    await debt(USER_B, { dueOn: '2026-10-10', counterparty: 'Только у B' });
    await debt(USER_A, { dueOn: '2026-10-10', counterparty: 'Только у A' }); // у A долги выключены
    const ra = await rule(USER_A, { walletId: wa, note: 'Только у A' });
    // B занимает у себя операцию с id, который «закрыл бы» платёж A, если бы проверка не была привязана к пользователю
    await tx(USER_B, { walletId: wb, occurredOn: '2026-10-10', id: await uuidV5(ra, '2026-10-10') });
    await cron();
    const byUser = Object.fromEntries(state.send.calls.map((c) => [c.subId, (JSON.parse(c.body) as { body: string }).body]));
    expect(byUser).toEqual({ [SA]: 'Сегодня 1 платёж.', [SB]: 'Долги: срок подошёл у 1.' });
    expect((await logRows(USER_A)).map((l) => l.ref)).toEqual([`${ra}:2026-10-10`]);
    expect((await logRows(USER_B)).map((l) => l.kind)).toEqual(['debt']);
  });

  it('локальная дата, а не UTC: Токио, час 0, платёж «завтра по UTC» уже сегодня', async () => {
    await settings(USER_A, { tz: 'Asia/Tokyo', hour: 0 });
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const w = await wallet(USER_A);
    const r = await rule(USER_A, { walletId: w, startOn: '2026-01-11' });
    state.now = new Date('2026-10-10T16:30:00Z'); // 11 октября 01:30 в Токио
    await cron();
    expect(bodies()).toHaveLength(1);
    expect(await logRows(USER_A)).toEqual([{ user_id: USER_A, kind: 'payment', ref: `${r}:2026-10-11`, sent_on: '2026-10-11' }]);
  });

  it('Нью-Йорк в день перехода на летнее время: час 2 пропал, окно 2…7 ловит 03:05', async () => {
    await settings(USER_A, { tz: 'America/New_York', hour: 2 });
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const w = await wallet(USER_A);
    const r = await rule(USER_A, { walletId: w, startOn: '2026-01-08' });
    state.now = new Date('2026-03-08T07:05:00Z'); // 03:05 EDT
    await cron();
    expect(await logRows(USER_A)).toEqual([{ user_id: USER_A, kind: 'payment', ref: `${r}:2026-03-08`, sent_on: '2026-03-08' }]);
  });

  it('Катманду (UTC+5:45): отправка в окне, по часам человека', async () => {
    await settings(USER_A, { tz: 'Asia/Kathmandu', hour: 9 });
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const w = await wallet(USER_A);
    await rule(USER_A, { walletId: w });
    state.now = new Date('2026-10-10T03:14:00Z'); // 08:59 — рано
    expect((await cron()).body).toMatchObject({ inWindow: 0, skippedOutsideWindow: 1 });
    state.now = new Date('2026-10-10T03:15:00Z'); // 09:00
    expect((await cron()).body).toMatchObject({ inWindow: 1, sent: 1 });
  });

  it('«внесите траты»: любая живая операция за локальное сегодня гасит напоминание, удалённая и вчерашняя — нет', async () => {
    await settings(USER_A, { payments: false, debts: false, daily: true });
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const w = await wallet(USER_A);
    await tx(USER_A, { walletId: w, occurredOn: '2026-10-09' });
    await tx(USER_A, { walletId: w, occurredOn: '2026-10-10', deleted: true });
    expect((await cron()).body).toMatchObject({ sent: 1 });
    expect(bodies()[0]).toMatchObject({ body: 'Сегодня ещё нет записей. Внесите траты и доходы.', tag: 'finora-daily' });
    // в другой день, но операция сегодня есть → тишина
    await admin(`truncate public.push_log`);
    await tx(USER_A, { walletId: w, occurredOn: '2026-10-10' });
    expect((await cron()).body).toMatchObject({ sent: 0, skippedNothingToSend: 1 });
  });

  it('операция по долгу или по расписанию за сегодня тоже гасит «внесите траты»', async () => {
    await settings(USER_A, { payments: false, debts: false, daily: true });
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const w = await wallet(USER_A);
    const d = await debt(USER_A, { dueOn: null });
    await tx(USER_A, { walletId: w, occurredOn: '2026-10-10', kind: 'income', debtId: d });
    expect((await cron()).body).toMatchObject({ sent: 0 });
  });

  it('отключённые настройки (enabled = false) не обрабатываются; неверная зона в базе пропускает только своего человека', async () => {
    await settings(USER_A, { enabled: false });
    await settings(USER_B, { tz: 'Mars/Phobos' });
    await settings(USER_C);
    for (const [u, sid] of [[USER_A, '1'], [USER_B, '2'], [USER_C, '3']] as const) {
      await subscription(u, `${sid.repeat(8)}-${sid.repeat(4)}-4${sid.repeat(3)}-8${sid.repeat(3)}-${sid.repeat(12)}`);
      await rule(u, { walletId: await wallet(u) });
    }
    const r = await cron();
    expect(r.body).toMatchObject({ users: 2, skippedBadTimezone: 1, sent: 1, errors: 0 });
    expect(state.send.calls.map((c) => c.subId)).toEqual(['33333333-3333-4333-8333-333333333333']);
  });
});

describe('отправка: сбои, мёртвые подписки, чужие адреса', () => {
  const S1 = '11111111-1111-4111-8111-111111111111';
  const S2 = '22222222-2222-4222-8222-222222222222';

  async function oneUser() {
    await settings(USER_A);
    await subscription(USER_A, S1);
    const w = await wallet(USER_A);
    return rule(USER_A, { walletId: w });
  }

  it('никто не принял (503) → запись удалена из push_log, следующий час доставляет', async () => {
    await oneUser();
    state.send.outcomes.set(S1, { outcome: 'failed', status: 503 });
    expect((await cron()).body).toMatchObject({ sent: 0, failed: 1, failedStatuses: { '503': 1 } });
    expect(await logRows()).toEqual([]);
    state.send.outcomes.clear();
    state.now = new Date('2026-10-10T05:10:00Z');
    expect((await cron()).body).toMatchObject({ sent: 1, notified: 1 });
    expect(await logRows()).toHaveLength(1);
  });

  it('410: подписка помечена revoked_at, запись остаётся; такая подписка больше не используется', async () => {
    await oneUser();
    state.send.outcomes.set(S1, { outcome: 'dead', status: 410 });
    expect((await cron()).body).toMatchObject({ sent: 0, failed: 0, revoked: 1 });
    expect(await revokedIds()).toEqual([S1]);
    expect(await logRows()).toHaveLength(1);
    const next = await cron();
    expect(state.send.calls).toHaveLength(1);
    expect(next.body).toMatchObject({ skippedNoSubscriptions: 1 });
  });

  it('две подписки: одна принята, одна мертва → доставлено, мёртвая отозвана, живая осталась', async () => {
    await oneUser();
    await subscription(USER_A, S2);
    state.send.outcomes.set(S2, { outcome: 'dead', status: 404 });
    expect((await cron()).body).toMatchObject({ sent: 1, revoked: 1, notified: 1 });
    expect(await revokedIds()).toEqual([S2]);
  });

  it('уже отозванная подписка не получает ничего', async () => {
    await oneUser();
    await admin(`update public.push_subscriptions set revoked_at = now() where id = $1`, [S1]);
    expect((await cron()).body).toMatchObject({ sent: 0, skippedNoSubscriptions: 1 });
    expect(state.send.calls).toEqual([]);
    expect(await logRows()).toEqual([]);
  });

  it('адрес не от известного push-сервиса в таблице: не отправляется никому и не считается живой подпиской', async () => {
    await oneUser();
    await admin(`delete from public.push_subscriptions`);
    await subscription(USER_A, S1, 'evil.example');
    await subscription(USER_A, S2, '169.254.169.254');
    expect((await cron()).body).toMatchObject({ sent: 0, skippedBadEndpoint: 2, skippedNoSubscriptions: 1 });
    expect(state.send.calls).toEqual([]);
    expect(await logRows()).toEqual([]);
  });

  it('больше 20 подписок у одного человека: берутся 20 самых свежих (защита от раздувания таблицы)', async () => {
    await oneUser();
    await admin(`delete from public.push_subscriptions`);
    for (let i = 0; i < 25; i++) {
      const sid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await subscription(USER_A, sid);
      await admin(`update public.push_subscriptions set last_seen_at = now() - ($2 || ' minutes')::interval where id = $1`, [sid, String(i)]);
    }
    await cron();
    expect(state.send.calls).toHaveLength(20);
    expect(state.send.calls.map((c) => c.subId)).not.toContain('00000000-0000-4000-8000-000000000024');
  });

  it('база отвечает ошибкой на запись журнала: пользователь считается ошибкой, отправки нет', async () => {
    await oneUser();
    emu.failNext(500, 1, 'push_log');
    const r = await cron();
    expect(r.body).toMatchObject({ errors: 1, sent: 0 });
    expect(state.send.calls).toEqual([]);
    expect(await logRows()).toEqual([]);
    // следующий запуск сам всё доставит
    state.now = new Date('2026-10-10T05:10:00Z');
    expect((await cron()).body).toMatchObject({ sent: 1 });
  });

  it('журнал старше 60 суток чистится, свежий остаётся', async () => {
    await oneUser();
    await admin(`insert into public.push_log (user_id, kind, ref, sent_on) values ($1, 'daily', 'day', '2026-08-01'), ($1, 'daily', 'day', '2026-08-12'), ($1, 'daily', 'day', '2026-10-09')`, [USER_A]);
    await cron();
    const dates = (await logRows(USER_A)).map((l) => l.sent_on).sort();
    expect(dates).toEqual(['2026-08-12', '2026-10-09', '2026-10-10']);
  });
});

describe('объёмы: постраничное чтение и пачки', () => {
  it('сервер отдаёт не больше 3 строк за запрос: все операции долга всё равно прочитаны (остаток не искажается)', async () => {
    emu.setMaxRows(3);
    await settings(USER_A);
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const w = await wallet(USER_A);
    const d = await debt(USER_A, { dueOn: '2026-10-10', principal: 1000 });
    for (let i = 0; i < 10; i++) await tx(USER_A, { walletId: w, occurredOn: '2026-10-01', kind: 'income', debtId: d, amount: 100 }); // ровно погашен десятью платежами
    expect((await cron()).body).toMatchObject({ sent: 0, skippedNothingToSend: 1 });
    await tx(USER_A, { walletId: w, occurredOn: '2026-10-02', kind: 'income', debtId: d, amount: 100, deleted: true });
    await admin(`delete from public.push_log`);
    expect((await cron()).body).toMatchObject({ sent: 0 });
  });

  it('сервер отдаёт по 2 строки: настройки 7 пользователей и правила читаются полностью', async () => {
    emu.setMaxRows(2);
    const users = Array.from({ length: 7 }, (_, i) => `0000000${i}-0000-4000-8000-000000000000`);
    for (const u of users) {
      await settings(u);
      await subscription(u, `1111111${users.indexOf(u)}-1111-4111-8111-111111111111`);
      const w = await wallet(u);
      for (let k = 0; k < 5; k++) await rule(u, { walletId: w, note: `П${k}` });
    }
    const r = await cron();
    expect(r.body).toMatchObject({ users: 7, sent: 7, errors: 0 });
    expect(bodies().every((b) => b.body === 'Сегодня 5 платежей.')).toBe(true);
  });

  it('200 ежедневных правил: проверка операций идёт пачками по 100 id, журнал — пачками; все 400 свежих дат учтены', async () => {
    await settings(USER_A);
    await subscription(USER_A, '11111111-1111-4111-8111-111111111111');
    const w = await wallet(USER_A);
    await sql(
      USER_A,
      `insert into public.recurring_rules (id, created_at, client_updated_at, device_id, kind, wallet_id, amount_minor, note, frequency, interval_n, start_on, auto_post)
       select gen_random_uuid(), $1::timestamptz, $1::timestamptz, 'dev', 'expense', $2::uuid, 100, 'Ежедневно', 'daily', 1, '2026-01-01', 0 from generate_series(1, 200)`,
      [TS, w],
    );
    const r = await cron();
    expect(r.body).toMatchObject({ sent: 1, errors: 0 });
    expect(bodies()[0]!.body).toBe('Сегодня 200 платежей, просрочено 200.');
    expect(await logRows(USER_A)).toHaveLength(400);
    const idChecks = emu.log.filter((c) => c.table === 'transactions' && /id=in/.test(decodeURIComponent(c.query)));
    expect(idChecks).toHaveLength(4);
    for (const c of idChecks) expect(c.query.length).toBeLessThan(8000);
    // ответ на следующий запуск: всё уже в журнале
    expect((await cron()).body).toMatchObject({ sent: 0, skippedAlreadySent: 1 });
  });
});

describe('запросы функции: границы данных и размеров (сервисный ключ обходит RLS, поэтому фильтр по пользователю обязателен)', () => {
  it.each([
    ['ключ нового формата (sb_secret_…): только заголовок apikey', SB_KEY],
    ['ключ-JWT: apikey и Authorization', JWT_KEY],
  ])('%s', async (_name, key) => {
    serviceKey = key;
    emu = createPgrestEmulator(server, { base: BASE, serviceKey });
    await settings(USER_A);
    await settings(USER_B);
    for (const u of [USER_A, USER_B]) {
      await subscription(u, u === USER_A ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222');
      const w = await wallet(u);
      await rule(u, { walletId: w });
      const d = await debt(u, { dueOn: '2026-10-10' });
      await tx(u, { walletId: w, occurredOn: '2026-10-01', kind: 'income', debtId: d, amount: 10 });
    }
    await settings(USER_A, { daily: true });
    const r = await cron();
    expect(r.body).toMatchObject({ users: 2, sent: 2, errors: 0 });
    const perUser = new Set(['recurring_rules', 'debts', 'transactions', 'wallets', 'push_subscriptions']);
    for (const c of emu.log) {
      const q = decodeURIComponent(c.query);
      // единственное чтение без фильтра по пользователю: «кто ещё записан на этот адрес» — только id и время, по одному адресу, только действующие
      const isClaims = c.table === 'push_subscriptions' && /^\?select=id,last_seen_at&endpoint=eq\.https:\/\/[^&]+&revoked_at=is\.null&order=last_seen_at\.desc,id\.asc&limit=\d+$/.test(q);
      if (c.method === 'GET' && perUser.has(c.table) && !isClaims) expect(q, `${c.table}: нет фильтра по пользователю`).toMatch(/user_id=eq\.[0-9a-f-]{36}/);
      if (c.method === 'GET') expect(q, `${c.table}: нет limit или он больше 1000`).toMatch(/limit=(\d{1,3}|1000)(&|$)/);
      if (c.method === 'DELETE' && c.table !== 'push_log') throw new Error(`удаление из ${c.table}`);
      if (c.method === 'PATCH') expect(c.table).toBe('push_subscriptions');
    }
    // никаких запросов к таблицам, которые функции не нужны
    expect([...new Set(emu.log.map((c) => c.table))].sort()).toEqual(['debts', 'push_log', 'push_subscriptions', 'recurring_rules', 'reminder_settings', 'transactions', 'wallets'].sort());
  });

  it('ключ неверный → 502 (база отвечает 401), ответ без подробностей', async () => {
    await settings(USER_A);
    const r = await cron({ env: envOf({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_wrong-key-000000000000' }) });
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ ok: false, error: 'db_read_failed' });
  });
});

describe('«Проверить уведомление» с настоящей проверкой токена (auth/v1/user)', () => {
  const S_A = '11111111-1111-4111-8111-111111111111';
  const S_B = '22222222-2222-4222-8222-222222222222';
  const testReq = (token: string) => request('POST', { token, body: { action: 'test' } });

  beforeEach(async () => {
    await subscription(USER_A, S_A);
    await subscription(USER_B, S_B);
  });

  it('действующий токен: подписки только этого пользователя; журнала и настроек нет; чужие подписки не тронуты', async () => {
    const r = await handler()(testReq(makeJwt({ sub: USER_A, exp: Math.floor(Date.now() / 1000) + 3600 })));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, sent: 1 });
    expect(state.send.calls.map((c) => c.subId)).toEqual([S_A]);
    expect(await logRows()).toEqual([]);
    expect(emu.log.filter((c) => c.table === 'reminder_settings')).toEqual([]);
  });

  it('просроченный, без подписи, чужой проект и несуществующий пользователь → 401 без отправки', async () => {
    const tokens = [
      makeJwt({ sub: USER_A, exp: Math.floor(Date.now() / 1000) - 10 }),
      'eyJhbGciOiJub25lIn0.e30.',
      'aaa.bbb.ccc',
      makeJwt({ sub: 'ffffffff-ffff-4fff-8fff-ffffffffffff', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ];
    for (const t of tokens) {
      const r = await handler()(testReq(t));
      expect(r.status, t.slice(0, 20)).toBe(401);
    }
    expect(state.send.calls).toEqual([]);
  });

  it('сервер авторизации ответил ошибкой 500 → 503, а не «токен плохой»', async () => {
    const failing: typeof emu.fetch = async (url, init) => (String(url).includes('/auth/v1/user') ? new Response('boom', { status: 500 }) : emu.fetch(url, init));
    const r = await handler({ fetchImpl: failing })(testReq(makeJwt({ sub: USER_A, exp: Math.floor(Date.now() / 1000) + 3600 })));
    expect(r.status).toBe(503);
  });

  it('ключ отправляется серверу авторизации только в заголовке apikey; токен пользователя — в Authorization', async () => {
    const seen: Array<Record<string, string>> = [];
    const spy: typeof emu.fetch = async (url, init) => {
      if (String(url).includes('/auth/v1/user')) seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return emu.fetch(url, init);
    };
    const token = makeJwt({ sub: USER_A, exp: Math.floor(Date.now() / 1000) + 3600 });
    await handler({ fetchImpl: spy })(testReq(token));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ apikey: SB_KEY, authorization: `Bearer ${token}` });
  });
});
