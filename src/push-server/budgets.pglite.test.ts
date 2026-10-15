// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteServer, type PgliteServer } from '../../tests/sync/pglite';
import { createHandler, type HandlerDeps } from '../../supabase/functions/send-reminders/index';
import { createPgrestEmulator, type PgrestEmulator } from './pgrestEmulator';
import { admin, appSettings, budget, category, debt, logRows, rule, settings, subscription, tx, useServer, wallet } from './pgliteKit';
import { CRON, USER_A, USER_B, envOf, fakeSender, request, type FakeSender } from './testkit';

/* ---------------------------------------------------------------------------------------------
 * Лимиты бюджета функцией send-reminders НАСТОЯЩИМ кодом против НАСТОЯЩЕЙ supabase/schema.sql (PGlite): неверный фильтр или имя
 * колонки в запросах к budgets / categories / transactions / settings / push_log ломает тест так же, как сломал бы на живом Supabase.
 * ------------------------------------------------------------------------------------------- */

const BASE = 'http://postgrest.test';
const SB_KEY = 'sb_secret_test-key-000000000000';
const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе, 10 октября
const SUB = '11111111-1111-4111-8111-111111111111';

let server: PgliteServer;
let emu: PgrestEmulator;
const state: { send: FakeSender; now: Date } = { send: fakeSender(), now: NOW };

function handler(over: HandlerDeps = {}) {
  return createHandler({ env: envOf({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SB_KEY }), now: () => state.now, fetchImpl: emu.fetch, send: state.send, ...over });
}
const cron = async () => {
  const r = await handler()(request('POST', { token: CRON, body: {} }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const bodies = () => state.send.bodies();

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
  state.send = fakeSender();
  state.now = NOW;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('лимиты бюджета на настоящей схеме', () => {
  async function monthOf(user: string) {
    await appSettings(user, 'TJS');
    const w = await wallet(user);
    const w2 = await wallet(user);
    const usd = await wallet(user, 'USD');
    const food = await category(user, { name: 'Еда' });
    const cafe = await category(user, { name: 'Кафе', parentId: food, archived: true }); // подкатегория в архиве: траты в ней всё равно считаются
    const bus = await category(user, { name: 'Транспорт' });
    const gone = await category(user, { name: 'Удалённая', parentId: food, deleted: true });
    const b = {
      food: await budget(user, { categoryId: food, amount: 100_000 }),
      bus: await budget(user, { categoryId: bus, amount: 100_000 }),
      total: await budget(user, { categoryId: null, amount: 500_000 }),
      usd: await budget(user, { categoryId: food, amount: 1, currency: 'USD' }), // другая валюта, чем основная
      archived: await budget(user, { categoryId: bus, amount: 1, archived: true }),
      deleted: await budget(user, { categoryId: bus, amount: 1, deleted: true }),
    };
    const d = await debt(user, { dueOn: null });
    await tx(user, { walletId: w, occurredOn: '2026-10-02', amount: 60_000, categoryId: food });
    await tx(user, { walletId: w, occurredOn: '2026-10-05', amount: 25_000, categoryId: cafe }); // еда = 85 000 (85%)
    await tx(user, { walletId: w, occurredOn: '2026-10-06', amount: 3_000, categoryId: gone }); // удалённая подкатегория: 88 000 (88%)
    await tx(user, { walletId: w, occurredOn: '2026-10-06', amount: 9_000_000, kind: 'income' }); // доход не считается
    await tx(user, { walletId: w, occurredOn: '2026-10-07', amount: 9_000_000, debtId: d }); // долг не считается
    await tx(user, { walletId: usd, occurredOn: '2026-10-07', amount: 9_000_000, baseCurrency: 'USD' }); // снимок в другой валюте
    await tx(user, { walletId: w, occurredOn: '2026-10-07', amount: 9_000_000, categoryId: food, deleted: true }); // удалена
    await tx(user, { walletId: w, occurredOn: '2026-09-30', amount: 9_000_000, categoryId: food }); // прошлый месяц
    await tx(user, { walletId: w, occurredOn: '2026-11-01', amount: 9_000_000, categoryId: food }); // следующий месяц
    await tx(user, { walletId: w, occurredOn: '2026-10-08', amount: 1_000_000, toWalletId: w2, kind: 'transfer', baseAmount: 5_000 }); // комиссия 5 000 — только в общий
    await tx(user, { walletId: w, occurredOn: '2026-10-08', amount: 12_000, categoryId: bus }); // транспорт 12%
    return { food, bus, b };
  }

  it('считает так же, как экран: подкатегории (в том числе архивные и удалённые), общий лимит, комиссия, доходы и долги не входят; суммы не пишутся', async () => {
    await settings(USER_A, { budgets: true, payments: false, debts: false });
    await subscription(USER_A, SUB);
    const m = await monthOf(USER_A);
    const r = await cron();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, users: 1, inWindow: 1, sent: 1, notified: 1, errors: 0 });
    // еда 88% («на исходе»); транспорт 12%; общий: 88 000 + 12 000 + 5 000 = 105 000 из 500 000 = 21%
    expect(bodies()).toEqual([{ title: 'Sumoima', body: 'Лимит на исходе: потрачено 88%.', url: '/budgets', tag: 'finora-budgets' }]);
    expect(state.send.calls[0]!.body).not.toMatch(/Еда|88000|100000|500000/);
    expect(await logRows(USER_A)).toEqual([{ user_id: USER_A, kind: 'budget', ref: `${m.b.food}:warn`, sent_on: '2026-10-10' }]);
    // тот же уровень в тот же и в следующие дни месяца — тишина
    expect(await cron()).toMatchObject({ body: { sent: 0 } });
    state.now = new Date('2026-10-20T04:10:00Z');
    await cron();
    expect(bodies()).toHaveLength(1);
  });

  it('рост до 90% и превышения присылает новые сообщения; название — при show_details; журнал читается с начала месяца', async () => {
    await settings(USER_A, { budgets: true, payments: false, debts: false, details: true });
    await subscription(USER_A, SUB);
    const m = await monthOf(USER_A);
    await cron();
    const w = (await admin<{ id: string }>(`select id from public.wallets where user_id = '${USER_A}' and currency = 'TJS' limit 1`))[0]!.id;
    await tx(USER_A, { walletId: w, occurredOn: '2026-10-09', amount: 4_000, categoryId: m.food }); // 92 000 → 92%
    state.now = new Date('2026-10-11T04:10:00Z');
    await cron();
    await tx(USER_A, { walletId: w, occurredOn: '2026-10-12', amount: 10_000, categoryId: m.food }); // 102 000 → превышен
    state.now = new Date('2026-10-12T04:10:00Z');
    await cron();
    expect(bodies().map((b) => b.body)).toEqual(['Лимит «Еда» на исходе: потрачено 88%.', 'Лимит «Еда» на исходе: потрачено 92%.', 'Лимит «Еда» превышен: потрачено 102%.']);
    expect((await logRows(USER_A)).map((l) => l.ref)).toEqual([`${m.b.food}:danger`, `${m.b.food}:over`, `${m.b.food}:warn`].sort());
  });

  it('новый месяц: лимиты считаются заново по ноябрьским тратам (в тестовых данных там одна огромная трата)', async () => {
    await settings(USER_A, { budgets: true, payments: false, debts: false });
    await subscription(USER_A, SUB);
    await monthOf(USER_A);
    await cron();
    state.now = new Date('2026-11-05T04:10:00Z');
    expect(await cron()).toMatchObject({ body: { sent: 1 } });
    // в ноябре превышены лимит «Еда» и общий; октябрьские траты не считаются
    expect(bodies().map((b) => b.body)).toEqual(['Лимит на исходе: потрачено 88%.', 'Лимиты бюджета: превышено 2.']);
  });

  it('чужие данные не влияют; переключатель выключен — лимитов не касаются', async () => {
    await settings(USER_A, { budgets: false, payments: false, debts: false });
    await subscription(USER_A, SUB);
    await monthOf(USER_A);
    expect(await cron()).toMatchObject({ body: { sent: 0, skippedNothingToSend: 1 } });
    await settings(USER_A, { budgets: true, payments: false, debts: false });
    await settings(USER_B, { budgets: true, payments: false, debts: false });
    await subscription(USER_B, '22222222-2222-4222-8222-222222222222');
    await appSettings(USER_B, 'TJS'); // у B нет ни лимитов, ни трат
    await cron();
    expect(bodies()).toHaveLength(1); // только A
    expect((await logRows(USER_B))).toEqual([]);
  });

  it('схема до раздела 12 (нет колонки remind_budgets): остальные напоминания работают как раньше, лимиты молчат', async () => {
    await settings(USER_A, { payments: true, debts: false });
    await subscription(USER_A, SUB);
    const w = await wallet(USER_A);
    await rule(USER_A, { walletId: w, note: 'Аренда' });
    await admin(`alter table public.reminder_settings drop column remind_budgets`);
    try {
      emu = createPgrestEmulator(server, { base: BASE, serviceKey: SB_KEY }); // новый эмулятор: список колонок читается заново
      const r = await cron();
      expect(r.body).toMatchObject({ ok: true, users: 1, sent: 1, errors: 0 });
      expect(bodies()).toEqual([{ title: 'Sumoima', body: 'Сегодня 1 платёж.', url: '/recurring', tag: 'finora-payments' }]);
    } finally {
      await admin(`alter table public.reminder_settings add column if not exists remind_budgets boolean not null default false`);
    }
  });

  it('журнал принимает kind = budget и по-прежнему отвергает чужие виды; повторный запуск раздела 12 безопасен', async () => {
    await settings(USER_A, { budgets: true });
    await admin(`insert into public.push_log (user_id, kind, ref, sent_on) values ('${USER_A}', 'budget', 'x:warn', '2026-10-10')`);
    await expect(admin(`insert into public.push_log (user_id, kind, ref, sent_on) values ('${USER_A}', 'bogus', 'x', '2026-10-10')`)).rejects.toThrow();
    await admin(`alter table public.push_log drop constraint if exists push_log_kind`);
    await admin(`alter table public.push_log add constraint push_log_kind check (kind in ('payment', 'debt', 'daily', 'budget'))`);
    expect((await logRows(USER_A)).map((l) => l.kind)).toEqual(['budget']);
  });
});
