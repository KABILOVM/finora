/**
 * Атака 7. Две вкладки одного устройства: два хранилища и два движка на ОДНОЙ базе (одна IndexedDB, один deviceId).
 * Двойные отправки безопасны; ничего не задвоено; markPushed одной вкладки не затирает правку соседней.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import type { SyncTableName } from '@/sync/tables';
import { openDevice, settle, spy, until, type Device, type Spy } from '../sync/engineHarness';

const USER = '11111111-1111-4111-8111-111111111111';

interface Tab extends Device {
  spy: Spy;
}

/** Вкладка: та же IndexedDB и тот же deviceId, свой движок и свой транспорт со шпионом. */
async function tab(server: MemoryServer, factory: IDBFactory, seed = false): Promise<Tab> {
  let s!: Spy;
  const d = await openDevice(server, 'dev-phone', {
    factory,
    seed,
    wrap: (inner) => {
      s = spy(inner);
      return s.transport;
    },
  });
  return Object.assign(d, { spy: s });
}

const rows = (server: MemoryServer, t: SyncTableName) => server.dump(USER, t);

async function twoTabs(seed = true) {
  const server = createMemoryServer();
  const factory = new IDBFactory();
  const t1 = await tab(server, factory, seed);
  await t1.engine.syncNow(); // первая загрузка и затравка — в первой вкладке
  const t2 = await tab(server, factory, seed);
  return { server, t1, t2 };
}

const expense = (t: Tab, walletId: string, note: string, amountMinor = 100) =>
  t.store.transactions.create({ kind: 'expense', walletId, amountMinor, occurredOn: '2026-10-05', note });

describe('атака 7: две вкладки на одной базе', () => {
  it('обе вкладки одновременно отправляют одни и те же 30 записей: на сервере каждая ровно раз, очередь пуста в обеих', async () => {
    const { server, t1, t2 } = await twoTabs();
    const w = (await t1.store.db.wallets.toArray())[0]!;
    for (let i = 0; i < 30; i++) await expense(t1, w.id, `n${i}`, 100 + i);
    await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()]);
    await t1.engine.syncNow();
    await t2.engine.syncNow();
    expect(rows(server, 'transactions')).toHaveLength(30);
    expect(new Set(rows(server, 'transactions').map((r) => r['id'])).size).toBe(30);
    const seqs = rows(server, 'transactions').map((r) => r['server_seq']);
    // повторная отправка той же версии сервер игнорирует: номера не меняются
    await t2.engine.syncNow();
    await t1.engine.syncNow();
    expect(rows(server, 'transactions').map((r) => r['server_seq'])).toEqual(seqs);
    expect(await t1.store.sync.counts()).toEqual({ pending: 0, quarantined: 0 });
    expect(await t2.store.db.transactions.count()).toBe(30);
  }, 30_000);

  it('markPushed вкладки 1 не затирает правку, сделанную во вкладке 2 пока шла отправка: правка остаётся в очереди и доезжает', async () => {
    const { server, t1, t2 } = await twoTabs();
    const w = (await t1.store.db.wallets.toArray())[0]!;
    const tx = await expense(t1, w.id, 'v1', 100);
    let fired = false;
    t1.spy.onPush = async (table) => {
      if (table !== 'transactions' || fired) return;
      fired = true;
      // пока v1 «в пути», вторая вкладка правит ту же операцию
      await t2.store.transactions.update(tx.id, { note: 'v2-из-второй-вкладки', amountMinor: 250 });
    };
    await t1.engine.syncNow();
    const local = await t1.store.db.transactions.get(tx.id);
    expect(local?.note).toBe('v2-из-второй-вкладки');
    expect(t1.spy.pushes('transactions').length, 'гонка не случилась: v2 не отправлялась отдельной пачкой').toBeGreaterThanOrEqual(2);
    // v1 ушла, v2 осталась в очереди (отметка «отправлено» от v1 её не закрыла) и уходит тем же или следующим циклом
    await t2.engine.syncNow();
    await t1.engine.syncNow();
    const onServer = rows(server, 'transactions').find((r) => r['id'] === tx.id);
    expect([onServer?.['note'], onServer?.['amount_minor']]).toEqual(['v2-из-второй-вкладки', 250]);
    for (const t of [t1, t2]) {
      const r = await t.store.db.transactions.get(tx.id);
      expect([r?.note, r?.amountMinor, r?.dirty]).toEqual(['v2-из-второй-вкладки', 250, 0]);
    }
  }, 30_000);

  it('удаление во второй вкладке, пока первая отправляет создание: удаление не теряется', async () => {
    const { server, t1, t2 } = await twoTabs();
    const w = (await t1.store.db.wallets.toArray())[0]!;
    const tx = await expense(t1, w.id, 'будет-удалена', 500);
    let fired = false;
    t1.spy.onPush = async (table) => {
      if (table !== 'transactions' || fired) return;
      fired = true;
      await t2.store.transactions.softDelete(tx.id);
    };
    await t1.engine.syncNow();
    await t2.engine.syncNow();
    await t1.engine.syncNow();
    const onServer = rows(server, 'transactions').find((r) => r['id'] === tx.id);
    expect(onServer?.['deleted_at']).not.toBeNull();
    expect((await t1.store.db.transactions.get(tx.id))?.deletedAt).not.toBeNull();
    expect(await t1.store.sync.counts()).toEqual({ pending: 0, quarantined: 0 });
  }, 30_000);

  it('обе вкладки одновременно правят одну операцию (20 пар гонок): на сервере та же версия, что и в базе, обе вкладки сходятся', async () => {
    const { server, t1, t2 } = await twoTabs();
    const w = (await t1.store.db.wallets.toArray())[0]!;
    const tx = await expense(t1, w.id, 'старт', 100);
    await t1.engine.syncNow();
    for (let i = 0; i < 20; i++) {
      await Promise.all([
        t1.store.transactions.update(tx.id, { note: `A${i}`, amountMinor: 1000 + i }),
        t2.store.transactions.update(tx.id, { note: `B${i}`, amountMinor: 2000 + i }),
      ]);
      if (i % 5 === 0) await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()]);
    }
    await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()]);
    await t1.engine.syncNow();
    await t2.engine.syncNow();
    const dbRow = (await t1.store.db.transactions.get(tx.id))!;
    const onServer = rows(server, 'transactions').find((r) => r['id'] === tx.id)!;
    expect([onServer['note'], onServer['amount_minor']], 'правка пропала молча: сервер и база расходятся').toEqual([dbRow.note, dbRow.amountMinor]);
    expect(dbRow.dirty).toBe(0);
    expect(rows(server, 'transactions')).toHaveLength(1);
  }, 60_000);

  it('вкладка 2 открылась ДО того, как вкладка 1 закончила первую загрузку: затравка не плодит дубли', async () => {
    const server = createMemoryServer();
    const factory = new IDBFactory();
    const t1 = await tab(server, factory, true);
    const t2 = await tab(server, factory, true);
    await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()]);
    await t1.engine.syncNow();
    await t2.engine.syncNow();
    expect(rows(server, 'settings')).toHaveLength(1);
    expect(rows(server, 'wallets')).toHaveLength(1);
    expect(rows(server, 'categories')).toHaveLength(17);
    expect(await t1.store.db.wallets.count()).toBe(1);
    expect(await t1.store.db.categories.count()).toBe(17);
    await settle(5);
    void until;
  }, 30_000);
});
