import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useStore } from '@/db';
import type { CurrencyCode } from '@/domain/types';
import { buildReport, comparePeriod, type CompareMode, type Period, type PeriodReport } from './periods';

export interface PeriodReportData {
  base: CurrencyCode;
  report: PeriodReport;
}

/** undefined — читается или период не выбран; null — настроек ещё нет; { overflow } — суммы не помещаются в безопасное целое. */
export type PeriodReportState = PeriodReportData | { overflow: true } | null | undefined;

/**
 * Отчёт за период одним чтением базы: операции от начала более раннего из двух периодов (выбранного и сравниваемого) до конца выбранного,
 * по индексу даты. Дальше — чистые расчёты (periods.ts). Основная валюта читается вместе с операциями: на кадр после её смены суммы
 * не подпишутся старой валютой. `period` лучше передавать мемоизированным: от его смены зависит повторное чтение.
 */
export function usePeriodReport(period: Period | null, mode: CompareMode): PeriodReportState {
  const store = useStore();
  const loaded = useLiveQuery(async () => {
    if (!period) return undefined;
    const settings = await store.settings.get();
    if (!settings) return null;
    const cmp = comparePeriod(period, mode);
    const from = cmp && cmp.from < period.from ? cmp.from : period.from;
    const rows = await store.db.transactions.where('occurredOn').between(from, period.to, true, true).toArray();
    return { base: settings.baseCurrency, rows };
  }, [store, period, mode]);

  return useMemo((): PeriodReportState => {
    if (!period || loaded === undefined) return undefined;
    if (loaded === null) return null;
    try {
      return { base: loaded.base, report: buildReport(loaded.rows, period, mode, loaded.base) };
    } catch (e) {
      if (e instanceof RangeError) return { overflow: true };
      throw e;
    }
  }, [loaded, period, mode]);
}
