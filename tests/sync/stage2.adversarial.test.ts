// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultId, exportBackup } from '@/db';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from './factories';
import { openDevice, type Device } from './engineHarness';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  emu = createPostgrestEmulator(pg);
}, 120_000);
afterAll(async () => {
  await pg.close();
});

const ANON_KEY = makeJwt({ role: 'anon' });

async function device(userId: string, deviceId: string, now?: () => number): Promise<Device> {
  const session = { token: makeJwt({ sub: userId }) };
  const client = createClient(emu.url, ANON_KEY, {
    global: { fetch: emu.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => session.token,
  });
  return openDevice(null, deviceId, { userId, transport: createSupabaseTransport(client), seed: true, now });
}
const rowsOf = async (userId: string, table: string) => (await pg.adminRows(table as never)).filter((r) => r['user_id'] === userId);
const state = async (d: Device) => ({ ...(await exportBackup(d.store)), exportedAt: '' });
const converge = async (...ds: Device[]) => {
  for (let i = 0; i < 4; i++) for (const d of ds) await d.engine.syncNow();
};

describe('ЭТАП 2 на настоящей схеме (PGlite + PostgREST)', () => {
  it('три устройства офлайн: один бюджет, одно правило, одна операция за дату, пропуск против проведения — все сходятся', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    const b = await device(u, 'dev-b');
    const c = await device(u, 'dev-c');
    await converge(a, b, c);
    const food = await defaultId(u, 'category:food');
    const cash = (await a.store.db.wallets.toArray())[0]!;
    const rule = await a.store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5000, frequency: 'monthly', startOn: '2026-10-31', categoryId: food });
    await converge(a, b, c);
    // каждый — офлайн-действия
    const ba = await a.store.budgets.create({ categoryId: food, amountMinor: 10_000 });
    const bb = await b.store.budgets.create({ categoryId: food, amountMinor: 20_000 });
    const bc = await c.store.budgets.create({ categoryId: food, amountMinor: 30_000 });
    expect(new Set([ba.id, bb.id, bc.id]).size).toBe(1);
    await a.store.transactions.createFromRule(rule.id, '2026-10-31');
    await b.store.transactions.createFromRule(rule.id, '2026-10-31');
    await c.store.transactions.skipOccurrence(rule.id, '2026-10-31');
    const debt = await a.store.debts.create({ direction: 'borrowed', counterparty: 'Саид', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' });
    await converge(a, b, c);
    expect(await rowsOf(u, 'budgets')).toHaveLength(1);
    expect(await rowsOf(u, 'recurring_rules')).toHaveLength(1);
    expect((await rowsOf(u, 'transactions')).filter((r) => r['recurring_rule_id'] === rule.id)).toHaveLength(1);
    expect(await rowsOf(u, 'debts')).toHaveLength(1);
    const [sa, sb, sc] = [await state(a), await state(b), await state(c)];
    expect(sb).toEqual(sa);
    expect(sc).toEqual(sa);
    for (const d of [a, b, c]) expect(d.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
    void debt;
  }, 60_000);

  it('цепочка долг→правило→операция создана офлайн в одном устройстве и уходит одним синком без карантина', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await a.engine.syncNow();
    const cash = (await a.store.db.wallets.toArray())[0]!;
    const debt = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' });
    const rule = await a.store.recurring.create({ kind: 'income', walletId: cash.id, debtId: debt.id, amountMinor: 1000, frequency: 'weekly', startOn: '2026-10-05' });
    await a.store.transactions.createFromRule(rule.id, '2026-10-05');
    await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 50_000, occurredOn: '2026-10-01', debtId: debt.id });
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
    expect((await rowsOf(u, 'transactions')).length).toBe(2);
    const b = await device(u, 'dev-b');
    await converge(a, b);
    expect(await state(b)).toEqual(await state(a));
  }, 60_000);

  it('чужой пользователь не может сослаться на мой долг/правило/категорию в своей строке', async () => {
    const u = makeUserId();
    const v = makeUserId();
    const a = await device(u, 'dev-a');
    const x = await device(v, 'dev-x');
    await converge(a, x);
    const cashA = (await a.store.db.wallets.toArray())[0]!;
    const debt = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' });
    const rule = await a.store.recurring.create({ kind: 'expense', walletId: cashA.id, amountMinor: 1000, frequency: 'weekly', startOn: '2026-10-05' });
    await converge(a, x);
    // Икс подсовывает в свою базу операцию со ссылкой на чужой долг и чужое правило (минуя репозиторий)
    const cashX = (await x.store.db.wallets.toArray())[0]!;
    const { makeTransaction } = await import('./factories');
    const tx = makeTransaction({ walletId: cashX.id, debtId: debt.id, recurringRuleId: rule.id, deviceId: 'dev-x', clientUpdatedAt: new Date(Date.now() - 1000).toISOString(), createdAt: new Date(Date.now() - 1000).toISOString() });
    await x.store.db.transactions.put({ ...tx, dirty: 1, serverSeq: null, syncError: null });
    await x.engine.syncNow();
    expect((await rowsOf(v, 'transactions')).map((r) => r['id'])).not.toContain(tx.id);
    expect((await x.store.db.transactions.get(tx.id))?.syncError).not.toBeNull();
  }, 60_000);
});
