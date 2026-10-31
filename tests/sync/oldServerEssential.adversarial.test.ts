// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSeeded } from '@/db';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from './factories';
import { openDevice, type Device } from './engineHarness';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

/**
 * Новое приложение («обязательные» категории, категории долгов) против облака, где разделы 16 и 17 схемы ещё не выполнены:
 * у categories нет колонки essential, у debts — category. Категории без отметки и долги без категории едут как раньше, а правки с
 * настоящим значением ждут на устройстве, не теряются и не уходят в карантин. После schema.sql всё доезжает целиком.
 */
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  await pg.db.exec('alter table public.categories drop column essential');
  await pg.db.exec('alter table public.debts drop column category');
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

describe('новое приложение, а в облаке нет колонок essential и category', () => {
  it('обычные категории и долги доезжают (значения по умолчанию), а с настоящим значением ждут схему; после schema.sql доезжают целиком и на второе устройство', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);
    await a.engine.syncNow();
    // сид помечает «Жильё», «Связь» и «Долги» обязательными — старому серверу такое хранить негде: они ждут, остальное едет
    const waiting = (await a.store.db.categories.toArray()).filter((c) => c.essential === 1);
    expect(waiting.length).toBeGreaterThan(0);
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', lastError: expect.stringMatching(/schema\.sql.*раздел 16/) });
    const cats = await pg.adminRows('categories');
    expect(cats.length).toBeGreaterThan(0);
    for (const w of waiting) expect(cats.map((r) => r['id'])).not.toContain(w.id);

    const plain = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-20' });
    const tagged = await a.store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 90_000, currency: 'TJS', openedOn: '2026-10-21', category: 'Кредит' });
    await a.engine.syncNow();
    await a.engine.syncNow();
    const debtsOnServer = async () => await pg.adminRows('debts');
    expect((await debtsOnServer()).map((r) => r['id'])).toContain(plain.id);
    expect((await debtsOnServer()).map((r) => r['id'])).not.toContain(tagged.id);
    expect(await a.store.db.debts.get(tagged.id)).toMatchObject({ category: 'Кредит', dirty: 1 }); // на устройстве цела
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', lastError: expect.stringMatching(/schema\.sql.*раздел 17/) });

    // облако обновили (schema.sql выполнен заново): значения доезжают целиком
    await pg.applySchema();
    emu.reloadSchema();
    for (let i = 0; i < 4; i++) await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    expect((await debtsOnServer()).find((r) => r['id'] === tagged.id)).toMatchObject({ category: 'Кредит' });
    expect((await debtsOnServer()).find((r) => r['id'] === plain.id)).toMatchObject({ category: '' });
    const essentialOnServer = (await pg.adminRows('categories')).filter((r) => r['essential'] === 1 || r['essential'] === '1');
    expect(essentialOnServer.map((r) => r['id']).sort()).toEqual(waiting.map((c) => c.id).sort());

    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) {
      await b.engine.syncNow();
      await a.engine.syncNow();
    }
    expect(await b.store.db.debts.get(tagged.id)).toMatchObject({ category: 'Кредит' });
    for (const w of waiting) expect(await b.store.db.categories.get(w.id)).toMatchObject({ essential: 1 });
  }, 90_000);
});
