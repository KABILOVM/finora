import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useStore } from '@/db';
import { CALENDAR_DAYS, computeCashCalendar, type CashCalendar } from '@/domain/cashCalendar';
import { loadForecastData } from '@/features/budgets/useDailyForecast';
import { addDays } from '@/lib/dates';
import { useRates } from '@/rates/hooks';
import { useToday } from '@/recurring/useToday';

export interface CalendarOptions {
  /** Каждый день вычитать обычные траты. */
  includeUsual: boolean;
  /** Учесть, что «мне должны» вернут в срок. */
  includeReceivables: boolean;
}

/**
 * Денежный календарь на ближайшие CALENDAR_DAYS дней. Данные читаются тем же загрузчиком, что и прогноз «в день» (одним чтением базы,
 * с датами проведённых платежей на весь период); пересчитывается сам после любой записи, обновления курсов и смены даты.
 * undefined — считается; null — настроек ещё нет.
 */
export function useCashCalendar(options: CalendarOptions): CashCalendar | null | undefined {
  const store = useStore();
  const { getRate } = useRates();
  const today = useToday();
  const loaded = useLiveQuery(() => loadForecastData(store, today, addDays(today, CALENDAR_DAYS - 1)), [store, today]);
  const { includeUsual, includeReceivables } = options;
  return useMemo(() => {
    if (loaded === undefined || loaded === null) return loaded;
    if (loaded.overflow) return { status: 'overflow' } as const;
    return computeCashCalendar({
      ...loaded.data,
      getRate: (from, to) => getRate(from, to)?.rate ?? null,
      labels: loaded.labels,
      includeUsual,
      includeReceivables,
    });
  }, [loaded, getRate, includeUsual, includeReceivables]);
}
