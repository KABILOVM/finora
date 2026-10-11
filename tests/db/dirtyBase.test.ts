import { describe, expect, it } from 'vitest';
import type { Wallet } from '@/domain/types';
import { snapshotRow } from '@/db/syncMerge';
import { basics, makeStore, remoteWallet } from './helpers';

/**
 * dirtyBase — снимок серверной версии, поверх которой сделаны неотправленные правки. Кладёт его сама база (хук Dexie в database.ts)
 * в момент, когда «чистая» строка (dirty 0) становится «грязной» (dirty 1), — репозитории, импорт и согласование о нём не знают.
 */

const entityOf = (w: object): Wallet => snapshotRow('wallets', w) as unknown as Wallet;
const input = { name: 'Копилка', currency: 'TJS' as const, kind: 'savings' as const, openingBalanceMinor: 0, color: '#000000', icon: 'x' };

describe('dirtyBase: когда появляется и когда исчезает', () => {
  it('у только что созданной (ещё не бывшей на сервере) строки базы нет', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(input);
    expect(await store.db.wallets.get(w.id)).not.toHaveProperty('dirtyBase');
  });

  it('первая правка «чистой» строки кладёт снимок прежней версии; следующие правки его не меняют', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(input);
    await store.sync.markPushed('wallets', [{ id: w.id, clientUpdatedAt: w.clientUpdatedAt, deviceId: w.deviceId }]);
    const clean = (await store.db.wallets.get(w.id)) as NonNullable<Awaited<ReturnType<typeof store.db.wallets.get>>>;
    expect(clean).toMatchObject({ dirty: 0 });
    expect(clean).not.toHaveProperty('dirtyBase');

    await store.wallets.update(w.id, { name: 'Копилка 2' });
    const first = await store.db.wallets.get(w.id);
    expect(first).toMatchObject({ dirty: 1, name: 'Копилка 2' });
    expect(first?.dirtyBase).toEqual(entityOf(clean)); // прежнее имя, метка и устройство — версия, которую знает сервер

    await store.wallets.update(w.id, { name: 'Копилка 3', color: '#ffffff' });
    const second = await store.db.wallets.get(w.id);
    expect(second).toMatchObject({ dirty: 1, name: 'Копилка 3' });
    expect(second?.dirtyBase).toEqual(first?.dirtyBase); // пока строка «грязная», база прежняя
  });

  it('подтверждение сервера (markPushed) снимает базу; новая правка после него кладёт свежую', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(input);
    await store.sync.markPushed('wallets', [{ id: w.id, clientUpdatedAt: w.clientUpdatedAt, deviceId: w.deviceId }]);
    const edited = await store.wallets.update(w.id, { name: 'Копилка 2' });
    expect((await store.db.wallets.get(w.id))?.dirtyBase).toBeDefined();

    await store.sync.markPushed('wallets', [{ id: w.id, clientUpdatedAt: edited.clientUpdatedAt, deviceId: edited.deviceId }]);
    const cleared = await store.db.wallets.get(w.id);
    expect(cleared).toMatchObject({ dirty: 0, name: 'Копилка 2' });
    expect(cleared).not.toHaveProperty('dirtyBase');

    await store.wallets.update(w.id, { name: 'Копилка 3' });
    expect((await store.db.wallets.get(w.id))?.dirtyBase).toMatchObject({ name: 'Копилка 2' });
  });

  it('если правка успела случиться, пока шла отправка, строка остаётся «грязной» и база не теряется', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(input);
    await store.sync.markPushed('wallets', [{ id: w.id, clientUpdatedAt: w.clientUpdatedAt, deviceId: w.deviceId }]);
    const sent = await store.wallets.update(w.id, { name: 'Копилка 2' });
    const base = (await store.db.wallets.get(w.id))?.dirtyBase;
    await store.wallets.update(w.id, { name: 'Копилка 3' }); // «в пути» была версия sent
    expect(await store.sync.markPushed('wallets', [{ id: w.id, clientUpdatedAt: sent.clientUpdatedAt, deviceId: sent.deviceId }])).toBe(0);
    expect((await store.db.wallets.get(w.id))?.dirtyBase).toEqual(base);
  });

  it('удаление и восстановление тоже «пачкают» чистую строку со снимком', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    await store.sync.markPushed('wallets', [{ id: cash.id, clientUpdatedAt: cash.clientUpdatedAt, deviceId: cash.deviceId }]);
    await store.wallets.archive(cash.id);
    expect((await store.db.wallets.get(cash.id))?.dirtyBase).toMatchObject({ archivedAt: null });
  });

  it('прямая запись «грязной» строки поверх «чистой» (put и bulkPut) тоже получает снимок — забыть про него нельзя', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [{ entity: remoteWallet({ id: 'w-a', name: 'Серверное A' }), serverSeq: 3 }, { entity: remoteWallet({ id: 'w-b', name: 'Серверное B' }), serverSeq: 4 }], 4);
    const a = (await store.db.wallets.get('w-a'))!;
    const b = (await store.db.wallets.get('w-b'))!;
    await store.db.wallets.put({ ...a, name: 'Правка A', dirty: 1 });
    await store.db.wallets.bulkPut([{ ...b, name: 'Правка B', dirty: 1 }]);
    expect((await store.db.wallets.get('w-a'))?.dirtyBase).toMatchObject({ name: 'Серверное A' });
    expect((await store.db.wallets.get('w-b'))?.dirtyBase).toMatchObject({ name: 'Серверное B' });
  });

  it('получение страницы с сервера не создаёт базу у «чистых» строк', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [{ entity: remoteWallet({ id: 'w-a' }), serverSeq: 3 }], 3);
    await store.sync.applyRemotePage('wallets', [{ entity: remoteWallet({ id: 'w-a', name: 'Новое', clientUpdatedAt: '2026-10-02T00:00:00.000Z' }), serverSeq: 4 }], 4);
    const row = await store.db.wallets.get('w-a');
    expect(row).toMatchObject({ dirty: 0, name: 'Новое', serverSeq: 4 });
    expect(row).not.toHaveProperty('dirtyBase');
  });

  it('слияние с серверной версией сдвигает базу на неё; потом подтверждение сервера снимает', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [{ entity: remoteWallet({ id: 'w-a', name: 'Серверное' }), serverSeq: 3 }], 3);
    await store.wallets.update('w-a', { name: 'Моё имя' });
    const mine = (await store.db.wallets.get('w-a'))!;
    const theirs = remoteWallet({ id: 'w-a', name: 'Серверное', color: '#abcdef', clientUpdatedAt: '2026-10-02T00:00:00.000Z', deviceId: 'dev-other' });
    const r = await store.sync.applyRemotePage('wallets', [{ entity: theirs, serverSeq: 7 }], 7);
    expect(r).toMatchObject({ merged: 1, lostLocal: 0 });
    const merged = (await store.db.wallets.get('w-a'))!;
    expect(merged).toMatchObject({ name: 'Моё имя', color: '#abcdef', dirty: 1, serverSeq: 7, deviceId: store.deviceId });
    expect(merged.clientUpdatedAt > mine.clientUpdatedAt).toBe(true);
    expect(merged.clientUpdatedAt > theirs.clientUpdatedAt).toBe(true);
    expect(merged.dirtyBase).toEqual(entityOf(theirs));
  });

  it('метки слитых правок строго растут и больше всех виденных: две слитые строки в одной странице получают разные метки', async () => {
    const store = await makeStore();
    const seeds = ['w-a', 'w-b'].map((id, i) => ({ entity: remoteWallet({ id, name: `С${id}` }), serverSeq: 3 + i }));
    await store.sync.applyRemotePage('wallets', seeds, 4);
    for (const id of ['w-a', 'w-b']) await store.wallets.update(id, { name: `Моё ${id}` });
    const theirs = ['w-a', 'w-b'].map((id, i) => ({
      entity: remoteWallet({ id, name: `С${id}`, color: '#123456', clientUpdatedAt: '2026-10-02T00:00:00.000Z', deviceId: 'dev-other' }),
      serverSeq: 8 + i,
    }));
    expect(await store.sync.applyRemotePage('wallets', theirs, 9)).toMatchObject({ merged: 2 });
    const [a, b] = [(await store.db.wallets.get('w-a'))!, (await store.db.wallets.get('w-b'))!];
    expect(new Set([a.clientUpdatedAt, b.clientUpdatedAt]).size).toBe(2);
    for (const r of [a, b]) expect(r.clientUpdatedAt > '2026-10-02T00:00:00.000Z').toBe(true);
  });
});
