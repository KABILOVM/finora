import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeMonth, useStore } from '@/db';
import type { CurrencyCode, Minor } from '@/domain/types';
import { addDays, monthKey } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';
import { balanceSeries } from './homeData';

export interface HomeFlow {
  /** Доходы и расходы текущего месяца в базовой валюте (по снимкам суммы), включая операции с датой позже сегодняшней. */
  incomeMinor: Minor;
  expenseMinor: Minor;
  /** Остаток по дням за две недели (от старой точки к сегодняшней) или null, если посчитать нельзя. */
  series: Minor[] | null;
}

/** Данные для верхней карточки главной: итоги месяца и график остатка. */
export function useHomeFlow(endMinor: Minor | null, base: CurrencyCode): HomeFlow | undefined {
  const store = useStore();
  // Дата — состояние, а не чтение часов внутри запроса: за полночь (и 1-го числа) запрос пересоздаётся с новым месяцем и окном графика.
  const today = useToday();
  return useLiveQuery(async (): Promise<HomeFlow> => {
    const mk = monthKey(today);
    const monthStart = `${mk}-01`;
    const from = addDays(today, -13);
    // До конца месяца, а не до сегодня: «За месяц» учитывает и операции этого месяца, записанные на будущие дни (как бюджеты).
    // График берёт из них только дни по сегодняшний.
    const rows = await store.db.transactions
      .where('occurredOn')
      .between(from < monthStart ? from : monthStart, `${mk}-31`, true, true)
      .toArray();
    let incomeMinor = 0;
    let expenseMinor = 0;
    try {
      const m = summarizeMonth(rows, mk, base);
      incomeMinor = m.incomeMinor;
      expenseMinor = m.expenseMinor;
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
    return { incomeMinor, expenseMinor, series };
  }, [store, endMinor, base, today]);
}
