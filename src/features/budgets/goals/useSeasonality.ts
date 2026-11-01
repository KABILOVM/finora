import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeMonth, useStore } from '@/db';
import { seasonalHeadsUp, upcomingMonths, yearWindow, type SeasonalHint } from '@/domain/seasonality';
import type { CurrencyCode, IsoDate, Minor, Transaction } from '@/domain/types';
import { useToday } from '@/recurring/useToday';

/**
 * Сезонные месяцы до срока цели (расчёт — domain/seasonality.ts): расходы последних 12 полных месяцев читаются одним запросом по индексу
 * даты и сводятся по месяцам в основной валюте (как «Расходы месяца»: без операций по долгам, с комиссиями переводов). Пересчитывается сам
 * после любой записи в базу и за полночь. Читать нечего (срока нет, он в этом месяце или прошёл) — запрос в базу не делается.
 * undefined — читается; [] — подсказок нет (мало истории, суммы слишком большие, настроек нет).
 */
export function useSeasonality(base: CurrencyCode, dueOn: IsoDate | null): SeasonalHint[] | undefined {
  const store = useStore();
  const today = useToday();
  return useLiveQuery(async (): Promise<SeasonalHint[]> => {
    if (upcomingMonths(today, dueOn).length === 0) return [];
    const window = yearWindow(today);
    const first = window[0];
    const last = window[window.length - 1];
    if (first === undefined || last === undefined) return [];
    const rows = await store.db.transactions.where('occurredOn').between(`${first}-01`, `${last}-31`, true, true).toArray();
    const byMonth = new Map<string, Transaction[]>();
    for (const t of rows) {
      const month = t.occurredOn.slice(0, 7);
      const list = byMonth.get(month);
      if (list) list.push(t);
      else byMonth.set(month, [t]);
    }
    const totals = new Map<string, Minor>();
    try {
      for (const month of window) totals.set(month, summarizeMonth(byMonth.get(month) ?? [], month, base).expenseMinor);
    } catch (e) {
      if (e instanceof RangeError) return []; // суммы не помещаются в расчёт — подсказку просто не показываем
      throw e;
    }
    return seasonalHeadsUp(totals, today, dueOn, base);
  }, [store, today, dueOn, base]);
}
