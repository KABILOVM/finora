// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSeeded, exportBackup } from '@/db';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from './factories';
import { openDevice, type Device } from './engineHarness';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

const STAGE1 = readFileSync(fileURLToPath(new URL('./fixtures/schema.stage1.sql', import.meta.url)), 'utf8');
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer({ schema: STAGE1 });
  emu = createPostgrestEmulator(pg);
}, 120_000);
afterAll(async () => {
  await pg.close();
});

async function device(userId: string, deviceId: string): Promise<Device> {
  const client = createClient(emu.url, makeJwt({ role: 'anon' }), {
    global: { fetch: emu.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => makeJwt({ sub: userId }),
  });
  return openDevice(null, deviceId, { userId, transport: createSupabaseTransport(client), seed: true });
}

describe('новое приложение, а схема в облаке ещё старая (этап 1)', () => {
  it('ничего не уходит в карантин и не теряется; после выполнения schema.sql всё доезжает, второе устройство получает всё', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);
    await a.engine.syncNow();
    const cash = (await a.store.db.wallets.toArray())[0]!;
    await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1234, occurredOn: '2026-10-05', note: 'до обновления схемы' });
    const debt = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 5000, currency: 'TJS', openedOn: '2026-10-01' });
    await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5000, occurredOn: '2026-10-01', debtId: debt.id });
    await a.engine.syncNow();
    await a.engine.syncNow();
    const st = a.engine.getStatus();
    expect(st.quarantined).toBe(0);
    expect(st.pending).toBeGreaterThan(0);
    // облако обновили
    await pg.applySchema();
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) { await b.engine.syncNow(); await a.engine.syncNow(); }
    expect({ ...(await exportBackup(b.store)), exportedAt: '' }).toEqual({ ...(await exportBackup(a.store)), exportedAt: '' });
    expect(await b.store.db.transactions.count()).toBe(2);
  }, 60_000);
});
