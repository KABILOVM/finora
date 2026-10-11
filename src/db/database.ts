import Dexie, { type DexieOptions, type EntityTable, type Table } from 'dexie';
import type { Category, LocalRow, Settings, Transaction, Wallet } from '@/domain/types';
import { SYNC_TABLES, type EntityOf, type SyncTableName } from '@/sync/tables';

/** Служебное значение в таблице meta: курсоры синхронизации, lastSyncedAt, последняя метка часов. */
export type MetaValue = string | number | boolean | null;
export interface MetaRow {
  key: string;
  value: MetaValue;
}

export const META_LAST_STAMP = 'lastStamp';
export const META_LAST_SYNCED_AT = 'lastSyncedAt';
export const cursorKey = (table: SyncTableName): string => `cursor:${table}`;

export function dbNameFor(userId: string): string {
  return `finora-v1-${userId}`;
}

/**
 * Локальная база устройства — источник истины для интерфейса (работает без сети).
 * У каждого пользователя на устройстве СВОЯ база: имя 'finora-v1-<userId>' (изоляция аккаунтов).
 *
 * Индексы:
 *  - dirty — что ждёт отправки; [dirty+clientUpdatedAt] — очередь отправки «старые первыми»;
 *  - transactions: occurredOn (периоды), walletId/toWalletId (история кошелька, проверки), categoryId.
 * Остатки кошельков НЕ хранятся (считаются из операций, см. domain/balances.ts).
 */
export class FinoraDB extends Dexie {
  declare settings: EntityTable<LocalRow<Settings>, 'id'>;
  declare wallets: EntityTable<LocalRow<Wallet>, 'id'>;
  declare categories: EntityTable<LocalRow<Category>, 'id'>;
  declare transactions: EntityTable<LocalRow<Transaction>, 'id'>;
  declare meta: EntityTable<MetaRow, 'key'>;

  constructor(userId: string, options?: DexieOptions) {
    super(dbNameFor(userId), options);
    this.version(1).stores({
      settings: 'id, dirty, [dirty+clientUpdatedAt]',
      wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
      categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
      transactions:
        'id, dirty, occurredOn, walletId, toWalletId, categoryId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
      meta: 'key',
    });
  }

  /** Таблица синхронизируемой сущности по имени. */
  syncTable<T extends SyncTableName>(name: T): Table<LocalRow<EntityOf<T>>, string> {
    return this.table(name) as unknown as Table<LocalRow<EntityOf<T>>, string>;
  }

  /** Все четыре таблицы с данными (без meta). */
  dataTables(): Table[] {
    return SYNC_TABLES.map((n) => this.table(n));
  }
}
