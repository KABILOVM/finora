import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeMonth, useStore } from '@/db';
import type { CurrencyCode, Minor } from '@/domain/types';
import { addDays, monthKey, todayLocal } from '@/lib/dates';
import { avgPerDay, balanceSeries } from './homeData';

export interface HomeFlow {
  /** Доходы и расходы текущего месяца в базовой валюте (по снимкам суммы). */
  incomeMinor: Minor;
  expenseMinor: Minor;
  /** Средний расход в день с начала месяца; null — расходов нет (или сумма не поместилась). */
  avgPerDayMinor: Minor | null;
  /** Остаток по дням за две недели (от старой точки к сегодняшней) или null, если посчитать нельзя. */
  series: Minor[] | null;
}

/** Данные для верхней карточки главной: итоги месяца и график остатка. */
export function useHomeFlow(endMinor: Minor | null, base: CurrencyCode): HomeFlow | undefined {
  const store = useStore();
  return useLiveQuery(async (): Promise<HomeFlow> => {
    const today = todayLocal();
    const mk = monthKey(today);
    const monthStart = `${mk}-01`;
    const from = addDays(today, -13);
    const rows = await store.db.transactions
      .where('occurredOn')
      .between(from < monthStart ? from : monthStart, today, true, true)
      .toArray();
    let incomeMinor = 0;
    let expenseMinor = 0;
    let avgPerDayMinor: Minor | null = null;
    try {
      const m = summarizeMonth(rows, mk, base);
      incomeMinor = m.incomeMinor;
      expenseMinor = m.expenseMinor;
      avgPerDayMinor = avgPerDay(m.expenseMinor, today);
    } catch {
      /* суммы не помещаются в безопасное целое — покажем нули, а не уроним экран */
    }
    let series: Minor[] | null = null;
    if (endMinor !== null) {
      try {
        series = balanceSeries(rows, endMinor, today, 14, base);
      } catch {
        series = null;
      }
    }
    return { incomeMinor, expenseMinor, avgPerDayMinor, series };
  }, [store, endMinor, base]);
}
