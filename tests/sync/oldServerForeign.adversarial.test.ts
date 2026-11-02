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
 * Новое приложение («сумма в валюте» у операций) против облака, где раздел 19 схемы ещё не выполнен: у transactions нет колонок
 * foreign_currency и foreign_amount_minor. Обычные операции едут как раньше, а операция с настоящей суммой в валюте ждёт на устройстве,
 * не теряется и не уходит в карантин. После schema.sql она доезжает целиком, в том числе на второе устройство.
 */
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  await pg.db.exec('alter table public.transactions drop column foreign_currency');
  await pg.db.exec('alter table public.transactions drop column foreign_amount_minor');
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

describe('новое приложение, а в облаке нет колонок foreign_currency и foreign_amount_minor', () => {
  it('обычные операции доезжают, операция с суммой в валюте ждёт схему; после schema.sql доезжает целиком и на второе устройство', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);
    const cash = (await a.store.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
    const plain = await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1200, occurredOn: '2026-10-20', note: 'плов' });
    const card = await a.store.transactions.create({
      kind: 'expense',
      walletId: cash.id,
      amountMinor: 13_500,
      occurredOn: '2026-10-21',
      note: 'кафе',
      foreignCurrency: 'AED',
      foreignAmountMinor: 5000,
    });
    await a.engine.syncNow();
    await a.engine.syncNow();

    const onServer = async () => (await pg.adminRows('transactions')).map((r) => r['id']);
    expect(await onServer()).toContain(plain.id);
    expect(await onServer()).not.toContain(card.id);
    expect(await a.store.db.transactions.get(card.id)).toMatchObject({ foreignCurrency: 'AED', foreignAmountMinor: 5000, dirty: 1 }); // на устройстве цела
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', lastError: expect.stringMatching(/schema\.sql.*раздел 19/) });

    // облако обновили (schema.sql выполнен заново): значение доезжает целиком
    await pg.applySchema();
    emu.reloadSchema();
    for (let i = 0; i < 4; i++) await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    const rows = await pg.adminRows('transactions');
    expect(rows.find((r) => r['id'] === card.id)).toMatchObject({ foreign_currency: 'AED', foreign_amount_minor: 5000 });
    expect(rows.find((r) => r['id'] === plain.id)).toMatchObject({ foreign_currency: null, foreign_amount_minor: null });

    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) {
      await b.engine.syncNow();
      await a.engine.syncNow();
    }
    expect(await b.store.db.transactions.get(card.id)).toMatchObject({ foreignCurrency: 'AED', foreignAmountMinor: 5000 });
  }, 90_000);
});
