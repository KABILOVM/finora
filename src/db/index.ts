/** Модуль «data»: локальная база устройства, репозитории, хуки, затравка, резервная копия, примитивы синхронизации. */

export { openStore, type Store, type OpenStoreOptions } from './store';
export { StoreProvider, useOptionalStore, useStore } from './storeContext';

export { FinoraDB, META_LAST_SYNCED_AT, type MetaRow, type MetaValue } from './database';
export { FxRequiredError, ValidationError } from './errors';

export { createClock, type Clock, type ClockOptions } from './clock';
export { getDeviceId } from './deviceId';
export { newId, uuidV5, defaultId, isUuid } from './ids';

export type { WalletsRepo, WalletInput, WalletPatch } from './walletsRepo';
export type { CategoriesRepo, CategoryInput, CategoryPatch } from './categoriesRepo';
export type { TransactionsRepo, TransactionInput, TransactionPatch, TransactionCreateOptions } from './transactionsRepo';
export type { BudgetsRepo, BudgetInput } from './budgetsRepo';
export type { DebtsRepo, DebtInput, DebtPatch, DebtDeleteMode, DebtDeletion, DebtMerge } from './debtsRepo';
export type { RecurringRepo, RecurringInput, RecurringPatch } from './recurringRepo';
export type { ShoppingRepo, ShoppingInput, ShoppingPatch, PurchaseInput, PurchaseResult } from './shoppingRepo';
export type { SettingsRepo, SettingsPatch } from './settingsRepo';
export type { FromRuleOptions } from './transactionsRepo';
export * from './validatePlans';

export {
  filterTransactions,
  summarizeMonth,
  summarizeDay,
  groupByDay,
  type TxFilter,
  type MonthSummary,
  type CategoryTotal,
  type DayGroup,
} from './queries';
export {
  useWallets,
  useCategories,
  useTransactions,
  useBalances,
  useBalancesState,
  useSettings,
  useMonthSummary,
  useBudgets,
  useDebts,
  useRecurringRules,
  useShoppingItems,
  useReceipt,
  useDebtState,
  useDebtView,
  useUpcoming,
  useStoppedDebtPlans,
  BALANCES_OVERFLOW_MESSAGE,
  DEBT_OVERFLOW_MESSAGE,
  type BalancesState,
  type DebtView,
  type UpcomingItem,
} from './hooks';

export { stoppedDebtPlans } from './debtPlans';
export { ensureSeeded } from './seed';
export { countUserData } from './localData';
export { exportBackup, exportTransactionsCsv, importBackup, type BackupFile, type ImportOptions, type ImportResult } from './backup';

export type { SyncOps, SyncCounts, PushedRef, RemoteRow, ApplyResult } from './syncOps';
