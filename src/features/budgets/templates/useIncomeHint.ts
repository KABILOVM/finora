import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeMonth, useStore } from '@/db';
import type { Minor } from '@/domain/types';
import { shiftMonth } from '@/features/transactions/txFilters';
import { monthKey } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';

const MONTHS = 3;

/** Середина набора чисел (медиана): один необычный месяц не сбивает подсказку. */
function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
}

/**
 * Обычный месячный доход по трём прошедшим месяцам (в основной валюте, медиана тех месяцев, где доход был): подсказка для шаблона лимитов.
 * undefined — считается; null — подсказать нечего (доходов не было, настроек нет или суммы не помещаются в расчёт).
 */
export function useIncomeHint(): Minor | null | undefined {
  const store = useStore();
  const current = monthKey(useToday());
  return useLiveQuery(async (): Promise<Minor | null> => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const months = Array.from({ length: MONTHS }, (_, i) => shiftMonth(current, -(i + 1)));
    const oldest = months[months.length - 1] ?? current;
    const rows = await store.db.transactions.where('occurredOn').between(`${oldest}-01`, `${months[0] ?? current}-31`, true, true).toArray();
    try {
      const incomes = months
        .map((m) =>
          summarizeMonth(
            rows.filter((t) => t.occurredOn.startsWith(m)),
            m,
            settings.baseCurrency,
          ).incomeMinor,
        )
        .filter((v) => v > 0);
      return incomes.length === 0 ? null : median(incomes);
    } catch (e) {
      if (e instanceof RangeError) return null;
      throw e;
    }
  }, [store, current]);
}
