// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteServer, type PgliteServer } from '../../tests/sync/pglite';
import { createHandler, type HandlerDeps } from '../../supabase/functions/send-reminders/index';
import { createPgrestEmulator, type PgrestEmulator } from './pgrestEmulator';
import { admin, logRows, rule, settings, sql, subscription, useServer, wallet } from './pgliteKit';
import { CRON, USER_A, USER_B, envOf, fakeSender, request, type FakeSender } from './testkit';

/* ---------------------------------------------------------------------------------------------
 * Нападение на send-reminders НАСТОЯЩИМ кодом против НАСТОЯЩЕЙ supabase/schema.sql (PGlite + подмена PostgREST).
 * Данные клиента кладутся от имени пользователя (защита строк работает), как это делает приложение.
 * НЕ живой Supabase.
 * ------------------------------------------------------------------------------------------- */

const BASE = 'http://postgrest.test';
const SB_KEY = 'sb_secret_adversarial-key-000000';
const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе, 10 октября

let server: PgliteServer;
let emu: PgrestEmulator;
let sender: FakeSender;

function handler(over: HandlerDeps = {}) {
  return createHandler({ env: envOf({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SB_KEY }), now: () => NOW, fetchImpl: emu.fetch, send: sender, ...over });
}
const cron = async (h = handler()) => {
  const r = await h(request('POST', { token: CRON, body: {} }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  server = await createPgliteServer();
  useServer(server);
  for (const u of [USER_A, USER_B]) await server.addUser(u);
}, 60_000);
afterAll(async () => {
  await server?.close();
});
beforeEach(async () => {
  await admin(`truncate public.push_log, public.push_subscriptions, public.reminder_settings, public.transactions, public.recurring_rules, public.debts, public.budgets, public.categories, public.wallets, public.settings cascade`);
  emu = createPgrestEmulator(server, { base: BASE, serviceKey: SB_KEY });
  sender = fakeSender();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

const SA = '11111111-1111-4111-8111-111111111111';
const SB = '22222222-2222-4222-8222-222222222222';
const PHONE = 'https://web.push.apple.com/shared-phone-endpoint-0001';

/** То, что делает приложение при входе человека на устройстве: сохраняет подписку этого браузера за ним (от его имени). */
async function clientSubscribes(user: string, id: string, endpoint: string, lastSeen: string): Promise<void> {
  await sql(
    user,
    `insert into public.push_subscriptions (id, device_id, endpoint, p256dh, auth_secret, user_agent, last_seen_at, revoked_at)
     values ($1, 'dev', $2, $3, $4, '', $5, null)
     on conflict (user_id, endpoint) do update set last_seen_at = excluded.last_seen_at, revoked_at = null`,
    [id, endpoint, `p256dh-${id}`.padEnd(30, 'x'), `auth-${id}`.padEnd(12, 'x'), lastSeen],
  );
}

describe('один телефон, два человека (выход без отзыва подписки / выход без сети)', () => {
  it('А вышел, Б вошёл на том же телефоне (адрес push тот же): напоминание А не приходит на экран Б; сообщение Б — приходит', async () => {
    await settings(USER_A, { details: true });
    await settings(USER_B, { details: true });
    const wa = await wallet(USER_A);
    const wb = await wallet(USER_B);
    await rule(USER_A, { walletId: wa, note: 'Кредит Ахмада' });
    await rule(USER_B, { walletId: wb, note: 'Аренда Беху' });
    // А подписал телефон 1 октября и вышел из аккаунта без сети: отзыв не дошёл. Б вошёл 9 октября; браузер выдал тот же адрес.
    await clientSubscribes(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
    await clientSubscribes(USER_B, SB, PHONE, '2026-10-09T10:00:00Z');

    await cron();

    const toPhone = sender.calls.filter((c) => c.endpoint === PHONE);
    const texts = toPhone.map((c) => (JSON.parse(c.body) as { body: string }).body);
    // экран Б не должен показывать ни слова про платежи А
    expect(texts.filter((t) => t.includes('Ахмад'))).toEqual([]);
    expect(toPhone.map((c) => c.subId)).not.toContain(SA);
    // а своё напоминание Б получает
    expect(toPhone.map((c) => c.subId)).toContain(SB);
  });

  it('напоминание А не «съедено»: пока у А нет живого устройства, запись в журнал не пишется (придёт, когда он подпишет своё)', async () => {
    await settings(USER_A);
    await rule(USER_A, { walletId: await wallet(USER_A) });
    await clientSubscribes(USER_A, SA, PHONE, '2026-10-01T10:00:00Z');
    await clientSubscribes(USER_B, SB, PHONE, '2026-10-09T10:00:00Z');
    await cron();
    expect(sender.calls.some((c) => c.subId === SA)).toBe(false);
    expect(await logRows(USER_A)).toEqual([]);
  });

  it('регрессия: у каждого свой телефон — оба получают своё и только своё', async () => {
    await settings(USER_A);
    await settings(USER_B);
    await rule(USER_A, { walletId: await wallet(USER_A) });
    await rule(USER_B, { walletId: await wallet(USER_B) });
    await clientSubscribes(USER_A, SA, 'https://fcm.googleapis.com/fcm/send/phone-a', '2026-10-09T10:00:00Z');
    await clientSubscribes(USER_B, SB, 'https://fcm.googleapis.com/fcm/send/phone-b', '2026-10-09T10:00:00Z');
    await cron();
    expect(sender.calls.map((c) => c.subId).sort()).toEqual([SA, SB]);
  });
});

describe('одновременные запуски', () => {
  it('два запуска в одну секунду (повтор cron, ручной curl): сообщение уходит один раз, журнал без дублей', async () => {
    await settings(USER_A);
    await subscription(USER_A, SA);
    await rule(USER_A, { walletId: await wallet(USER_A) });
    const [a, b] = await Promise.all([cron(), cron()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(sender.calls).toHaveLength(1);
    expect(await logRows(USER_A)).toHaveLength(1);
  });

  it('пять запусков разом при сбое отправки: потом один успешный доставляет ровно один раз', async () => {
    await settings(USER_A);
    await subscription(USER_A, SA);
    await rule(USER_A, { walletId: await wallet(USER_A) });
    sender.outcomes.set(SA, { outcome: 'failed', status: 503 });
    await Promise.all([cron(), cron(), cron(), cron(), cron()]);
    sender.outcomes.clear();
    const before = sender.calls.length;
    await cron();
    expect(sender.calls.length - before).toBe(1);
    await cron();
    expect(sender.calls.length - before).toBe(1);
  });
});

describe('повторный запуск схемы в SQL Editor поверх живых данных напоминаний', () => {
  it('подписки (в том числе отозванные), настройки, журнал и права после двух повторных запусков не меняются', async () => {
    await settings(USER_A, { details: true, hour: 7, tz: 'Asia/Kathmandu' });
    await subscription(USER_A, SA);
    await subscription(USER_A, SB);
    await admin(`update public.push_subscriptions set revoked_at = '2026-10-05T00:00:00Z', last_seen_at = '2026-10-04T00:00:00Z' where id = $1`, [SB]);
    await admin(`insert into public.push_log (user_id, kind, ref, sent_on) values ($1, 'daily', 'day', '2026-10-09')`, [USER_A]);

    const snapshot = async () => ({
      subs: await admin(`select * from public.push_subscriptions order by id`),
      settings: await admin(`select * from public.reminder_settings order by user_id`),
      log: await admin(`select user_id, kind, ref, sent_on, created_at from public.push_log order by ref`),
      policies: await admin(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where tablename in ('push_subscriptions','reminder_settings','push_log') order by tablename, policyname`),
      grants: await admin(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ('push_subscriptions','reminder_settings','push_log') order by 1, 2, 3`),
      rls: await admin(`select relname, relrowsecurity from pg_class where relname in ('push_subscriptions','reminder_settings','push_log') order by 1`),
    });
    const before = await snapshot();
    await server.applySchema();
    await server.applySchema();
    expect(await snapshot()).toEqual(before);
  });
});
