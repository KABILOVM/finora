/** Модуль «data»: локальная база устройства, репозитории, хуки, затравка, резервная копия, примитивы синхронизации. */

export { openStore, type Store, type OpenStoreOptions } from './store';
export { StoreProvider, useStore } from './storeContext';

export { FinoraDB, type MetaRow, type MetaValue } from './database';
export { FxRequiredError, ValidationError } from './errors';

export { createClock, type Clock, type ClockOptions } from './clock';
export { getDeviceId } from './deviceId';
export { newId, uuidV5, defaultId, isUuid } from './ids';

export type { WalletsRepo, WalletInput, WalletPatch } from './walletsRepo';
export type { CategoriesRepo, CategoryInput, CategoryPatch } from './categoriesRepo';
export type { TransactionsRepo, TransactionInput, TransactionPatch, TransactionCreateOptions } from './transactionsRepo';
export type { SettingsRepo, SettingsPatch } from './settingsRepo';

export {
  filterTransactions,
  summarizeMonth,
  groupByDay,
  type TxFilter,
  type MonthSummary,
  type CategoryTotal,
  type DayGroup,
} from './queries';
export { useWallets, useCategories, useTransactions, useBalances, useSettings, useMonthSummary } from './hooks';

export { ensureSeeded } from './seed';
export { exportBackup, exportTransactionsCsv, importBackup, type BackupFile, type ImportResult } from './backup';

export type { SyncOps, SyncCounts, PushedRef, RemoteRow, ApplyResult } from './syncOps';
