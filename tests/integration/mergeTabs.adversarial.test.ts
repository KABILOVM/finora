/**
 * Две вкладки одного устройства (один deviceId, одна IndexedDB) и слияние по группам полей:
 * объединённые группы dirtyGroups, метки, markPushed соседа, одновременное слияние одной страницы.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';
import { openDevice, settle, spy, type Device, type Spy } from '../sync/engineHarness';

const USER = '11111111-1111-4111-8111-111111111111';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Tab extends Device {
  spy: Spy;
}
async function tab(server: MemoryServer, factory: IDBFactory, deviceId: string, seed = false): Promise<Tab> {
  let s!: Spy;
  const d = await openDevice(server, deviceId, { factory, seed, wrap: (inner) => ((s = spy(inner)), s.transport) });
  return Object.assign(d, { spy: s });
}

async function setup() {
  const server = createMemoryServer();
  const factory = new IDBFactory();
  const t1 = await tab(server, factory, 'dev-phone', true);
  await t1.engine.syncNow();
  const t2 = await tab(server, factory, 'dev-phone');
  const other = await tab(server, new IDBFactory(), 'dev-laptop', true);
  await other.engine.syncNow();
  const wallet = (await t1.store.db.wallets.toArray())[0]!;
  const tx = await t1.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 10_000, occurredOn: '2026-10-05', note: 'такси' });
  await t1.engine.syncNow();
  await other.engine.syncNow();
  return { server, t1, t2, other, tx, wallet };
}
const serverTx = (server: MemoryServer, id: string) => server.dump(USER, 'transactions').find((t) => t['id'] === id)!;

describe('две вкладки + слияние', () => {
  it('обе вкладки одновременно сливают одну страницу: одна объединённая версия, обе локальные правки и чужая правка на месте', async () => {
    const { server, t1, t2, other, tx } = await setup();
    await t1.store.transactions.update(tx.id, { amountMinor: 20_000 }); // вкладка 1: сумма
    await t2.store.transactions.update(tx.id, { note: 'такси из аэропорта' }); // вкладка 2: заметка
    await other.store.transactions.update(tx.id, { occurredOn: '2026-10-01' }); // ноутбук: дата
    await other.engine.syncNow();
    await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()]);
    for (let i = 0; i < 3; i++) {
      await t1.engine.syncNow();
      await t2.engine.syncNow();
      await other.engine.syncNow();
    }
    const row = serverTx(server, tx.id);
    expect(row['amount_minor']).toBe(20_000);
    expect(row['note']).toBe('такси из аэропорта');
    expect(row['occurred_on']).toBe('2026-10-01');
    for (const d of [t1, t2, other]) {
      expect(await d.store.sync.counts()).toEqual({ pending: 0, quarantined: 0 });
      const local = (await d.store.db.transactions.get(tx.id))!;
      expect([local.amountMinor, local.note, local.occurredOn, local.dirty, 'dirtyGroups' in local]).toEqual([20_000, 'такси из аэропорта', '2026-10-01', 0, false]);
    }
  });

  it('вкладка 2 правит другую группу сразу после слияния во вкладке 1: её метка больше метки слияния, правка доходит до сервера', async () => {
    const { server, t1, t2, other, tx } = await setup();
    await t1.store.transactions.update(tx.id, { amountMinor: 20_000 });
    await sleep(3);
    await other.store.transactions.update(tx.id, { occurredOn: '2026-10-01' });
    await other.engine.syncNow();
    // слияние в вкладке 1 без отправки: обрываем связь на отправке
    t1.spy.onPush = () => {
      throw new TransportError('network', 'обрыв');
    };
    await t1.engine.syncNow();
    const merged = (await t1.store.db.transactions.get(tx.id))!;
    expect(merged.dirty).toBe(1);
    await t2.store.transactions.update(tx.id, { note: 'вкладка 2' });
    const after = (await t2.store.db.transactions.get(tx.id))!;
    expect(after.clientUpdatedAt > merged.clientUpdatedAt, 'метка правки соседней вкладки не больше метки слияния').toBe(true);
    expect([...(after.dirtyGroups ?? [])].sort()).toEqual(['money', 'note']);
    t1.spy.onPush = undefined;
    await t2.engine.syncNow();
    await t1.engine.syncNow();
    await other.engine.syncNow();
    const row = serverTx(server, tx.id);
    expect([row['amount_minor'], row['note'], row['occurred_on']]).toEqual([20_000, 'вкладка 2', '2026-10-01']);
  });

  it('markPushed вкладки 1 не стирает группы правки, сделанной вкладкой 2 во время отправки', async () => {
    const { server, t1, t2, tx } = await setup();
    await t1.store.transactions.update(tx.id, { amountMinor: 20_000 });
    const gate = t1.spy.holdNextPush();
    const p = t1.engine.syncNow();
    await gate.entered;
    await t2.store.transactions.update(tx.id, { note: 'вкладка 2' });
    gate.open();
    await p;
    await t2.engine.syncNow();
    await t1.engine.syncNow();
    const row = serverTx(server, tx.id);
    expect([row['amount_minor'], row['note']]).toEqual([20_000, 'вкладка 2']);
    await settle(5);
  });
});
