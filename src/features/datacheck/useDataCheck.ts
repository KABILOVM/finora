import { useLiveQuery } from 'dexie-react-hooks';
import { useBalances, useStore, useWallets } from '@/db';
import type { CurrencyCode, IsoDate } from '@/domain/types';
import { addDays } from '@/lib/dates';
import { checkData, OUTLIER_DAYS, type DataCheck } from './dataCheck';

export interface DataCheckState {
  base: CurrencyCode;
  check: DataCheck;
}

/**
 * Результат «Проверки данных»: операции за год назад и все будущие (индекс даты), кошельки и остатки — в чистую checkData.
 * undefined — читается; null — настроек ещё нет. Живой запрос: исправили операцию — находка пропала.
 */
export function useDataCheck(today: IsoDate): DataCheckState | null | undefined {
  const store = useStore();
  const wallets = useWallets({ includeArchived: true });
  const balances = useBalances();
  const loaded = useLiveQuery(async () => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const txs = await store.db.transactions.where('occurredOn').aboveOrEqual(addDays(today, -OUTLIER_DAYS)).toArray();
    return { base: settings.baseCurrency, txs };
  }, [store, today]);
  if (loaded === undefined || !wallets || !balances) return undefined;
  if (loaded === null) return null;
  return { base: loaded.base, check: checkData({ txs: loaded.txs, wallets, balances, today, base: loaded.base }) };
}
