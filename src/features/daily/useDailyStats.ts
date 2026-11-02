import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '@/db';
import { listTrips, type TripTx } from '@/features/trips/trips';
import { useToday } from '@/recurring/useToday';
import { buildDailyStats, type DailyStats } from './dailyStats';

/**
 * Траты в день для экрана: undefined — читается; null — настроек ещё нет; { overflow: true } — суммы не помещаются в безопасное
 * целое (экран показывает «проверьте данные», а не падает). Живой запрос: внесли операцию или поправили категорию — цифры обновились.
 */
export type DailyStatsState = { overflow: false; stats: DailyStats } | { overflow: true };

export function useDailyStats(): DailyStatsState | null | undefined {
  const store = useStore();
  const today = useToday();
  return useLiveQuery(async (): Promise<DailyStatsState | null> => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const [txs, categories] = await Promise.all([store.db.transactions.toArray(), store.db.categories.toArray()]);
    const base = settings.baseCurrency;
    try {
      // Поездка — метка #… в заметках: её дни в среднее не идут (дни считаются по первой и последней операции с меткой)
      const tripRanges = listTrips(txs as readonly TripTx[], base).map((t) => ({ firstOn: t.firstOn, lastOn: t.lastOn }));
      return { overflow: false, stats: buildDailyStats({ txs, categories, today, base, tripRanges }) };
    } catch (e) {
      if (e instanceof RangeError) return { overflow: true };
      throw e;
    }
  }, [store, today]);
}
