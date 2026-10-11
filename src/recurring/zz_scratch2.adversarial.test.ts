// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from '../../tests/sync/factories';
import { openDevice, type Device } from '../../tests/sync/engineHarness';
import { createPgliteServer, type PgliteServer } from '../../tests/sync/pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from '../../tests/sync/postgrestEmulator';
import { runAutoPost } from './autoPost';
import { wasSkipped } from './useSkipped';

let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  emu = createPostgrestEmulator(pg);
}, 120_000);
afterAll(async () => { await pg.close(); });

async function device(userId: string, deviceId: string, now?: () => number): Promise<Device> {
  const token = makeJwt({ sub: userId });
  const client = createClient(emu.url, makeJwt({ role: 'anon' }), {
    global: { fetch: emu.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });
  return openDevice(null, deviceId, { userId, transport: createSupabaseTransport(client), seed: true, now });
}

describe('scratch real schema', () => {
  for (const skew of [0, 3600_000, -3600_000]) {
  it(`skip roundtrip skew=${skew}`, async () => {
    const u = makeUserId();
    const a = await device(u, 'phone', () => Date.now() + skew);
    await a.engine.syncNow();
    const b = await device(u, 'laptop');
    await b.engine.syncNow();
    const cash = (await a.store.db.wallets.toArray())[0]!;
    const r = await a.store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 30_000, frequency: 'daily', startOn: '2026-10-11', note: 'x', autoPost: 1 });
    await a.engine.syncNow(); await b.engine.syncNow();
    const row = await a.store.transactions.skipOccurrence(r.id, '2026-10-11');
    for (let i = 0; i < 3; i++) { await a.engine.syncNow(); await b.engine.syncNow(); }
    const onA = await a.store.db.transactions.get(row.id);
    const onB = await b.store.db.transactions.get(row.id);
    console.log('SKEW', skew, 'A', onA?.createdAt, onA?.deletedAt, 'B', onB?.createdAt, onB?.deletedAt);
    expect(onB).toBeTruthy();
    const res = await runAutoPost({ store: b.store, today: '2026-10-11', getRate: () => null, toLocal: (i) => i.slice(0, 10) });
    expect(res.posted).toBe(0);
    expect(wasSkipped(onB!)).toBe(true);
    expect(wasSkipped(onA!)).toBe(true);
  }, 60_000);
  }
});
