import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useBalances, useSettings, useStore, useWallets } from '@/db';
import type { CurrencyCode, IsoDate } from '@/domain/types';
import { useDebtsData } from '@/features/debts/useDebtsData';
import { computeHomeTotal } from '@/features/home/homeData';
import { shiftMonth } from '@/features/transactions/txFilters';
import { monthKey } from '@/lib/dates';
import { useRates } from '@/rates/hooks';
import { computeNetWorth, walletHistory, type MonthBalance, type NetDebt, type NetWorth } from './netWorth';

/** Сколько месяцев на графике «деньги в кошельках по месяцам» (последний — текущий). */
export const HISTORY_MONTHS = 12;

export interface NetWorthData {
  base: CurrencyCode;
  net: NetWorth;
  history: MonthBalance[];
}

/** undefined — читается; null — показывать нечего (нет настроек или кошельков); { overflow } — суммы не помещаются в безопасное целое. */
export type NetWorthState = NetWorthData | { overflow: true } | null | undefined;

/**
 * Чистый капитал (кошельки + мне должны − я должен) и деньги в кошельках по месяцам. Итог по кошелькам — тот же `computeHomeTotal`,
 * что и «Всего» на главной, поэтому цифры сходятся. Остатки долгов берутся из `useDebtsData`; закрытые и архивные не входят.
 */
export function useNetWorth(today: IsoDate): NetWorthState {
  const store = useStore();
  const wallets = useWallets();
  const balances = useBalances();
  const settings = useSettings();
  const debts = useDebtsData();
  const { getRate } = useRates();
  const from = `${shiftMonth(monthKey(today), -(HISTORY_MONTHS - 1))}-01`;
  const rows = useLiveQuery(() => store.db.transactions.where('occurredOn').between(from, today, true, true).toArray(), [store, from, today]);

  return useMemo((): NetWorthState => {
    if (!wallets || !balances || settings === undefined || !debts || !rows) return undefined;
    if (settings === null || wallets.length === 0) return null;
    const base = settings.baseCurrency;
    try {
      const total = computeHomeTotal(wallets, balances, base, getRate);
      if (total === null) return { overflow: true };
      const open: NetDebt[] = [];
      for (const it of debts.items) {
        if (it.debt.closedAt !== null || it.debt.archivedAt !== null) continue;
        if (it.state === null) return { overflow: true };
        if (it.state.remainingMinor > 0) open.push({ direction: it.debt.direction, currency: it.debt.currency, remainingMinor: it.state.remainingMinor });
      }
      return {
        base,
        net: computeNetWorth({ wallets: total, debts: open, base, getRate: (from, to) => getRate(from, to)?.rate ?? null }),
        history: walletHistory(rows, total.totalMinor, today, HISTORY_MONTHS, base),
      };
    } catch (e) {
      if (e instanceof RangeError) return { overflow: true };
      throw e;
    }
  }, [wallets, balances, settings, debts, rows, getRate, today]);
}
