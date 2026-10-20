import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeMonth, useStore } from '@/db';
import { shiftMonth } from '@/features/transactions/txFilters';
import { monthKey } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';
import type { MonthSpend } from './budgetHints';

/** Сколько прошедших месяцев смотрим для подсказки суммы лимита. */
export const HINT_MONTHS = 3;

/**
 * Траты трёх прошедших месяцев (от ближайшего к дальнему) в основной валюте — для подсказок «в прошлом месяце» и «обычно».
 * undefined — читается; null — настроек ещё нет; суммы не помещаются — пустой список (подсказок нет).
 */
export function useSpendingHistory(): MonthSpend[] | null | undefined {
  const store = useStore();
  const current = monthKey(useToday());
  return useLiveQuery(async (): Promise<MonthSpend[] | null> => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const months = Array.from({ length: HINT_MONTHS }, (_, i) => shiftMonth(current, -(i + 1)));
    const oldest = months[months.length - 1] ?? current;
    const rows = await store.db.transactions
      .where('occurredOn')
      .between(`${oldest}-01`, `${months[0] ?? current}-31`, true, true)
      .toArray();
    try {
      return months.map((month) => {
        const s = summarizeMonth(
          rows.filter((t) => t.occurredOn.startsWith(month)),
          month,
          settings.baseCurrency,
        );
        return { month, byCategory: s.byCategory, expenseMinor: s.expenseMinor, excludedCount: s.excludedCount };
      });
    } catch (e) {
      if (e instanceof RangeError) return [];
      throw e;
    }
  }, [store, current]);
}
