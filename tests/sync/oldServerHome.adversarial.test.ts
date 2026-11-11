// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSeeded } from '@/db';
import { stringifyHome } from '@/domain/homeLayout';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from './factories';
import { openDevice, type Device } from './engineHarness';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

/**
 * Новое приложение с раскладкой «Главной» против облака, где раздел 21 схемы (колонка settings.home) ещё не выполнен.
 * Сервер здесь — текущая схема без этой колонки (так выглядит база до повторного запуска schema.sql). Настройки отправляются
 * ПЕРВЫМИ из таблиц и уходят при любой правке (валюта, неделя), поэтому без страховки одна ошибка «нет колонки» остановила бы
 * синхронизацию, включая операции.
 */
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  await pg.db.exec('alter table public.settings drop column home');
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

const LAYOUT = stringifyHome([{ id: 'hero' }, { id: 'recent' }, { id: 'rates', off: true }, { id: 'weather', off: true }, { id: 'debts', size: 'half' }]);

describe('новое приложение, а в облаке нет колонки home', () => {
  it('настройки без раскладки доезжают (синхронизация не встаёт); раскладка ждёт схему, не теряется и не уходит в карантин; после обновления схемы доезжает', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);
    await a.engine.syncNow();

    // настройки без раскладки (затравка) и обычная правка настроек дошли до старого сервера
    const settingsOnServer = async () => (await pg.adminRows('settings')).find((r) => r['id'] === u);
    expect(await settingsOnServer()).toBeTruthy();
    await a.store.settings.update({ weekStartsOn: 0 });
    await a.engine.syncNow();
    expect((await settingsOnServer())?.['week_starts_on']).toBe(0);
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });

    // своя раскладка: сервер хранить её не может — правка ждёт, а не теряется, и не уходит в карантин
    await a.store.settings.update({ home: LAYOUT });
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus().pending).toBeGreaterThan(0);
    expect((await a.store.settings.get())?.home).toBe(LAYOUT); // на устройстве раскладка цела
    // статус говорит, что делать (а не «сервер временно недоступен»)
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', lastError: expect.stringMatching(/schema\.sql.*раздел 21/) });

    // ждут только настройки: операция, записанная ПОСЛЕ правки раскладки, доезжает, и чужие правки приходят
    const cash = (await a.store.db.wallets.toArray())[0]!;
    await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5000, occurredOn: '2026-10-17', note: 'после раскладки' });
    await a.engine.syncNow();
    const notes = async () => (await pg.adminRows('transactions')).map((r) => r['note']);
    expect(await notes()).toContain('после раскладки');
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', pending: 1, quarantined: 0 });
    const c = await device(u, 'dev-c');
    await c.engine.syncNow();
    await c.store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 700, occurredOn: '2026-10-17', note: 'с другого устройства' });
    await c.engine.syncNow();
    expect(await notes()).toContain('с другого устройства');
    await a.engine.syncNow();
    expect((await a.store.db.transactions.toArray()).map((t) => t.note)).toContain('с другого устройства');
    expect((await a.store.settings.get())?.home).toBe(LAYOUT); // чужие настройки (без раскладки) её не затёрли

    // облако обновили (schema.sql выполнен заново): раскладка доезжает целиком
    await pg.applySchema();
    emu.reloadSchema(); // PostgREST после DDL перечитывает схему
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    expect((await settingsOnServer())?.['home']).toBe(LAYOUT);

    // второе устройство получает раскладку вместе с остальными настройками
    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) {
      await b.engine.syncNow();
      await a.engine.syncNow();
    }
    expect(await b.store.settings.get()).toMatchObject({ home: LAYOUT, weekStartsOn: 0 });
  }, 90_000);
});
