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
 * Новое приложение («ежедневные» категории и дневной лимит) против облака, где раздел 20 схемы ещё не выполнен: у categories нет колонок
 * daily и daily_limit_minor. Категории без отметки едут как раньше, а категория с отметкой или лимитом ждёт на устройстве, не теряется и не
 * уходит в карантин. После schema.sql всё доезжает целиком, в том числе на второе устройство.
 */
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  await pg.db.exec('alter table public.categories drop column daily_limit_minor');
  await pg.db.exec('alter table public.categories drop column daily');
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

const look = { color: '#f97316', icon: '🍽️' } as const;

describe('новое приложение, а в облаке нет колонок daily и daily_limit_minor', () => {
  it('обычные категории доезжают, «ежедневные» ждут схему и не теряются; после schema.sql доезжают целиком, и на второе устройство', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ quarantined: 0, phase: 'idle' });
    const serverIds = async () => (await pg.adminRows('categories')).map((r) => r['id']);
    expect((await serverIds()).length).toBeGreaterThan(0); // стартовые категории (без отметки) уехали как раньше

    const plain = await a.store.categories.create({ name: 'Подарки', kind: 'expense', ...look });
    const food = await a.store.categories.create({ name: 'Еда вне дома', kind: 'expense', ...look, daily: true, dailyLimitMinor: 4000 });
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(await serverIds()).toContain(plain.id);
    expect(await serverIds()).not.toContain(food.id); // хранить отметку старому серверу негде: ждёт
    expect(await a.store.db.categories.get(food.id)).toMatchObject({ daily: 1, dailyLimitMinor: 4000, dirty: 1 }); // на устройстве цела
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', lastError: expect.stringMatching(/schema\.sql.*раздел 20/) });

    // облако обновили (schema.sql выполнен заново): отметка и лимит доезжают целиком
    await pg.applySchema();
    emu.reloadSchema();
    for (let i = 0; i < 4; i++) await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    const rows = await pg.adminRows('categories');
    expect(rows.find((r) => r['id'] === food.id)).toMatchObject({ daily: 1, daily_limit_minor: 4000 });
    expect(rows.find((r) => r['id'] === plain.id)).toMatchObject({ daily: 0, daily_limit_minor: null });

    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) {
      await b.engine.syncNow();
      await a.engine.syncNow();
    }
    expect(await b.store.db.categories.get(food.id)).toMatchObject({ daily: 1, dailyLimitMinor: 4000 });
    expect(await b.store.db.categories.get(plain.id)).toMatchObject({ daily: 0, dailyLimitMinor: null });
  }, 90_000);
});
