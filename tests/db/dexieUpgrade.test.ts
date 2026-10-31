import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { dbNameFor } from '@/db/database';
import { exportBackup, importBackup, openStore } from '@/db';
import { SYNC_TABLES, TABLE_SPECS, fromWire, toWire, type SyncTableName } from '@/sync/tables';
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
      // serverSeq 0 и сброшенный курсор: версия 6 заново забирает операции (прежняя версия отбрасывала debtId и recurringRuleId)
      expect(txs[0]).toMatchObject({ id: T1, amountMinor: 1200, note: 'плов', dirty: 0, serverSeq: 0 });
      expect(txs[1]).toMatchObject({ id: T2, amountMinor: 300, dirty: 1, serverSeq: null, deletedAt: '2026-10-06T00:00:00.000Z' });
      expect(await store.sync.getCursor('transactions')).toBe(0);
      expect(await store.sync.needsResync('transactions')).toBe(true);
      // метка часов не потеряна
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

describe('обновление базы с версии 2 до 3 (список покупок)', () => {
  it('данные этапа 2 на месте, таблица shopping_items появилась пустой и работает; курсор покупок = 0', async () => {
    const factory = new IDBFactory();
    const old = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
    old.version(2).stores({
      settings: 'id, dirty, [dirty+clientUpdatedAt]',
      wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
      categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
      transactions:
        'id, dirty, occurredOn, walletId, toWalletId, categoryId, debtId, recurringRuleId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
      debts: 'id, dirty, direction, closedAt, archivedAt, [dirty+clientUpdatedAt]',
      budgets: 'id, dirty, categoryId, [dirty+clientUpdatedAt]',
      recurring_rules: 'id, dirty, startOn, archivedAt, [dirty+clientUpdatedAt]',
      meta: 'key',
    });
    await old.open();
    const DEBT = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa10';
    await old.table('debts').add({
      ...sync, dirty: 1, serverSeq: null, syncError: null, id: DEBT, direction: 'lent', counterparty: 'Алишер', principalMinor: 5000,
      currency: 'TJS', openedOn: '2026-10-01', dueOn: null, note: '', closedAt: null, archivedAt: null,
    });
    await old.table('meta').put({ key: 'cursor:debts', value: 3 });
    old.close();

    const store = await open(factory);
    try {
      // проценты по долгам (версия 7): старый долг без процентов, а долги заново забираются с сервера — курсор сброшен
      expect(await store.db.debts.get(DEBT)).toMatchObject({ counterparty: 'Алишер', dirty: 1, principalMinor: 5000, interestMinor: null, interestRateBp: null, termMonths: null });
      expect(await store.sync.getCursor('debts')).toBe(0);
      expect(await store.db.shopping_items.count()).toBe(0);
      expect(await store.sync.getCursor('shopping_items')).toBe(0);
      const item = await store.shopping.add({ name: 'Молоко', qtyMilli: 2000, unit: 'l' });
      expect(await store.db.shopping_items.get(item.id)).toMatchObject({ name: 'Молоко', dirty: 1 });
      expect(await store.db.shopping_items.where('dirty').equals(1).count()).toBe(1);
    } finally {
      store.close();
    }
  });
});

describe('обновление базы с версии 3 до 4 (цели накопления)', () => {
  const WALLET_OLD = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa20';
  const stores3 = {
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
  const wallet3 = {
    ...sync, dirty: 0, serverSeq: 4, syncError: null, id: WALLET_OLD, name: 'Копилка', currency: 'TJS', kind: 'savings',
    openingBalanceMinor: 1000, color: '#000000', icon: 'x', sortOrder: 0, archivedAt: null,
  };

  it('у старых кошельков цель = null (а не undefined), остальное на месте, строка остаётся «чистой»', async () => {
    const factory = new IDBFactory();
    const old = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
    old.version(3).stores(stores3);
    await old.open();
    await old.table('wallets').add(wallet3);
    old.close();

    const store = await open(factory);
    try {
      const w = await store.db.wallets.get(WALLET_OLD);
      // serverSeq = 0: версия 6 заново забирает кошельки с сервера (там цель могла быть, а прежняя версия её отбросила)
      expect(w).toMatchObject({ name: 'Копилка', openingBalanceMinor: 1000, dirty: 0, serverSeq: 0, goalMinor: null, goalOn: null });
      expect('goalMinor' in w!).toBe(true);
      // пустая правка не помечает кошелёк изменённым
      const same = await store.wallets.update(WALLET_OLD, { goalMinor: null, goalOn: null });
      expect(same.dirty).toBe(0);
      // цель ставится и читается
      const set = await store.wallets.update(WALLET_OLD, { goalMinor: 50_000, goalOn: '2027-01-01' });
      expect(set).toMatchObject({ goalMinor: 50_000, goalOn: '2027-01-01', dirty: 1 });
    } finally {
      store.close();
    }
  });

  it('строка, записанная прежней версией ПОСЛЕ обновления (без ключей цели), читается как «цели нет» и правится без ошибок', async () => {
    const factory = new IDBFactory();
    const store = await open(factory);
    try {
      await store.db.wallets.add(wallet3 as never); // как вкладка со старым кодом: полей цели нет совсем
      const w = (await store.db.wallets.get(WALLET_OLD))!;
      expect(w.goalMinor).toBeUndefined();
      // правка «ничего не меняет» не помечает такой кошелёк изменённым (undefined в базе и null после проверки — одно и то же)
      const same = await store.wallets.update(WALLET_OLD, { name: 'Копилка', goalMinor: null });
      expect(same.dirty).toBe(0);
      const renamed = await store.wallets.update(WALLET_OLD, { name: 'Новая копилка' });
      expect(renamed).toMatchObject({ name: 'Новая копилка', goalMinor: null, goalOn: null });
      expect(renamed.dirtyGroups).toEqual(['name']);
    } finally {
      store.close();
    }
  });

  it('копия, сделанная до целей (кошелёк без полей цели), загружается, цель = null', async () => {
    const factory = new IDBFactory();
    const store = await open(factory);
    try {
      await store.settings.ensure();
      const w = await store.wallets.create({ name: 'Нал', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
      const file = await exportBackup(store);
      const { goalMinor: _g, goalOn: _o, ...old } = file.wallets[0] as unknown as Record<string, unknown>;
      void [_g, _o];
      const fresh = await open(new IDBFactory());
      try {
        await fresh.settings.ensure();
        await importBackup(fresh, { ...file, wallets: [old as never] });
        expect(await fresh.db.wallets.get(w.id)).toMatchObject({ name: 'Нал', goalMinor: null, goalOn: null });
      } finally {
        fresh.close();
      }
    } finally {
      store.close();
    }
  });
});

describe('обновление базы с версии 4 до 5: города для погоды', () => {
  const stores4 = {
    settings: 'id, dirty, [dirty+clientUpdatedAt]',
    wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
    categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
    transactions: 'id, dirty, occurredOn, walletId, toWalletId, categoryId, debtId, recurringRuleId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
    budgets: 'id, dirty, categoryId, [dirty+clientUpdatedAt]',
    debts: 'id, dirty, closedAt, archivedAt, [dirty+clientUpdatedAt]',
    recurring_rules: 'id, dirty, startOn, archivedAt, [dirty+clientUpdatedAt]',
    shopping_items: 'id, dirty, purchasedAt, transactionId, [dirty+clientUpdatedAt]',
    meta: 'key',
  };
  const settings4 = { ...sync, dirty: 0, serverSeq: 7, syncError: null, id: USER_A, baseCurrency: 'USD', locale: 'ru', weekStartsOn: 0, defaultWalletId: null };

  it('у старых настроек города = null (а не undefined), остальное на месте, строка остаётся «чистой»', async () => {
    const factory = new IDBFactory();
    const old = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
    old.version(4).stores(stores4);
    await old.open();
    await old.table('settings').add(settings4);
    old.close();

    const store = await open(factory);
    try {
      const s = await store.db.settings.get(USER_A);
      // serverSeq = 0: версия 6 заново забирает настройки с сервера (там города могли быть, а прежняя версия их отбросила)
      expect(s).toMatchObject({ baseCurrency: 'USD', weekStartsOn: 0, dirty: 0, serverSeq: 0, weather: null });
      expect('weather' in s!).toBe(true);
      expect((await store.settings.update({ weather: null })).dirty).toBe(0); // пустая правка строку не «пачкает»
    } finally {
      store.close();
    }
  });
});

describe('обновление базы с версии 5 до 6: кошельки, настройки и операции забираются с сервера заново', () => {
  const stores5 = {
    settings: 'id, dirty, [dirty+clientUpdatedAt]',
    wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
    categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
    transactions: 'id, dirty, occurredOn, walletId, toWalletId, categoryId, debtId, recurringRuleId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
    budgets: 'id, dirty, categoryId, [dirty+clientUpdatedAt]',
    debts: 'id, dirty, direction, closedAt, archivedAt, [dirty+clientUpdatedAt]',
    recurring_rules: 'id, dirty, startOn, archivedAt, [dirty+clientUpdatedAt]',
    shopping_items: 'id, dirty, purchasedAt, transactionId, [dirty+clientUpdatedAt]',
    meta: 'key',
  };
  const W_CLEAN = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa31';
  const W_RENAMED = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa32';
  const W_REVERTED = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa33';
  const W_NEW = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa34';
  const TX_SEEN = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa35';
  const TX_LOCAL = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa36';
  const wallet = (id: string, name: string, local: object) => ({
    ...sync, id, name, currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#000000', icon: 'x', sortOrder: 0,
    archivedAt: null, goalMinor: null, goalOn: null, syncError: null, ...local,
  });
  const renameMemory = { dirtyGroups: ['name'], dirtyBase: { name: { b: { name: 'Копилка' }, at: '2026-10-02T00:00:00.000Z' } } };

  it('курсоры кошельков, настроек и операций сброшены, serverSeq = 0 у строк, видевших сервер; правки и память о них на месте', async () => {
    const factory = new IDBFactory();
    const old = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
    old.version(5).stores(stores5);
    await old.open();
    await old.table('wallets').bulkAdd([
      wallet(W_CLEAN, 'Копилка', { dirty: 0, serverSeq: 4 }),
      wallet(W_RENAMED, 'Отпуск', { dirty: 1, serverSeq: 5, ...renameMemory }), // переименован, ещё не отправлен
      wallet(W_REVERTED, 'Запас', { dirty: 1, serverSeq: 6, dirtyGroups: [], dirtyBase: {} }), // сменил и вернул
      wallet(W_NEW, 'Новый', { dirty: 1, serverSeq: null }), // создан здесь, сервер его ещё не видел
    ]);
    await old.table('settings').add({ ...sync, dirty: 0, serverSeq: 7, syncError: null, id: USER_A, baseCurrency: 'TJS', locale: 'ru', weekStartsOn: 1, defaultWalletId: null, weather: null });
    await old.table('transactions').bulkAdd([
      { ...sync, id: TX_SEEN, kind: 'expense', walletId: W_CLEAN, toWalletId: null, amountMinor: 100, toAmountMinor: null, categoryId: null, occurredOn: '2026-10-01', note: '', baseCurrency: 'TJS', baseAmountMinor: 100, fxRate: null, fxSource: null, debtId: null, recurringRuleId: null, dirty: 0, serverSeq: 11, syncError: null },
      { ...sync, id: TX_LOCAL, kind: 'expense', walletId: W_CLEAN, toWalletId: null, amountMinor: 200, toAmountMinor: null, categoryId: null, occurredOn: '2026-10-02', note: '', baseCurrency: 'TJS', baseAmountMinor: 200, fxRate: null, fxSource: null, debtId: null, recurringRuleId: null, dirty: 1, serverSeq: null, syncError: null },
    ]);
    await old.table('meta').bulkPut([
      { key: 'cursor:wallets', value: 9 },
      { key: 'cursor:settings', value: 7 },
      { key: 'cursor:transactions', value: 12 },
      { key: 'initialPullDone', value: true },
    ]);
    old.close();

    const store = await open(factory);
    try {
      for (const t of ['wallets', 'settings', 'transactions'] as const) {
        expect(await store.db.meta.get(`cursor:${t}`), t).toBeUndefined();
        expect(await store.sync.getCursor(t), t).toBe(0);
        // метка держит повтор, даже если вкладка со старым кодом запишет курсор поверх сброса
        expect(await store.sync.needsResync(t), t).toBe(true);
      }
      // остальные таблицы не забираются заново
      expect(await store.sync.needsResync('categories')).toBe(false);
      expect(await store.sync.getMeta('initialPullDone')).toBe(true);
      expect(await store.db.transactions.get(TX_SEEN)).toMatchObject({ dirty: 0, serverSeq: 0 });
      expect(await store.db.transactions.get(TX_LOCAL)).toMatchObject({ dirty: 1, serverSeq: null });

      expect(await store.db.wallets.get(W_CLEAN)).toMatchObject({ name: 'Копилка', dirty: 0, serverSeq: 0 });
      expect(await store.db.wallets.get(W_RENAMED)).toMatchObject({ name: 'Отпуск', dirty: 1, serverSeq: 0, ...renameMemory });
      expect(await store.db.wallets.get(W_REVERTED)).toMatchObject({ dirty: 1, serverSeq: 0, dirtyGroups: [], dirtyBase: {} });
      expect(await store.db.wallets.get(W_NEW)).toMatchObject({ dirty: 1, serverSeq: null });
      expect(await store.db.settings.get(USER_A)).toMatchObject({ dirty: 0, serverSeq: 0 });
      // правка существующей записи перед отправкой сверится с сервером (serverSeq 0 — «строка на сервере есть»)
      expect(await store.sync.hasMergeableEdits()).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe('обновление базы с версии 6 до 7: проценты по долгам', () => {
  const stores6 = {
    settings: 'id, dirty, [dirty+clientUpdatedAt]',
    wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
    categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
    transactions: 'id, dirty, occurredOn, walletId, toWalletId, categoryId, debtId, recurringRuleId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
    budgets: 'id, dirty, categoryId, [dirty+clientUpdatedAt]',
    debts: 'id, dirty, direction, closedAt, archivedAt, [dirty+clientUpdatedAt]',
    recurring_rules: 'id, dirty, startOn, archivedAt, [dirty+clientUpdatedAt]',
    shopping_items: 'id, dirty, purchasedAt, transactionId, [dirty+clientUpdatedAt]',
    meta: 'key',
  };
  const D_SEEN = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa41';
  const D_EDITED = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa42';
  const D_NEW = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa43';
  const debt = (id: string, local: object) => ({
    ...sync, id, direction: 'borrowed', counterparty: 'Банк', principalMinor: 1_000_000, currency: 'TJS', openedOn: '2026-10-01', dueOn: null,
    note: '', closedAt: null, archivedAt: null, syncError: null, ...local,
  });

  it('у старых долгов проценты = null (а не undefined); долги забираются с сервера заново; правки и память о них на месте', async () => {
    const factory = new IDBFactory();
    const old = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
    old.version(6).stores(stores6);
    await old.open();
    const memory = { dirtyGroups: ['note'], dirtyBase: { note: { b: { note: '' }, at: '2026-10-02T00:00:00.000Z' } } };
    await old.table('debts').bulkAdd([
      debt(D_SEEN, { dirty: 0, serverSeq: 4 }),
      debt(D_EDITED, { dirty: 1, serverSeq: 5, note: 'договор', ...memory }), // заметка правлена, ещё не отправлена
      debt(D_NEW, { dirty: 1, serverSeq: null }), // создан здесь, сервер его ещё не видел
    ]);
    await old.table('meta').bulkPut([
      { key: 'cursor:debts', value: 5 },
      { key: 'cursor:wallets', value: 9 },
      { key: 'initialPullDone', value: true },
    ]);
    old.close();

    const store = await open(factory);
    try {
      expect(await store.db.meta.get('cursor:debts')).toBeUndefined();
      expect(await store.sync.getCursor('debts')).toBe(0);
      expect(await store.sync.needsResync('debts')).toBe(true); // метка держит повтор, даже если вкладка со старым кодом запишет курсор
      expect(await store.sync.getCursor('wallets')).toBe(9); // остальные таблицы не забираются заново
      expect(await store.sync.needsResync('wallets')).toBe(false);
      expect(await store.sync.getMeta('initialPullDone')).toBe(true);

      const none = { interestMinor: null, interestRateBp: null, termMonths: null };
      const seen = await store.db.debts.get(D_SEEN);
      expect(seen).toMatchObject({ dirty: 0, serverSeq: 0, ...none });
      for (const k of Object.keys(none)) expect(k in seen!, k).toBe(true);
      expect(await store.db.debts.get(D_EDITED)).toMatchObject({ dirty: 1, serverSeq: 0, note: 'договор', ...none, ...memory });
      expect(await store.db.debts.get(D_NEW)).toMatchObject({ dirty: 1, serverSeq: null, ...none });
      expect(await store.sync.hasMergeableEdits()).toBe(true); // правка существующего долга перед отправкой сверится с сервером

      // старый долг работает как раньше, а проценты к нему добавляются обычной правкой
      const updated = await store.debts.update(D_SEEN, { interestMinor: 250_000, interestRateBp: 2400, termMonths: 12 });
      expect(updated).toMatchObject({ interestMinor: 250_000, interestRateBp: 2400, termMonths: 12, dirty: 1 });
    } finally {
      store.close();
    }
  });
});

describe('обновление базы с версии 7 до 8: объединение долгов', () => {
  const stores7 = {
    settings: 'id, dirty, [dirty+clientUpdatedAt]',
    wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
    categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
    transactions: 'id, dirty, occurredOn, walletId, toWalletId, categoryId, debtId, recurringRuleId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
    budgets: 'id, dirty, categoryId, [dirty+clientUpdatedAt]',
    debts: 'id, dirty, direction, closedAt, archivedAt, [dirty+clientUpdatedAt]',
    recurring_rules: 'id, dirty, startOn, archivedAt, [dirty+clientUpdatedAt]',
    shopping_items: 'id, dirty, purchasedAt, transactionId, [dirty+clientUpdatedAt]',
    meta: 'key',
  };
  const D_SEEN = '0a3a28c0-5fdc-4385-8fca-7c24d9aabb41';
  const D_EDITED = '0a3a28c0-5fdc-4385-8fca-7c24d9aabb42';
  const D_NEW = '0a3a28c0-5fdc-4385-8fca-7c24d9aabb43';
  const debt = (id: string, local: object) => ({
    ...sync, id, direction: 'borrowed', counterparty: 'Банк', principalMinor: 1_000_000, interestMinor: null, interestRateBp: null, termMonths: null,
    currency: 'TJS', openedOn: '2026-10-01', dueOn: null, note: '', closedAt: null, archivedAt: null, syncError: null, ...local,
  });

  it('у старых долгов mergedIntoId = null (а не undefined); долги забираются с сервера заново; правки и память о них на месте', async () => {
    const factory = new IDBFactory();
    const old = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
    old.version(7).stores(stores7);
    await old.open();
    const memory = { dirtyGroups: ['note'], dirtyBase: { note: { b: { note: '' }, at: '2026-10-02T00:00:00.000Z' } } };
    await old.table('debts').bulkAdd([
      debt(D_SEEN, { dirty: 0, serverSeq: 4 }),
      debt(D_EDITED, { dirty: 1, serverSeq: 5, note: 'договор', ...memory }), // заметка правлена, ещё не отправлена
      debt(D_NEW, { dirty: 1, serverSeq: null }), // создан здесь, сервер его ещё не видел
    ]);
    await old.table('meta').bulkPut([
      { key: 'cursor:debts', value: 5 },
      { key: 'cursor:wallets', value: 9 },
      { key: 'initialPullDone', value: true },
    ]);
    old.close();

    const store = await open(factory);
    try {
      expect(await store.db.meta.get('cursor:debts')).toBeUndefined();
      expect(await store.sync.getCursor('debts')).toBe(0);
      expect(await store.sync.needsResync('debts')).toBe(true); // метка держит повтор, даже если вкладка со старым кодом запишет курсор
      expect(await store.sync.getCursor('wallets')).toBe(9); // остальные таблицы не забираются заново
      expect(await store.sync.needsResync('wallets')).toBe(false);

      const seen = await store.db.debts.get(D_SEEN);
      expect(seen).toMatchObject({ dirty: 0, serverSeq: 0, mergedIntoId: null });
      expect('mergedIntoId' in seen!).toBe(true);
      expect(await store.db.debts.get(D_EDITED)).toMatchObject({ dirty: 1, serverSeq: 0, note: 'договор', mergedIntoId: null, ...memory });
      expect(await store.db.debts.get(D_NEW)).toMatchObject({ dirty: 1, serverSeq: null, mergedIntoId: null });
      expect(await store.sync.hasMergeableEdits()).toBe(true); // правка существующего долга перед отправкой сверится с сервером
    } finally {
      store.close();
    }
  });
});

/**
 * Страж. Версия приложения, ещё не знающая новой колонки, получает строки без неё (select('*') + отбор по TABLE_SPECS) и
 * запоминает их серверную версию и курсор. После обновления строка выглядит «без значения», с сервера она больше не придёт,
 * а первая же правка отправит пустое значение поверх настоящего — у всех устройств (так было с целью и с городами, см. версию 6
 * в src/db/database.ts). Поэтому колонка в TABLE_SPECS добавляется ВМЕСТЕ с версией базы, которая заново забирает её таблицу.
 */
describe('новая колонка договора требует версии базы, которая заново забирает таблицу', () => {
  /** Поля договора по таблицам; последние сбросы курсоров — версия 6 (кошельки, настройки, операции), версии 7 и 8 (долги). */
  const SNAPSHOT: Record<SyncTableName, string[]> = {
    settings: ['id', 'createdAt', 'clientUpdatedAt', 'deviceId', 'deletedAt', 'baseCurrency', 'locale', 'weekStartsOn', 'defaultWalletId', 'weather'],
    wallets: [
      'id', 'createdAt', 'clientUpdatedAt', 'deviceId', 'deletedAt', 'name', 'currency', 'kind', 'openingBalanceMinor', 'color', 'icon',
      'sortOrder', 'archivedAt', 'goalMinor', 'goalOn',
    ],
    categories: ['id', 'createdAt', 'clientUpdatedAt', 'deviceId', 'deletedAt', 'name', 'kind', 'parentId', 'color', 'icon', 'sortOrder', 'archivedAt'],
    transactions: [
      'id', 'createdAt', 'clientUpdatedAt', 'deviceId', 'deletedAt', 'kind', 'walletId', 'toWalletId', 'amountMinor', 'toAmountMinor',
      'categoryId', 'occurredOn', 'note', 'baseCurrency', 'baseAmountMinor', 'fxRate', 'fxSource', 'debtId', 'recurringRuleId',
    ],
    debts: [
      'id', 'createdAt', 'clientUpdatedAt', 'deviceId', 'deletedAt', 'direction', 'counterparty', 'principalMinor', 'interestMinor',
      'interestRateBp', 'termMonths', 'mergedIntoId', 'currency', 'openedOn', 'dueOn', 'note', 'closedAt', 'archivedAt',
    ],
    budgets: ['id', 'createdAt', 'clientUpdatedAt', 'deviceId', 'deletedAt', 'categoryId', 'amountMinor', 'currency', 'period', 'archivedAt'],
    recurring_rules: [
      'id', 'createdAt', 'clientUpdatedAt', 'deviceId', 'deletedAt', 'kind', 'walletId', 'toWalletId', 'amountMinor', 'toAmountMinor',
      'categoryId', 'debtId', 'note', 'frequency', 'intervalN', 'startOn', 'endOn', 'autoPost', 'archivedAt',
    ],
    shopping_items: [
      'id', 'createdAt', 'clientUpdatedAt', 'deviceId', 'deletedAt', 'name', 'qtyMilli', 'unit', 'priceMinor', 'checkedAt', 'purchasedAt',
      'transactionId',
    ],
  };

  it.each([...SYNC_TABLES])('%s: поля TABLE_SPECS совпадают со снимком', (table) => {
    const known = SNAPSHOT[table] as string[] | undefined;
    expect(known, `Новая таблица «${table}»: добавьте её поля в снимок (прежние версии её не получали — сбрасывать нечего)`).toBeDefined();
    const fields = TABLE_SPECS[table].columns.map((c) => c.field);
    const added = fields.filter((f) => !known!.includes(f));
    const removed = known!.filter((f) => !fields.includes(f));
    expect(
      { added, removed },
      `Поля таблицы «${table}» изменились. Для новой колонки добавьте версию Dexie в src/db/database.ts, которая удаляет meta ` +
        `'cursor:${table}' и ставит serverSeq = 0 строкам «${table}» с числовым serverSeq (как версия 6), и тест обновления на неё; ` +
        'затем обновите этот снимок',
    ).toEqual({ added: [], removed: [] });
  });
});
