import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { dbNameFor } from '@/db/database';
import { exportBackup, importBackup, openStore } from '@/db';
import { SYNC_TABLES, fromWire, toWire } from '@/sync/tables';
import { pickColumns } from '@/db/syncMerge';
import { USER_A } from './helpers';

/** Обновление локальной базы с версии 1 до 2: данные не теряются, у старых операций новые поля = null, новые таблицы пусты. */

const WALLET = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa01';
const CAT = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa02';
const T1 = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa03';
const T2 = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa04';
const sync = { createdAt: '2026-10-01T00:00:00.000Z', clientUpdatedAt: '2026-10-01T00:00:00.000Z', deviceId: 'device-old-1', deletedAt: null };

/** База ровно такой, какой её создавала версия 1 приложения (схема скопирована из прежнего database.ts). */
async function writeV1(factory: IDBFactory): Promise<void> {
  const old = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
  old.version(1).stores({
    settings: 'id, dirty, [dirty+clientUpdatedAt]',
    wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
    categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
    transactions: 'id, dirty, occurredOn, walletId, toWalletId, categoryId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
    meta: 'key',
  });
  await old.open();
  const local = { dirty: 0, serverSeq: 7, syncError: null };
  await old.table('settings').add({ ...sync, ...local, id: USER_A, baseCurrency: 'TJS', locale: 'ru', weekStartsOn: 1, defaultWalletId: WALLET });
  await old.table('wallets').add({ ...sync, ...local, id: WALLET, name: 'Нал', currency: 'TJS', kind: 'cash', openingBalanceMinor: 5000, color: '#000000', icon: 'x', sortOrder: 0, archivedAt: null });
  await old.table('categories').add({ ...sync, ...local, id: CAT, name: 'Еда', kind: 'expense', parentId: null, color: '#000000', icon: 'x', sortOrder: 0, archivedAt: null });
  const base = { ...sync, ...local, kind: 'expense', walletId: WALLET, toWalletId: null, toAmountMinor: null, categoryId: CAT, occurredOn: '2026-10-05', baseCurrency: 'TJS', fxRate: 1, fxSource: 'same' };
  await old.table('transactions').bulkAdd([
    { ...base, id: T1, amountMinor: 1200, note: 'плов', baseAmountMinor: 1200 },
    { ...base, id: T2, amountMinor: 300, note: 'хлеб', baseAmountMinor: 300, dirty: 1, serverSeq: null, deletedAt: '2026-10-06T00:00:00.000Z' },
  ]);
  await old.table('meta').put({ key: 'cursor:transactions', value: 7 });
  await old.table('meta').put({ key: 'lastStamp', value: '2026-10-05T12:00:00.000Z' });
  old.close();
}

const open = (factory: IDBFactory) =>
  openStore(USER_A, { deviceId: 'device-new-1', dexie: { indexedDB: factory, IDBKeyRange } });

describe('обновление базы с версии 1 до 2', () => {
  it('всё на месте; у старых операций debtId и recurringRuleId = null; новые таблицы пусты и работают', async () => {
    const factory = new IDBFactory();
    await writeV1(factory);
    const store = await open(factory);
    try {
      expect(await store.db.wallets.count()).toBe(1);
      expect(await store.db.categories.count()).toBe(1);
      expect(await store.db.settings.count()).toBe(1);
      const txs = await store.db.transactions.orderBy('id').toArray();
      expect(txs).toHaveLength(2);
      for (const t of txs) {
        expect(t.debtId).toBeNull();
        expect(t.recurringRuleId).toBeNull();
      }
      expect(txs[0]).toMatchObject({ id: T1, amountMinor: 1200, note: 'плов', dirty: 0, serverSeq: 7 });
      expect(txs[1]).toMatchObject({ id: T2, amountMinor: 300, dirty: 1, serverSeq: null, deletedAt: '2026-10-06T00:00:00.000Z' });
      // служебные записи (курсор синхронизации, метка часов) не потеряны
      expect(await store.sync.getCursor('transactions')).toBe(7);
      expect(await store.sync.getMeta('lastStamp')).toBe('2026-10-05T12:00:00.000Z');
      // новые таблицы есть, пустые
      expect(await store.db.budgets.count()).toBe(0);
      expect(await store.db.debts.count()).toBe(0);
      expect(await store.db.recurring_rules.count()).toBe(0);
      expect(await store.sync.getCursor('debts')).toBe(0);
      // индексы новых полей работают на старых данных (null не индексируется — запрос «по долгу» ничего не находит)
      expect(await store.db.transactions.where('debtId').equals('x').count()).toBe(0);
      expect(await store.db.transactions.where('recurringRuleId').equals('x').count()).toBe(0);
    } finally {
      store.close();
    }
  });

  it('старые данные сразу пригодны для работы: правка, новая операция с долгом, резервная копия, повторное открытие', async () => {
    const factory = new IDBFactory();
    await writeV1(factory);
    const store = await open(factory);
    try {
      const edited = await store.transactions.update(T1, { note: 'плов с мясом' });
      expect(edited).toMatchObject({ note: 'плов с мясом', debtId: null, recurringRuleId: null });
      const debt = await store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-05' });
      const t = await store.transactions.create({ kind: 'expense', walletId: WALLET, amountMinor: 50_000, occurredOn: '2026-10-05', debtId: debt.id });
      expect(await store.db.transactions.where('debtId').equals(debt.id).primaryKeys()).toEqual([t.id]);
      const file = await exportBackup(store);
      expect(file.version).toBe(2);
      expect(file.transactions.every((x) => x.debtId !== undefined && x.recurringRuleId !== undefined)).toBe(true);
    } finally {
      store.close();
    }
    const again = await open(factory); // повторное открытие уже новой версии
    try {
      expect(await again.db.transactions.count()).toBe(3);
      expect(await again.db.debts.count()).toBe(1);
    } finally {
      again.close();
    }
  });

  it('копия, сделанная версией 1 (без новых полей), загружается в обновлённую базу', async () => {
    const factory = new IDBFactory();
    await writeV1(factory);
    const store = await open(factory);
    try {
      const v1 = {
        format: 'finora-backup',
        version: 1,
        exportedAt: '2026-10-10T00:00:00.000Z',
        settings: null,
        wallets: [],
        categories: [],
        transactions: [],
      };
      await expect(importBackup(store, v1)).resolves.toEqual({ added: 0, replaced: 0, keptLocal: 0 });
    } finally {
      store.close();
    }
  });
});

describe('чтение строк без новых полей (старые данные, старый сервер)', () => {
  const oldWire = {
    id: T1, created_at: sync.createdAt, client_updated_at: sync.clientUpdatedAt, device_id: 'd', deleted_at: null,
    kind: 'expense', wallet_id: WALLET, to_wallet_id: null, amount_minor: 100, to_amount_minor: null, category_id: CAT,
    occurred_on: '2026-10-05', note: '', base_currency: 'TJS', base_amount_minor: 100, fx_rate: 1, fx_source: 'same', server_seq: 3,
  };
  it('fromWire: отсутствующие debt_id и recurring_rule_id читаются как null', () => {
    const { entity } = fromWire('transactions', oldWire);
    expect(entity).toMatchObject({ debtId: null, recurringRuleId: null });
  });
  it('pickColumns (строка с сервера уже в виде сущности): отсутствующие поля = null', () => {
    const { debtId: _d, recurringRuleId: _r, ...rest } = fromWire('transactions', oldWire).entity as unknown as Record<string, unknown>;
    void _d; void _r;
    expect(pickColumns('transactions', rest)).toMatchObject({ debtId: null, recurringRuleId: null });
  });
  it('toWire отправляет новые поля как null, а не пропускает', () => {
    const { debtId: _d, ...rest } = fromWire('transactions', oldWire).entity as unknown as Record<string, unknown>;
    void _d;
    const wire = toWire('transactions', rest as never);
    expect(wire).toHaveProperty('debt_id', null);
    expect(wire).toHaveProperty('recurring_rule_id', null);
  });
  it('все семь таблиц договора есть в локальной базе', async () => {
    const store = await open(new IDBFactory());
    try {
      for (const t of SYNC_TABLES) expect(await store.db.syncTable(t).count()).toBe(0);
    } finally {
      store.close();
    }
  });
});
