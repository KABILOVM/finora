import { useLiveQuery } from 'dexie-react-hooks';
import { computeBalances } from '@/domain/balances';
import type { Category, CategoryKind, LocalRow, Minor, Settings, Transaction, UUID, Wallet } from '@/domain/types';
import { filterTransactions, summarizeMonth, type MonthSummary, type TxFilter } from './queries';
import { sortByOrderThenName } from './sort';
import { useStore } from './storeContext';

/**
 * Живые запросы к локальной базе: экран сам обновляется после любой записи (в том числе из другой вкладки
 * и после загрузки с сервера). Пока данные грузятся, хук возвращает undefined.
 */

/** Кошельки по порядку (sortOrder, затем название по-русски). Архивные — только с includeArchived. */
export function useWallets(opts: { includeArchived?: boolean } = {}): LocalRow<Wallet>[] | undefined {
  const store = useStore();
  const includeArchived = opts.includeArchived === true;
  return useLiveQuery(async () => {
    const rows = await store.db.wallets.toArray();
    return sortByOrderThenName(rows.filter((w) => w.deletedAt === null && (includeArchived || w.archivedAt === null)));
  }, [store, includeArchived]);
}

/**
 * Категории по порядку, при желании только одного вида. Архивные скрыты; чтобы показать название категории
 * в старой операции, передайте { includeArchived: true }.
 */
export function useCategories(
  kind?: CategoryKind,
  opts: { includeArchived?: boolean } = {},
): LocalRow<Category>[] | undefined {
  const store = useStore();
  const includeArchived = opts.includeArchived === true;
  return useLiveQuery(async () => {
    const rows = await store.db.categories.toArray();
    return sortByOrderThenName(
      rows.filter(
        (c) => c.deletedAt === null && (includeArchived || c.archivedAt === null) && (kind === undefined || c.kind === kind),
      ),
    );
  }, [store, kind, includeArchived]);
}

/** Операции по фильтру, новые сверху. limit — сколько первых вернуть. Удалённые не показываются. */
export function useTransactions(
  filter: TxFilter = {},
  opts: { limit?: number } = {},
): LocalRow<Transaction>[] | undefined {
  const store = useStore();
  const { limit } = opts;
  // null («без категории») и undefined («любая») — разные фильтры, поэтому undefined в ключе заменён меткой
  const part = (v: unknown) => (v === undefined ? '\u2205' : v);
  const key = JSON.stringify(
    [filter.from, filter.to, filter.walletId, filter.categoryId, filter.kind, filter.search, limit].map(part),
  );
  return useLiveQuery(async () => {
    // период берём по индексу даты, остальное — чистым фильтром
    const rows = await store.db.transactions
      .where('occurredOn')
      .between(filter.from ?? '', filter.to ?? '￿', true, true)
      .toArray();
    const out = filterTransactions(rows, filter);
    return typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? out.slice(0, limit) : out;
  }, [store, key]);
}

/** Текущие остатки всех кошельков (включая архивные): начальный остаток ± живые операции. Нигде не хранятся. */
export function useBalances(): Map<UUID, Minor> | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const [wallets, txs] = await Promise.all([store.db.wallets.toArray(), store.db.transactions.toArray()]);
    return computeBalances(
      wallets.filter((w) => w.deletedAt === null),
      txs,
    );
  }, [store]);
}

/** Настройки пользователя. undefined — загружаются; null — ещё не созданы (до первой загрузки/затравки). */
export function useSettings(): LocalRow<Settings> | null | undefined {
  const store = useStore();
  return useLiveQuery(() => store.settings.get(), [store]);
}

/**
 * Итоги месяца ('ГГГГ-ММ') в базовой валюте. undefined — считается; null — настроек ещё нет,
 * базовая валюта неизвестна. Подробности — в queries.summarizeMonth.
 */
export function useMonthSummary(month: string): MonthSummary | null | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const rows = await store.db.transactions.where('occurredOn').between(`${month}-01`, `${month}-31`, true, true).toArray();
    return summarizeMonth(rows, month, settings.baseCurrency);
  }, [store, month]);
}
