// @vitest-environment node
/**
 * Копия, сделанная в ДРУГОМ аккаунте (или в старом аккаунте того же человека), загружается в новый аккаунт на живой схеме
 * (настоящая schema.sql: первичный ключ id глобальный, политики RLS). Окно «Копия из другого аккаунта» прямо предлагает
 * такую загрузку, поэтому записи обязаны дойти до сервера нового аккаунта, а чужие строки — остаться нетронутыми.
 */
import { createClient } from '@supabase/supabase-js';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_USER_ID } from '@/auth/config';
import { ensureSeeded, exportBackup, importBackup, openStore } from '@/db';
import { withoutSettings } from '@/features/settings/backupAccount';
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

async function device(userId: string, deviceId: string): Promise<Device> {
  const token = makeJwt({ sub: userId });
  const client = createClient(emu.url, makeJwt({ role: 'anon' }), {
    global: { fetch: emu.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });
  return openDevice(null, deviceId, { userId, transport: createSupabaseTransport(client), seed: true });
}

const rowsOf = (userId: string, table: 'wallets' | 'categories' | 'transactions' | 'settings') =>
  pg.adminRows(table).then((r) => r.filter((x) => x['user_id'] === userId));

describe('копия другого аккаунта в новый аккаунт — на настоящей схеме', () => {
  it('Боб загружает копию Алисы (её данные на сервере остаются): записи Боба доходят до сервера, а не уходят в карантин; строки Алисы не тронуты', async () => {
    const [alice, bob] = [makeUserId(), makeUserId()];
    const a = await device(alice, 'dev-a');
    await a.engine.syncNow();
    const w = (await a.store.db.wallets.toArray())[0]!;
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 12_34, occurredOn: '2026-10-05', note: 'алисина-покупка' });
    await a.engine.syncNow();
    const aliceBefore = JSON.stringify(await rowsOf(alice, 'transactions'));
    const backup = JSON.stringify(await exportBackup(a.store));

    const b = await device(bob, 'dev-b');
    await b.engine.syncNow();
    const result = await importBackup(b.store, withoutSettings(JSON.parse(backup)));
    expect(result.added).toBeGreaterThan(0);
    await b.engine.syncNow();

    const st = b.engine.getStatus();
    const bobTx = await rowsOf(bob, 'transactions');
    // Алисины строки на месте и не изменились
    expect(JSON.stringify(await rowsOf(alice, 'transactions'))).toBe(aliceBefore);
    expect(
      { phase: st.phase, quarantined: st.quarantined, pending: st.pending, bobTxOnServer: bobTx.length },
      'импортированные записи Боба не дошли до сервера (id совпали с чужими строками)',
    ).toEqual({ phase: 'idle', quarantined: 0, pending: 0, bobTxOnServer: 1 });
  }, 60_000);

  it('копию из локального режима загружают в один аккаунт, потом ту же копию — во второй (члены семьи, старый и новый аккаунт): у второго записи тоже доходят до сервера', async () => {
    const [u1, u2] = [makeUserId(), makeUserId()];
    // локальный режим: отдельный пользователь устройства, без облака
    const local = await openStore(LOCAL_USER_ID, { deviceId: 'phone', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
    await ensureSeeded(local);
    const w = (await local.db.wallets.toArray())[0]!;
    await local.transactions.create({ kind: 'income', walletId: w.id, amountMinor: 500_00, occurredOn: '2026-10-05', note: 'из-локального-режима' });
    const backup = JSON.stringify(await exportBackup(local));
    local.close();

    const first = await device(u1, 'dev-1');
    await first.engine.syncNow();
    await importBackup(first.store, withoutSettings(JSON.parse(backup)));
    await first.engine.syncNow();
    expect(first.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 }); // первому аккаунту — можно

    const second = await device(u2, 'dev-2');
    await second.engine.syncNow();
    await importBackup(second.store, withoutSettings(JSON.parse(backup)));
    await second.engine.syncNow();
    expect(second.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect((await rowsOf(u2, 'transactions')).map((r) => r['note'])).toEqual(['из-локального-режима']);
  }, 60_000);
  it('чужую копию грузят в тот же аккаунт дважды (и на двух его устройствах): ничего не двоится, ссылки операций целы', async () => {
    const [alice, bob] = [makeUserId(), makeUserId()];
    const a = await device(alice, 'dev-a');
    await a.engine.syncNow();
    const w = (await a.store.db.wallets.toArray())[0]!;
    const cat = (await a.store.db.categories.toArray())[0]!;
    const income = await a.store.transactions.create({ kind: 'income', walletId: w.id, amountMinor: 900_00, occurredOn: '2026-10-05', note: 'зарплата' });
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 50_00, categoryId: cat.id, occurredOn: '2026-10-06', note: 'с-категорией' });
    await a.engine.syncNow();
    const backup = JSON.stringify(await exportBackup(a.store));

    const phone = await device(bob, 'bob-phone');
    const laptop = await device(bob, 'bob-laptop');
    await phone.engine.syncNow();
    await laptop.engine.syncNow();
    const first = await importBackup(phone.store, withoutSettings(JSON.parse(backup)));
    const again = await importBackup(phone.store, withoutSettings(JSON.parse(backup)));
    expect(first.added).toBeGreaterThan(0);
    expect(again).toMatchObject({ added: 0, replaced: 0 });
    await importBackup(laptop.store, withoutSettings(JSON.parse(backup))); // тот же файл на втором устройстве Боба
    for (let i = 0; i < 2; i++) {
      await phone.engine.syncNow();
      await laptop.engine.syncNow();
    }

    for (const d of [phone, laptop]) expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    const tx = await rowsOf(bob, 'transactions');
    expect(tx.map((r) => r['note']).sort()).toEqual(['зарплата', 'с-категорией']);
    // ссылки переписаны: операция с категорией указывает на категорию Боба, а не Алисы
    const bobCats = new Set((await rowsOf(bob, 'categories')).map((r) => r['id']));
    expect(bobCats.has(tx.find((r) => r['note'] === 'с-категорией')!['category_id'])).toBe(true);
    expect(tx.some((r) => r['id'] === income.id)).toBe(false); // id Алисы у Боба не появился
    expect((await rowsOf(bob, 'wallets')).length).toBe(2); // свой «Наличные» и «Наличные» из копии
  }, 60_000);
});
