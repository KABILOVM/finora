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
 * Новое приложение с процентами по долгам против облака, где раздел 14 схемы (колонки debts.interest_minor, interest_rate_bp,
 * term_months) ещё не выполнен. Сервер здесь — текущая схема без этих колонок (так выглядит база до повторного запуска
 * schema.sql). Долги без процентов обязаны ехать как раньше, а долг с процентами — ждать на устройстве и не терять проценты.
 */
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  await pg.db.exec('alter table public.debts drop column interest_minor, drop column interest_rate_bp, drop column term_months');
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

const bank = { direction: 'borrowed', counterparty: 'Банк', currency: 'TJS', openedOn: '2026-10-20' } as const;

describe('новое приложение, а в облаке нет колонок процентов по долгам', () => {
  it('долг без процентов доезжает; долг с процентами ждёт схему, не теряется и не уходит в карантин; после схемы проценты в облаке и на втором устройстве', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);

    // обычный долг (проценты пустые) уходит на старый сервер без колонок
    const plain = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-20' });
    await a.engine.syncNow();
    const debtsOnServer = async () => await pg.adminRows('debts');
    expect((await debtsOnServer()).map((r) => r['id'])).toContain(plain.id);
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });

    // кредит с процентами: сервер хранить их не может — правка ждёт, а не теряется, и не уходит в карантин
    const credit = await a.store.debts.create({ ...bank, principalMinor: 1_000_000, interestMinor: 134_715, interestRateBp: 2400, termMonths: 12 });
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect((await debtsOnServer()).map((r) => r['id'])).not.toContain(credit.id);
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus().pending).toBeGreaterThan(0);
    expect(await a.store.db.debts.get(credit.id)).toMatchObject({ interestMinor: 134_715, interestRateBp: 2400, termMonths: 12, dirty: 1 }); // на устройстве цел
    // статус говорит, что делать (а не «сервер временно недоступен»)
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', lastError: expect.stringMatching(/schema\.sql.*раздел 14/) });

    // остальное не страдает: операция по обычному долгу и новый долг без процентов доезжают
    const cash = (await a.store.db.wallets.toArray())[0]!;
    await a.store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-10-21', debtId: plain.id });
    const second = await a.store.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 1_000, currency: 'TJS', openedOn: '2026-10-21' });
    await a.engine.syncNow();
    expect((await debtsOnServer()).map((r) => r['id'])).toContain(second.id);
    expect((await pg.adminRows('transactions')).map((r) => r['debt_id'])).toContain(plain.id);

    // операция по кредиту с процентами ждёт вместе со своим долгом (внешний ключ), а не падает в карантин
    await a.store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 1_000_000, occurredOn: '2026-10-20', debtId: credit.id });
    await a.engine.syncNow();
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect((await pg.adminRows('transactions')).map((r) => r['debt_id'])).not.toContain(credit.id);

    // облако обновили (schema.sql выполнен заново): кредит и его операция доезжают целиком
    await pg.applySchema();
    emu.reloadSchema(); // PostgREST после DDL перечитывает схему
    for (let i = 0; i < 3; i++) await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    const onServer = (await debtsOnServer()).find((r) => r['id'] === credit.id);
    expect(onServer).toMatchObject({ principal_minor: 1_000_000, interest_minor: 134_715, interest_rate_bp: 2400, term_months: 12 });
    expect((await pg.adminRows('transactions')).map((r) => r['debt_id'])).toContain(credit.id);

    // второе устройство получает проценты вместе с остальным
    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) {
      await b.engine.syncNow();
      await a.engine.syncNow();
    }
    expect(await b.store.db.debts.get(credit.id)).toMatchObject({ principalMinor: 1_000_000, interestMinor: 134_715, interestRateBp: 2400, termMonths: 12 });
    expect(await b.store.db.debts.get(plain.id)).toMatchObject({ interestMinor: null, interestRateBp: null, termMonths: null });
  }, 90_000);
});
