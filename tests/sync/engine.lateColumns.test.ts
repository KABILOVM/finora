import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { dbNameFor } from '@/db/database';
import { stringifyWeather } from '@/domain/weatherPlaces';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { SYNC_TABLES, fromWire } from '@/sync/tables';
import { USER, openDevice, spy, type Device } from './engineHarness';

/**
 * Обновление приложения на устройстве, которое успело получить кошельки и настройки прежней версией — ещё без целей накопления и
 * без городов для погоды. Прежняя версия отбрасывала незнакомые колонки, но запоминала серверную версию строки и курсор. Версия
 * базы 6 забирает обе таблицы заново: цель и города появляются, а правка (переименование, неделя) не стирает их на сервере.
 */

const PLACES = stringifyWeather({
  selected: '38.56,68.77',
  cities: [{ id: '38.56,68.77', name: 'Душанбе', region: '', lat: 38.56, lon: 68.77 }],
});
const GOAL = { goalMinor: 5_000_000, goalOn: '2027-06-01' };

/** Схема базы версии 3 (до целей и погоды), как в src/db/database.ts. */
const STORES_V3 = {
  settings: 'id, dirty, [dirty+clientUpdatedAt]',
  wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
  categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
  transactions:
    'id, dirty, occurredOn, walletId, toWalletId, categoryId, debtId, recurringRuleId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
  debts: 'id, dirty, direction, closedAt, archivedAt, [dirty+clientUpdatedAt]',
  budgets: 'id, dirty, categoryId, [dirty+clientUpdatedAt]',
  recurring_rules: 'id, dirty, startOn, archivedAt, [dirty+clientUpdatedAt]',
  shopping_items: 'id, dirty, purchasedAt, transactionId, [dirty+clientUpdatedAt]',
  meta: 'key',
};

/** Устройство A с целью у кошелька-накопления и выбранным городом; всё уже в облаке. */
async function cloudWithGoalAndWeather(server: MemoryServer): Promise<{ a: Device; goalId: string }> {
  const a = await openDevice(server, 'dev-a', { seed: true });
  await a.engine.syncNow();
  const goal = await a.store.wallets.create({ name: 'На машину', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#16a34a', icon: '🚗', ...GOAL });
  await a.store.settings.update({ weather: PLACES });
  await a.engine.syncNow();
  expect(server.dump(USER, 'wallets').find((r) => r['id'] === goal.id)).toMatchObject({ goal_minor: GOAL.goalMinor });
  return { a, goalId: goal.id };
}

/**
 * База устройства B, как её оставила прежняя версия (база версии 3): всё с сервера получено, курсоры в конце, но у кошельков нет
 * полей цели, а у настроек — городов (незнакомые колонки отброшены при получении).
 */
async function oldDeviceDb(server: MemoryServer): Promise<IDBFactory> {
  const factory = new IDBFactory();
  const old = new Dexie(dbNameFor(USER), { indexedDB: factory, IDBKeyRange });
  old.version(3).stores(STORES_V3);
  await old.open();
  for (const table of SYNC_TABLES) {
    if (!(table in STORES_V3)) continue; // таблицы, появившиеся позже (цели накопления), в базе версии 3 нет
    const rows = server.dump(USER, table);
    const local = rows.map((w) => {
      const { entity, serverSeq } = fromWire(table, w);
      const { goalMinor: _g, goalOn: _o, weather: _w, ...known } = entity as unknown as Record<string, unknown>;
      void [_g, _o, _w];
      return { ...known, dirty: 0, serverSeq, syncError: null };
    });
    await old.table(table).bulkAdd(local);
    const last = rows.reduce((m, r) => Math.max(m, r.server_seq), 0);
    if (last > 0) await old.table('meta').put({ key: `cursor:${table}`, value: last });
  }
  await old.table('meta').put({ key: 'initialPullDone', value: true });
  old.close();
  return factory;
}

describe('обновление приложения после получения строк прежней версией (без цели и городов)', () => {
  it('после обновления цель и города приходят заново; переименование и смена недели не стирают их на сервере и у других', async () => {
    const server = createMemoryServer();
    const { a, goalId } = await cloudWithGoalAndWeather(server);
    const b = await openDevice(server, 'dev-b', { factory: await oldDeviceDb(server) });
    expect(await b.store.db.wallets.get(goalId)).toMatchObject({ goalMinor: null, serverSeq: 0 }); // до получения цели не видно

    await b.engine.syncNow();
    expect(await b.store.db.wallets.get(goalId)).toMatchObject({ ...GOAL, dirty: 0 });
    expect(await b.store.settings.get()).toMatchObject({ weather: PLACES, dirty: 0 });

    await b.store.wallets.update(goalId, { name: 'Отпуск' });
    await b.store.settings.update({ weekStartsOn: 0 });
    await b.engine.syncNow();
    expect(b.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(server.dump(USER, 'wallets').find((r) => r['id'] === goalId)).toMatchObject({ name: 'Отпуск', goal_minor: GOAL.goalMinor, goal_on: GOAL.goalOn });
    expect(server.dump(USER, 'settings')[0]).toMatchObject({ week_starts_on: 0, weather: PLACES });

    await a.engine.syncNow();
    expect(await a.store.db.wallets.get(goalId)).toMatchObject({ name: 'Отпуск', ...GOAL });
    expect(await a.store.settings.get()).toMatchObject({ weekStartsOn: 0, weather: PLACES });
  });

  it('вкладка со старым кодом записала курсор поверх сброса: метка всё равно забирает таблицы с нуля, синхронизация не зацикливается', async () => {
    const server = createMemoryServer();
    const { goalId } = await cloudWithGoalAndWeather(server);
    const b = await openDevice(server, 'dev-b', { factory: await oldDeviceDb(server) });
    // старая вкладка (обновления ждут кнопки) дописала курсоры в конец таблиц уже после обновления базы
    const last = (t: string) => server.dump(USER, t as never).reduce((m, r) => Math.max(m, r.server_seq), 0);
    await b.store.db.meta.bulkPut(['wallets', 'settings', 'transactions'].map((t) => ({ key: `cursor:${t}`, value: last(t) })));
    expect(await b.store.sync.needsResync('wallets')).toBe(true);

    await b.store.wallets.update(goalId, { name: 'Отпуск' });
    await b.engine.syncNow();
    expect(b.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(server.dump(USER, 'wallets').find((r) => r['id'] === goalId)).toMatchObject({ name: 'Отпуск', goal_minor: GOAL.goalMinor, goal_on: GOAL.goalOn });
    expect(await b.store.db.wallets.get(goalId)).toMatchObject({ name: 'Отпуск', ...GOAL, dirty: 0 });
    expect(await b.store.settings.get()).toMatchObject({ weather: PLACES });
    // полный проход прошёл — метки сняты, дальше получение снова идёт от курса
    for (const t of ['wallets', 'settings', 'transactions'] as const) expect(await b.store.sync.needsResync(t), t).toBe(false);
  });

  it('правка до первой синхронизации, и отправка ушла раньше получения (base_seq 0): конфликт, слияние — цель и города целы', async () => {
    const server = createMemoryServer();
    const { goalId } = await cloudWithGoalAndWeather(server);
    let sp!: ReturnType<typeof spy>;
    const b = await openDevice(server, 'dev-b', { factory: await oldDeviceDb(server), wrap: (inner) => (sp = spy(inner)).transport });
    // правки сделаны сразу после обновления, без сети: цели и городов на устройстве ещё нет
    await b.store.wallets.update(goalId, { name: 'Отпуск' });
    await b.store.settings.update({ weekStartsOn: 0 });
    // первое получение «не успело» (пусто): отправка уходит с base_seq 0 — «строка на сервере есть, но версия неизвестна»
    const hidden = new Set<string>(['wallets', 'settings']);
    const bases = new Map<unknown, unknown[]>();
    sp.onPull = (table, _after, rows) => (hidden.has(table) ? [] : rows);
    sp.onPush = (table, rows) => {
      hidden.delete(table);
      for (const r of rows) bases.set(r['id'], [...(bases.get(r['id']) ?? []), r['base_seq']]);
    };

    await b.engine.syncNow();
    // первая отправка: сервер отверг её (версия неизвестна), правка слилась с серверной и ушла снова
    for (const id of [goalId, USER]) {
      expect(bases.get(id)?.[0], id).toBe(0);
      expect(bases.get(id)?.length, id).toBeGreaterThan(1);
    }
    expect(b.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(server.dump(USER, 'wallets').find((r) => r['id'] === goalId)).toMatchObject({ name: 'Отпуск', goal_minor: GOAL.goalMinor, goal_on: GOAL.goalOn });
    expect(server.dump(USER, 'settings')[0]).toMatchObject({ week_starts_on: 0, weather: PLACES });
    expect(await b.store.db.wallets.get(goalId)).toMatchObject({ name: 'Отпуск', ...GOAL, dirty: 0 });
    expect(await b.store.settings.get()).toMatchObject({ weekStartsOn: 0, weather: PLACES });
  });
});
