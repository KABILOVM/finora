import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach } from 'vitest';
import type { Transaction, Wallet } from '@/domain/types';
import { openStore, type Store } from '@/db';

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';

const opened: Store[] = [];
let counter = 0;

afterEach(() => {
  while (opened.length) opened.pop()?.close();
});

export interface MakeStoreOptions {
  userId?: string;
  deviceId?: string;
  now?: () => number;
  /** Своя «браузерная» база: два устройства одного пользователя = две разные фабрики. */
  factory?: IDBFactory;
}

/** Открывает хранилище в изолированной fake-indexeddb; закрывается само после теста. */
export async function makeStore(opts: MakeStoreOptions = {}): Promise<Store> {
  const store = await openStore(opts.userId ?? USER_A, {
    deviceId: opts.deviceId ?? `device-${++counter}-test`,
    now: opts.now,
    dexie: { indexedDB: opts.factory ?? new IDBFactory(), IDBKeyRange },
  });
  opened.push(store);
  return store;
}

/** Настройки (TJS), кошельки «Нал» (TJS) и «Доллары» (USD), категории «Еда» (расход) и «Зарплата» (доход). */
export async function basics(store: Store) {
  await store.settings.ensure({ baseCurrency: 'TJS' });
  const cash = await store.wallets.create({
    name: 'Нал',
    currency: 'TJS',
    kind: 'cash',
    openingBalanceMinor: 100_000,
    color: '#16a34a',
    icon: '💵',
  });
  const usd = await store.wallets.create({
    name: 'Доллары',
    currency: 'USD',
    kind: 'cash',
    openingBalanceMinor: 0,
    color: '#2563eb',
    icon: '💲',
  });
  const food = await store.categories.create({ name: 'Еда', kind: 'expense', color: '#f97316', icon: '🍽️' });
  const salary = await store.categories.create({ name: 'Зарплата', kind: 'income', color: '#16a34a', icon: '💼' });
  return { cash, usd, food, salary };
}

export async function expense(store: Store, walletId: string, amountMinor: number, extra: Partial<Parameters<Store['transactions']['create']>[0]> = {}) {
  return store.transactions.create({ kind: 'expense', walletId, amountMinor, occurredOn: '2026-10-05', ...extra });
}

/** Строка операции для чистых тестов (queries): только нужные поля, остальное — по умолчанию. */
export function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    kind: 'expense',
    walletId: 'w1',
    toWalletId: null,
    amountMinor: 100,
    toAmountMinor: null,
    categoryId: null,
    occurredOn: '2026-10-05',
    note: '',
    baseCurrency: 'TJS',
    baseAmountMinor: 100,
    fxRate: 1,
    fxSource: 'same',
    createdAt: '2026-10-05T10:00:00.000Z',
    clientUpdatedAt: '2026-10-05T10:00:00.000Z',
    deviceId: 'device-x-test',
    deletedAt: null,
    ...over,
  };
}

export const stamp = (ms: number): string => new Date(ms).toISOString();

/** Кошелёк «как с сервера» (без локальных полей). */
export function remoteWallet(over: Partial<Wallet> & { id: string }): Wallet {
  return {
    name: 'С сервера',
    currency: 'TJS',
    kind: 'cash',
    openingBalanceMinor: 0,
    color: '#000000',
    icon: 'x',
    sortOrder: 0,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    clientUpdatedAt: '2026-10-01T00:00:00.000Z',
    deviceId: 'device-remote-1',
    deletedAt: null,
    ...over,
  };
}
