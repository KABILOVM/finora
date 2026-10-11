import type { Budget, Category, Debt, RecurringRule, Settings, Transaction, Wallet } from '@/domain/types';

/**
 * Фабрики валидных сущностей для тестов синхронизации.
 * id — детерминированные UUID (счётчики на файл тестов), метки — фиксированные, всё переопределяется через overrides.
 * Метки по умолчанию лежат в прошлом; тесты, которым важны «часы сервера», задают метки сами.
 */

const counters = { user: 0, wallet: 0, category: 0, transaction: 0, budget: 0, debt: 0, rule: 0 };

/** Детерминированный UUID версии 4: PPPPPPPP-0000-4000-8000-NNNNNNNNNNNN (префикс отличает вид сущности). */
function uuid(prefix: number, n: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const STAMP = '2026-01-01T00:00:00.000Z';
const DEVICE = 'test-device-a';

/** Новый id пользователя (каждый вызов — следующий). */
export function makeUserId(): string {
  return uuid(1, ++counters.user);
}

export function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
  const n = ++counters.wallet;
  return {
    id: uuid(2, n),
    createdAt: STAMP,
    clientUpdatedAt: STAMP,
    deviceId: DEVICE,
    deletedAt: null,
    name: `Кошелёк ${n}`,
    currency: 'TJS',
    kind: 'cash',
    openingBalanceMinor: 0,
    color: '#0ea5e9',
    icon: 'wallet',
    sortOrder: n,
    archivedAt: null,
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  const n = ++counters.category;
  return {
    id: uuid(3, n),
    createdAt: STAMP,
    clientUpdatedAt: STAMP,
    deviceId: DEVICE,
    deletedAt: null,
    name: `Категория ${n}`,
    kind: 'expense',
    parentId: null,
    color: '#f97316',
    icon: 'tag',
    sortOrder: n,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * По умолчанию — расход в TJS без категории. walletId по умолчанию указывает на НЕСУЩЕСТВУЮЩИЙ кошелёк:
 * тест, который отправляет операцию на сервер, обязан передать walletId отправленного кошелька.
 * Для kind='transfer' недостающие поля перевода заполняются сами (toWalletId тоже надо передать).
 */
export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const n = ++counters.transaction;
  const kind = overrides.kind ?? 'expense';
  const amountMinor = overrides.amountMinor ?? 10_000;
  const transfer = kind === 'transfer';
  return {
    id: uuid(4, n),
    createdAt: STAMP,
    clientUpdatedAt: STAMP,
    deviceId: DEVICE,
    deletedAt: null,
    kind,
    walletId: uuid(5, n),
    toWalletId: transfer ? uuid(6, n) : null,
    amountMinor,
    toAmountMinor: transfer ? amountMinor : null,
    categoryId: null,
    occurredOn: '2026-10-10',
    note: '',
    baseCurrency: 'TJS',
    baseAmountMinor: transfer ? 0 : amountMinor,
    fxRate: transfer ? null : 1,
    fxSource: transfer ? null : 'same',
    debtId: null,
    recurringRuleId: null,
    ...overrides,
  };
}

/** Бюджет на месяц: по умолчанию общий (без категории). id здесь простой счётчик — сервер не проверяет, что он v5. */
export function makeBudget(overrides: Partial<Budget> = {}): Budget {
  const n = ++counters.budget;
  return {
    id: uuid(7, n),
    createdAt: STAMP,
    clientUpdatedAt: STAMP,
    deviceId: DEVICE,
    deletedAt: null,
    categoryId: null,
    amountMinor: 500_000,
    currency: 'TJS',
    period: 'month',
    archivedAt: null,
    ...overrides,
  };
}

/** Долг «мне должны» в TJS. */
export function makeDebt(overrides: Partial<Debt> = {}): Debt {
  const n = ++counters.debt;
  return {
    id: uuid(8, n),
    createdAt: STAMP,
    clientUpdatedAt: STAMP,
    deviceId: DEVICE,
    deletedAt: null,
    direction: 'lent',
    counterparty: `Должник ${n}`,
    principalMinor: 100_000,
    currency: 'TJS',
    openedOn: '2026-09-01',
    dueOn: null,
    note: '',
    closedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * Ежемесячный расход. Как у makeTransaction: walletId по умолчанию указывает на НЕСУЩЕСТВУЮЩИЙ кошелёк, а для kind='transfer'
 * недостающие поля перевода заполняются сами (toWalletId тоже надо передать).
 */
export function makeRecurringRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  const n = ++counters.rule;
  const kind = overrides.kind ?? 'expense';
  const amountMinor = overrides.amountMinor ?? 10_000;
  const transfer = kind === 'transfer';
  return {
    id: uuid(9, n),
    createdAt: STAMP,
    clientUpdatedAt: STAMP,
    deviceId: DEVICE,
    deletedAt: null,
    kind,
    walletId: uuid(10, n),
    toWalletId: transfer ? uuid(11, n) : null,
    amountMinor,
    toAmountMinor: transfer ? amountMinor : null,
    categoryId: null,
    debtId: null,
    note: '',
    frequency: 'monthly',
    intervalN: 1,
    startOn: '2026-10-01',
    endOn: null,
    autoPost: 0,
    archivedAt: null,
    ...overrides,
  };
}

/** Настройки пользователя: id = id пользователя. */
export function makeSettings(userId: string, overrides: Partial<Settings> = {}): Settings {
  return {
    id: userId,
    createdAt: STAMP,
    clientUpdatedAt: STAMP,
    deviceId: DEVICE,
    deletedAt: null,
    baseCurrency: 'TJS',
    locale: 'ru',
    weekStartsOn: 1,
    defaultWalletId: null,
    ...overrides,
  };
}
