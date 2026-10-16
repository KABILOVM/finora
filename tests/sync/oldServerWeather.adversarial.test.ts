// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSeeded } from '@/db';
import { stringifyWeather } from '@/domain/weatherPlaces';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from './factories';
import { openDevice, type Device } from './engineHarness';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

/**
 * Новое приложение с городами для погоды против облака, где раздел 13 схемы (колонка settings.weather) ещё не выполнен.
 * Сервер здесь — текущая схема без этой колонки (так выглядит база до повторного запуска schema.sql). Настройки отправляются
 * ПЕРВЫМИ из таблиц и уходят при любой правке (валюта, неделя), поэтому без страховки одна ошибка «нет колонки» остановила бы всю
 * синхронизацию, включая операции.
 */
let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  await pg.db.exec('alter table public.settings drop column weather');
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

const PLACES = stringifyWeather({
  selected: '37.50,70.25',
  cities: [{ id: '37.50,70.25', name: 'Моё местоположение', region: '', lat: 37.5, lon: 70.25, here: true }],
});

describe('новое приложение, а в облаке нет колонки weather', () => {
  it('настройки без городов доезжают (синхронизация не встаёт); выбор города ждёт схему, не теряется и не уходит в карантин; после схемы он в облаке и на втором устройстве', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await ensureSeeded(a.store);
    await a.engine.syncNow();

    // настройки без городов (затравка) и обычная правка настроек дошли до старого сервера
    const settingsOnServer = async () => (await pg.adminRows('settings')).find((r) => r['id'] === u);
    expect(await settingsOnServer()).toBeTruthy();
    await a.store.settings.update({ weekStartsOn: 0 });
    await a.engine.syncNow();
    expect((await settingsOnServer())?.['week_starts_on']).toBe(0);
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });

    // выбор города: сервер хранить его не может — правка ждёт, а не теряется, и не уходит в карантин
    await a.store.settings.update({ weather: PLACES });
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(a.engine.getStatus().quarantined).toBe(0);
    expect(a.engine.getStatus().pending).toBeGreaterThan(0);
    expect((await a.store.settings.get())?.weather).toBe(PLACES); // на устройстве выбор цел

    // облако обновили (schema.sql выполнен заново): выбор доезжает целиком
    await pg.applySchema();
    emu.reloadSchema(); // PostgREST после DDL перечитывает схему
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0, phase: 'idle' });
    expect((await settingsOnServer())?.['weather']).toBe(PLACES);

    // второе устройство получает выбор вместе с остальными настройками
    const b = await device(u, 'dev-b');
    for (let i = 0; i < 3; i++) {
      await b.engine.syncNow();
      await a.engine.syncNow();
    }
    expect(await b.store.settings.get()).toMatchObject({ weather: PLACES, weekStartsOn: 0 });
  }, 90_000);
});
