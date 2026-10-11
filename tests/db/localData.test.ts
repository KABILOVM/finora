import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { countUserData, openStore } from '@/db';
import { USER_A } from './helpers';

/** countUserData: сколько данных человека лежит на устройстве (подсказка при смене режима) — теперь и бюджеты, долги, регулярные платежи. */
describe('countUserData', () => {
  it('нет базы — 0 и база не создаётся', async () => {
    const factory = new IDBFactory();
    expect(await countUserData(USER_A, { indexedDB: factory, IDBKeyRange })).toBe(0);
    expect((await factory.databases()).length).toBe(0);
  });

  it('считает живые операции, свои кошельки, бюджеты, долги и регулярные платежи (удалённые и архивные-но-живые по правилам)', async () => {
    const factory = new IDBFactory();
    const dexie = { indexedDB: factory, IDBKeyRange };
    const store = await openStore(USER_A, { deviceId: 'device-ld-1', dexie });
    await store.settings.ensure({ baseCurrency: 'TJS' });
    expect(await countUserData(USER_A, dexie)).toBe(0);
    const w = await store.wallets.create({ name: 'Свой', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    expect(await countUserData(USER_A, dexie)).toBe(1);
    const t = await store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 10, occurredOn: '2026-10-01' });
    expect(await countUserData(USER_A, dexie)).toBe(2);
    await store.budgets.create({ amountMinor: 1_000 });
    await store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 100, currency: 'TJS', openedOn: '2026-10-01' });
    await store.recurring.create({ kind: 'expense', walletId: w.id, amountMinor: 10, frequency: 'daily', startOn: '2026-10-01' });
    expect(await countUserData(USER_A, dexie)).toBe(5);
    await store.transactions.softDelete(t.id);
    expect(await countUserData(USER_A, dexie)).toBe(4);
    store.close();
  });

  it('база только с бюджетом — не «пустая»: смена режима предупредит о потере', async () => {
    const factory = new IDBFactory();
    const dexie = { indexedDB: factory, IDBKeyRange };
    const store = await openStore(USER_A, { deviceId: 'device-ld-2', dexie });
    await store.settings.ensure({ baseCurrency: 'TJS' });
    await store.budgets.create({ amountMinor: 500 });
    store.close();
    expect(await countUserData(USER_A, dexie)).toBe(1);
  });
});
