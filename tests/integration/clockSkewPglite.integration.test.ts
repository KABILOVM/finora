// @vitest-environment node
/**
 * Устройство с отстающими часами на НАСТОЯЩЕЙ схеме (триггер sync_guard): правка со старой меткой сервером игнорируется.
 * Устройства обязаны сходиться (или человек должен узнать, что правка не принята).
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from '../sync/factories';
import { openDevice, type Device } from '../sync/engineHarness';
import { createPgliteServer, type PgliteServer } from '../sync/pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from '../sync/postgrestEmulator';

let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  emu = createPostgrestEmulator(pg);
}, 120_000);
afterAll(async () => {
  await pg.close();
});

async function device(userId: string, deviceId: string, now?: () => number): Promise<Device> {
  const token = makeJwt({ sub: userId });
  const client = createClient(emu.url, makeJwt({ role: 'anon' }), {
    global: { fetch: emu.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });
  return openDevice(null, deviceId, { userId, transport: createSupabaseTransport(client), seed: true, now });
}

describe('часы телефона отстают на 2 часа (настоящая схема)', () => {
  it('после правки существующей записи телефон, ноутбук и сервер показывают одно и то же', async () => {
    const u = makeUserId();
    const laptop = await device(u, 'laptop');
    await laptop.engine.syncNow();
    const cash = (await laptop.store.db.wallets.toArray())[0]!;
    const tx = await laptop.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500_00, occurredOn: '2026-10-05', note: 'аренда' });
    await laptop.engine.syncNow();
    const phone = await device(u, 'phone', () => Date.now() - 2 * 3_600_000);
    await phone.engine.syncNow();
    await phone.store.transactions.update(tx.id, { amountMinor: 450_00, note: 'аренда (скидка)' });
    for (let i = 0; i < 2; i++) {
      await phone.engine.syncNow();
      await laptop.engine.syncNow();
    }
    const server = (await pg.adminRows('transactions')).find((r) => r['id'] === tx.id)!;
    const local = async (d: Device) => {
      const r = (await d.store.db.transactions.get(tx.id))!;
      return `${r.amountMinor}|${r.note}`;
    };
    const seen = { телефон: await local(phone), ноутбук: await local(laptop), сервер: `${server['amount_minor']}|${server['note']}` };
    expect(new Set(Object.values(seen)).size, `устройства расходятся: ${JSON.stringify(seen)}`).toBe(1);
  }, 60_000);
});
