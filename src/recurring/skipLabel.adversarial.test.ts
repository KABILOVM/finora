// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from '../../tests/sync/factories';
import { openDevice, type Device } from '../../tests/sync/engineHarness';
import { createPgliteServer, type PgliteServer } from '../../tests/sync/pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from '../../tests/sync/postgrestEmulator';
import { wasSkipped } from './useSkipped';

/**
 * Атака «метка “Пропущен” после круга через сервер» на НАСТОЯЩЕЙ схеме (PGlite + supabase/schema.sql).
 * Пропуск = операция, созданная сразу удалённой (createdAt === deletedAt), и раздел «Пропущенные» отличает её от «Удалён из операций»
 * по равенству двух меток. Сервер при вставке зажимает created_at до «сейчас + 5 минут» (private.sync_guard), а deleted_at не трогает.
 * Телефон с часами на час вперёд (неверный пояс) после обмена с сервером видит свой же пропуск как «Удалён из операций».
 */

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

describe('метка «Пропущен» переживает обмен с сервером', () => {
  it('часы телефона на час впереди: пропуск после синхронизации всё ещё «Пропущен» и на телефоне, и на втором устройстве', async () => {
    const u = makeUserId();
    const phone = await device(u, 'phone', () => Date.now() + 3_600_000);
    await phone.engine.syncNow();
    const laptop = await device(u, 'laptop');
    await laptop.engine.syncNow();
    const cash = (await phone.store.db.wallets.toArray())[0]!;
    const rule = await phone.store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 30_000, frequency: 'daily', startOn: '2026-10-11', note: 'абонемент' });
    await phone.engine.syncNow();
    await laptop.engine.syncNow();

    const skipped = await phone.store.transactions.skipOccurrence(rule.id, '2026-10-11');
    expect(wasSkipped(skipped), 'сразу после пропуска метка верна').toBe(true);
    for (let i = 0; i < 3; i++) {
      await phone.engine.syncNow();
      await laptop.engine.syncNow();
    }

    const onPhone = (await phone.store.db.transactions.get(skipped.id))!;
    const onLaptop = (await laptop.store.db.transactions.get(skipped.id))!;
    expect(wasSkipped(onPhone), `на телефоне: createdAt=${onPhone.createdAt}, deletedAt=${onPhone.deletedAt}`).toBe(true);
    expect(wasSkipped(onLaptop), `на ноутбуке: createdAt=${onLaptop.createdAt}, deletedAt=${onLaptop.deletedAt}`).toBe(true);
  }, 60_000);
});
