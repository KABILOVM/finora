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
 * Новое приложение с объединением долгов против облака, где раздел 15 схемы (колонка debts.merged_into_id) ещё не выполнен.
 * Сервер здесь — текущая схема без этой колонки (так выглядит база до повторного запуска schema.sql). Долги без объединения обязаны
 * ехать как раньше, а объединённые — ждать на устройстве, не теряя связь, и не уходить в карантин.
 */
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  await pg.db.exec('alter table public.debts drop column merged_into_id'); // вместе с ограничениями на неё
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

const bank = { direction: 'borrowed', currency: 'TJS' } as const;

describe('новое приложение, а в облаке нет колонки объединения долгов', () => {
  it('долги без объединения доезжают; объединённые ждут схему, не теряют связь и не уходят в карантин; после схемы связь в облаке и на втором устройстве', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);

    // обычный долг (не объединён) уходит на старый сервер без колонки
    const plain = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-20' });
    await a.engine.syncNow();
    const debtsOnServer = async () => await pg.adminRows('debts');
    expect((await debtsOnServer()).map((r) => r['id'])).toContain(plain.id);
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });

    // два кредита объединены: у каждого свои проценты и срок; связь сервер хранить не может — правка ждёт, а не теряется
    const first = await a.store.debts.create({ ...bank, counterparty: 'Банк', principalMinor: 1_000_000, interestMinor: 134_715, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-01' });
    const second = await a.store.debts.create({ ...bank, counterparty: 'Банк', principalMinor: 500_000, interestMinor: 30_000, interestRateBp: 1200, termMonths: 6, openedOn: '2026-10-10' });
    await a.engine.syncNow();
    await a.store.debts.merge(first.id, [second.id]);
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(await a.store.db.debts.get(second.id)).toMatchObject({ mergedIntoId: first.id, interestMinor: 30_000, interestRateBp: 1200, termMonths: 6, dirty: 1 }); // на устройстве цела
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', lastError: expect.stringMatching(/schema\.sql.*раздел 15/) });
    expect((await debtsOnServer()).find((r) => r['id'] === second.id)?.['principal_minor'] ?? null).not.toBe(500_000 + 1); // сервер без колонки не получил связь

    // остальное не страдает: операция по обычному долгу и новый долг без объединения доезжают
    const cash = (await a.store.db.wallets.toArray())[0]!;
    await a.store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-10-21', debtId: plain.id });
    const other = await a.store.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 1_000, currency: 'TJS', openedOn: '2026-10-21' });
    await a.engine.syncNow();
    expect((await debtsOnServer()).map((r) => r['id'])).toContain(other.id);
    expect((await pg.adminRows('transactions')).map((r) => r['debt_id'])).toContain(plain.id);

    // облако обновили (schema.sql выполнен заново): связь доезжает целиком
    await pg.applySchema();
    emu.reloadSchema(); // PostgREST после DDL перечитывает схему
    for (let i = 0; i < 4; i++) await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    const onServer = (await debtsOnServer()).find((r) => r['id'] === second.id);
    expect(onServer).toMatchObject({ merged_into_id: first.id, principal_minor: 500_000, interest_minor: 30_000, interest_rate_bp: 1200, term_months: 6 });

    // второе устройство получает объединение вместе с остальным, и проценты каждой части свои
    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) {
      await b.engine.syncNow();
      await a.engine.syncNow();
    }
    expect(await b.store.db.debts.get(second.id)).toMatchObject({ mergedIntoId: first.id, interestMinor: 30_000, interestRateBp: 1200, termMonths: 6 });
    expect(await b.store.db.debts.get(first.id)).toMatchObject({ mergedIntoId: null, interestMinor: 134_715, interestRateBp: 2400, termMonths: 12 });
    expect(await b.store.db.debts.get(plain.id)).toMatchObject({ mergedIntoId: null });
  }, 90_000);
});
