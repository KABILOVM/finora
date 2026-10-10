/**
 * ЕДИНЫЙ файл доменных типов Finora. Новые сущности — только сюда.
 *
 * Деньги: всегда целое число «минорных единиц» (дирам, центы) — `Minor`. Никаких дробных сумм.
 * Время: даты операций — календарная дата пользователя 'YYYY-MM-DD'; метки правок — ISO UTC с миллисекундами.
 * Удаление: только мягкое (`deletedAt`), строки физически не удаляются — иначе синхронизация не узнает об удалении.
 */

export type UUID = string;
/** ISO 4217, ЗАГЛАВНЫМИ: 'TJS', 'USD', 'EUR', 'RUB' */
export type CurrencyCode = string;
/** Целое число минорных единиц валюты (для TJS: 1 сомони = 100 дирам). Всегда Number.isSafeInteger. */
export type Minor = number;
/** Календарная дата 'YYYY-MM-DD' в часовом поясе пользователя */
export type IsoDate = string;
/** ISO 8601 UTC с миллисекундами: '2026-10-10T16:40:00.123Z' */
export type IsoDateTime = string;

/** Поля, общие для всех синхронизируемых сущностей. */
export interface SyncFields {
  id: UUID;
  createdAt: IsoDateTime;
  /**
   * Метка последней правки с часов устройства (монотонная в пределах устройства, см. db/clock.ts).
   * При конфликте побеждает большая пара (clientUpdatedAt, deviceId).
   */
  clientUpdatedAt: IsoDateTime;
  /** Устройство, сделавшее последнюю правку (случайный id установки). Нужен для детерминированного tie-break. */
  deviceId: string;
  /** Метка мягкого удаления; null = запись жива. */
  deletedAt: IsoDateTime | null;
}

/** Локальные служебные поля (в облако НЕ уходят). */
export interface LocalFields {
  /** 1 = есть правки, ещё не подтверждённые сервером (Dexie не умеет индексировать boolean). */
  dirty: 0 | 1;
  /**
   * server_seq последней увиденной версии (целое, растёт при каждой записи на сервере); null = ещё не синхронизирована.
   * Это курсор синхронизации. Метки времени для курсора НЕ используются (потеря точности, гонки коммитов).
   */
  serverSeq: number | null;
  /** Последняя ошибка отправки этой строки (карантин). null = ошибок нет. */
  syncError: string | null;
}

export type WalletKind = 'cash' | 'card' | 'bank' | 'savings' | 'other';

export interface Wallet extends SyncFields {
  name: string;
  currency: CurrencyCode;
  kind: WalletKind;
  /** Начальный остаток. Текущий остаток НИГДЕ не хранится — всегда считается из операций (см. domain/balances.ts). */
  openingBalanceMinor: Minor;
  color: string;
  icon: string;
  sortOrder: number;
  archivedAt: IsoDateTime | null;
}

export type CategoryKind = 'expense' | 'income';

export interface Category extends SyncFields {
  name: string;
  kind: CategoryKind;
  parentId: UUID | null;
  color: string;
  icon: string;
  sortOrder: number;
  archivedAt: IsoDateTime | null;
}

export type TxKind = 'expense' | 'income' | 'transfer';

export interface Transaction extends SyncFields {
  kind: TxKind;
  /** Кошелёк операции; для перевода — откуда списали. */
  walletId: UUID;
  /** Только перевод: куда зачислили (≠ walletId). Иначе null. */
  toWalletId: UUID | null;
  /** > 0. В валюте walletId (для перевода — сумма списания). */
  amountMinor: Minor;
  /** Только перевод: сумма зачисления в валюте toWalletId (> 0). Иначе null. */
  toAmountMinor: Minor | null;
  /** Для расхода/дохода — категория соответствующего вида; для перевода — null. */
  categoryId: UUID | null;
  occurredOn: IsoDate;
  note: string;
  /**
   * Снимок для отчётов: сумма в базовой валюте пользователя на МОМЕНТ внесения (курс не пересчитывается задним числом).
   * Для перевода = 0 (переводы не участвуют в аналитике доходов/расходов).
   */
  baseCurrency: CurrencyCode;
  baseAmountMinor: Minor;
  /** Единиц базовой валюты за 1 единицу валюты кошелька, использованных для снимка (1 если валюты совпадают). null для перевода. */
  fxRate: number | null;
  /** 'same' | 'nbt' | 'server' | 'api' | 'manual' | 'cached' — откуда взят курс. null для перевода. */
  fxSource: string | null;
}

/** Настройки пользователя. ОДНА строка на пользователя, id = id пользователя (чтобы устройства не плодили дубли). */
export interface Settings extends SyncFields {
  baseCurrency: CurrencyCode;
  locale: 'ru';
  /** 1 = понедельник */
  weekStartsOn: 0 | 1;
  defaultWalletId: UUID | null;
}

export type LocalRow<T> = T & LocalFields;

export type Entity = Wallet | Category | Transaction | Settings;

/**
 * Таблица курсов относительно «опорной» валюты (pivot): 1 единица X стоит perUnit[X] единиц pivot.
 * perUnit[pivot] === 1. Перекрёстный курс A→B = perUnit[A] / perUnit[B] (см. domain/rates.ts).
 */
export interface RateTable {
  asOf: IsoDate;
  pivot: CurrencyCode;
  perUnit: Record<CurrencyCode, number>;
  /** 'nbt' | 'server' | 'api' | 'manual' */
  source: string;
  fetchedAt: IsoDateTime;
}
