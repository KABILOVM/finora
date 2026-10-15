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
 * Новое приложение с целями накопления против облака, где раздел 11 схемы (колонки goal_minor / goal_on) ещё не выполнен.
 * Сервер здесь — текущая схема, у которой колонки цели убраны (так выглядит база до повторного запуска schema.sql), поверх
 * PostgREST-эмулятора и настоящего supabase-js. Схема этапа 1 для этого не годится: без таблиц долгов и бюджетов цикл
 * синхронизации останавливается раньше, чем дойдёт до кошельков.
 */
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  await pg.db.exec('alter table public.wallets drop column goal_minor, drop column goal_on');
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

describe('новое приложение, а в облаке нет колонок цели накопления', () => {
  it('кошельки без цели доезжают (синхронизация не встаёт); кошелёк с целью ждёт схему, не теряется и не уходит в карантин; после схемы цель в облаке', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);
    await a.engine.syncNow();

    // кошелёк без цели (затравка) дошёл до старого сервера
    const walletIds = async () => (await pg.adminRows('wallets')).map((r) => r['id']);
    const cash = (await a.store.db.wallets.toArray())[0]!;
    expect(await walletIds()).toContain(cash.id);

    // обычная работа продолжается: операция тоже доезжает
    await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1234, occurredOn: '2026-10-05', note: 'до обновления схемы' });
    await a.engine.syncNow();
    expect((await pg.adminRows('transactions')).some((r) => r['note'] === 'до обновления схемы')).toBe(true);

    // кошелёк с целью: сервер не может её хранить — правка ждёт, а не теряется
    const goalWallet = await a.store.wallets.create({
      name: 'На машину',
      currency: 'TJS',
      kind: 'savings',
      openingBalanceMinor: 0,
      color: '#16a34a',
      icon: '🚗',
      goalMinor: 5_000_000,
      goalOn: '2027-06-01',
    });
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus().pending).toBeGreaterThan(0);
    expect(await walletIds()).not.toContain(goalWallet.id);
    expect((await a.store.db.wallets.get(goalWallet.id))?.goalMinor).toBe(5_000_000); // на устройстве цель цела

    // облако обновили (schema.sql выполнен заново): цель доезжает целиком
    await pg.applySchema();
    emu.reloadSchema(); // PostgREST после DDL перечитывает схему
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    const onServer = (await pg.adminRows('wallets')).find((r) => r['id'] === goalWallet.id)!;
    expect(onServer['goal_minor']).toBe(5_000_000);
    expect(String(onServer['goal_on'])).toContain('2027-06-01');

    // второе устройство получает кошелёк вместе с целью
    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) {
      await b.engine.syncNow();
      await a.engine.syncNow();
    }
    const copy = await b.store.db.wallets.get(goalWallet.id);
    expect(copy).toMatchObject({ goalMinor: 5_000_000, goalOn: '2027-06-01', kind: 'savings' });
  }, 90_000);
});
