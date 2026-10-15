import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { summarizeMonth, useStore, type MonthSummary } from '@/db';
import type { CurrencyCode, IsoDate } from '@/domain/types';
import { shiftMonth } from '@/features/transactions/txFilters';
import {
  categoryDeltas,
  monthlySeries,
  topExpenses,
  weekdayProfile,
  type CategoryDelta,
  type MonthPoint,
  type TopExpense,
  type WeekdayPoint,
} from './analytics';

/** Сколько месяцев показывает график «по месяцам» (выбранный и пять предыдущих). */
export const SERIES_MONTHS = 6;

export interface AnalyticsData {
  base: CurrencyCode;
  month: string;
  series: MonthPoint[];
  current: MonthSummary;
  previous: MonthSummary;
  deltas: CategoryDelta[];
  weekday: WeekdayPoint[];
  top: TopExpense[];
}

/** undefined — читается; null — настроек ещё нет; { overflow } — суммы не помещаются в безопасное целое. */
export type AnalyticsState = AnalyticsData | { overflow: true } | null | undefined;

/**
 * Всё для экрана «Аналитика» одним чтением базы (по индексу даты, только нужные месяцы), дальше — чистые расчёты (analytics.ts).
 * Основная валюта читается вместе с операциями: на кадр после её смены суммы не подпишутся старой валютой.
 */
export function useAnalyticsData(month: string, today: IsoDate): AnalyticsState {
  const store = useStore();
  const loaded = useLiveQuery(async () => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const rows = await store.db.transactions
      .where('occurredOn')
      .between(`${shiftMonth(month, -(SERIES_MONTHS - 1))}-01`, `${month}-31`, true, true)
      .toArray();
    return { base: settings.baseCurrency, rows };
  }, [store, month]);

  return useMemo((): AnalyticsState => {
    if (loaded === undefined || loaded === null) return loaded;
    const { base, rows } = loaded;
    try {
      const current = summarizeMonth(rows, month, base);
      const previous = summarizeMonth(rows, shiftMonth(month, -1), base);
      return {
        base,
        month,
        series: monthlySeries(rows, month, SERIES_MONTHS, base),
        current,
        previous,
        deltas: categoryDeltas(current.byCategory, previous.byCategory),
        weekday: weekdayProfile(rows, month, today, base),
        top: topExpenses(rows, month, base),
      };
    } catch (e) {
      if (e instanceof RangeError) return { overflow: true };
      throw e;
    }
  }, [loaded, month, today]);
}
