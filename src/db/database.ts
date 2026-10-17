import Dexie, { type DexieOptions, type EntityTable, type Table } from 'dexie';
import type { Budget, Category, Debt, LocalRow, RecurringRule, Settings, ShoppingItem, Transaction, Wallet } from '@/domain/types';
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
/**
 * Метка «таблицу надо забрать с сервера целиком». Пока она стоит, получение идёт с нуля, а не с курса: курс может переписать вкладка
 * со старой версией приложения, которая про метку не знает. Снимает метку только полный проход до конца таблицы (syncOps.finishResync).
 */
export const resyncKey = (table: SyncTableName): string => `resync:${table}`;

export function dbNameFor(userId: string): string {
  return `finora-v1-${userId}`;
}

/**
 * Локальная база устройства — источник истины для интерфейса (работает без сети).
 * У каждого пользователя на устройстве СВОЯ база: имя 'finora-v1-<userId>' (изоляция аккаунтов).
 *
 * Индексы:
 *  - dirty — что ждёт отправки; [dirty+clientUpdatedAt] — очередь отправки «старые первыми»;
 *  - transactions: occurredOn (периоды), walletId/toWalletId (история кошелька, проверки), categoryId,
 *    debtId (операции долга), recurringRuleId (операции по расписанию);
 *  - budgets: categoryId; debts: direction, closedAt, archivedAt; recurring_rules: startOn, archivedAt.
 *    shopping_items: purchasedAt (активные позиции), transactionId (чек расхода).
 *    (Пустые значения null в индекс IndexedDB не попадают — для запросов «по значению» это то, что нужно.)
 * Остатки кошельков и остатки долгов НЕ хранятся (считаются из операций, см. domain/balances.ts и domain/debts.ts).
 *
 * Версии схемы (имя базы не меняется — данные остаются на месте):
 *  - 1: настройки, кошельки, категории, операции;
 *  - 2: + budgets, debts, recurring_rules, индексы debtId и recurringRuleId у операций. Старым операциям в upgrade()
 *    проставляется debtId = null и recurringRuleId = null (новые поля договора обязательны, а не «может не быть»);
 *  - 3: + shopping_items (список покупок);
 *  - 4: у кошельков цель накопления (goalMinor, goalOn — без индексов). Старым кошелькам в upgrade() проставляется null;
 *  - 5: у настроек города для погоды (weather — без индексов). Старым настройкам в upgrade() проставляется null;
 *  - 6: кошельки и настройки забираются с сервера заново: в upgrade() удаляются курсоры cursor:wallets и cursor:settings, а строкам
 *    этих таблиц, уже видевшим сервер, serverSeq = 0 (dirty, dirtyGroups и dirtyBase не трогаются). Прежняя версия получала их,
 *    отбрасывая незнакомые колонки (цель, города), и без этого первая же правка стёрла бы цель или города на сервере.
 *    Новая колонка в TABLE_SPECS требует такой же версии для своей таблицы (страж — tests/db/dexieUpgrade.test.ts).
 */
export class FinoraDB extends Dexie {
  declare settings: EntityTable<LocalRow<Settings>, 'id'>;
  declare wallets: EntityTable<LocalRow<Wallet>, 'id'>;
  declare categories: EntityTable<LocalRow<Category>, 'id'>;
  declare transactions: EntityTable<LocalRow<Transaction>, 'id'>;
  declare debts: EntityTable<LocalRow<Debt>, 'id'>;
  declare budgets: EntityTable<LocalRow<Budget>, 'id'>;
  declare recurring_rules: EntityTable<LocalRow<RecurringRule>, 'id'>;
  declare shopping_items: EntityTable<LocalRow<ShoppingItem>, 'id'>;
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
    this.version(2)
      .stores({
        debts: 'id, dirty, direction, closedAt, archivedAt, [dirty+clientUpdatedAt]',
        budgets: 'id, dirty, categoryId, [dirty+clientUpdatedAt]',
        recurring_rules: 'id, dirty, startOn, archivedAt, [dirty+clientUpdatedAt]',
        transactions:
          'id, dirty, occurredOn, walletId, toWalletId, categoryId, debtId, recurringRuleId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
      })
      .upgrade((tx) =>
        tx
          .table('transactions')
          .toCollection()
          .modify((t: Record<string, unknown>) => {
            if (t['debtId'] === undefined) t['debtId'] = null;
            if (t['recurringRuleId'] === undefined) t['recurringRuleId'] = null;
          }),
      );
    this.version(3).stores({
      shopping_items: 'id, dirty, purchasedAt, transactionId, [dirty+clientUpdatedAt]',
    });
    this.version(4)
      .stores({})
      .upgrade((tx) =>
        tx
          .table('wallets')
          .toCollection()
          .modify((w: Record<string, unknown>) => {
            if (w['goalMinor'] === undefined) w['goalMinor'] = null;
            if (w['goalOn'] === undefined) w['goalOn'] = null;
          }),
      );
    this.version(5)
      .stores({})
      .upgrade((tx) =>
        tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s['weather'] === undefined) s['weather'] = null;
          }),
      );
    // Прежняя версия отбросила при получении незнакомые колонки, но запомнила курсор и серверную версию строки: без сброса повтор
    // отсёкся бы как уже виденный. serverSeq = 0, а не null: «строка на сервере есть» — правка сначала сверится с сервером
    // (base_seq 0 → конфликт → слияние по группам полей, см. syncMerge.ts), а с null ушла бы целиком, как созданная здесь.
    // Кошельки (цель накопления), настройки (города погоды) и операции (debtId и recurringRuleId — их не знала самая первая версия
    // с облаком). Метка resync держит повтор, даже если вкладка со старым кодом успеет записать курсор поверх сброса.
    this.version(6)
      .stores({})
      .upgrade(async (tx) => {
        const tables = ['wallets', 'settings', 'transactions'] as const;
        await tx.table('meta').bulkDelete(tables.map((t) => cursorKey(t)));
        await tx.table('meta').bulkPut(tables.map((t) => ({ key: resyncKey(t), value: true })));
        for (const name of tables) {
          await tx
            .table(name)
            .toCollection()
            .modify((r: Record<string, unknown>) => {
              if (typeof r['serverSeq'] === 'number') r['serverSeq'] = 0;
            });
        }
      });
  }

  /** Таблица синхронизируемой сущности по имени. */
  syncTable<T extends SyncTableName>(name: T): Table<LocalRow<EntityOf<T>>, string> {
    return this.table(name) as unknown as Table<LocalRow<EntityOf<T>>, string>;
  }

  /** Все таблицы с данными (без meta). */
  dataTables(): Table[] {
    return SYNC_TABLES.map((n) => this.table(n));
  }
}
