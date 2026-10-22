import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { summarizeMonth, useStore, type MonthSummary } from '@/db';
import { computeBudgetProgress } from '@/domain/budgetProgress';
import {
  budgetPace,
  MIN_PACE_DAYS,
  monthPace,
  projectMonthEnd,
  unusualCategories,
  type BudgetPace,
  type UnusualCategory,
} from '@/domain/pace';
import type { CurrencyCode, IsoDate, Minor, UUID } from '@/domain/types';
import { shiftMonth } from '@/features/transactions/txFilters';
import { findAnomalies, type Anomalies } from './anomalies';
import {
  categoryDeltas,
  compareThroughDay,
  isCompareReady,
  monthlySeries,
  summarizeThroughDay,
  topExpenses,
  weekdayProfile,
  type CategoryDelta,
  type MonthPoint,
  type TopExpense,
  type WeekdayPoint,
} from './analytics';

/** Сколько месяцев показывает график «по месяцам» (выбранный и пять предыдущих). */
export const SERIES_MONTHS = 6;

/** Прогноз расходов на конец идущего месяца. */
export interface PaceSummary {
  elapsedDays: number;
  totalDays: number;
  /** Расход к концу месяца при прежнем темпе. */
  projectedMinor: Minor;
  /** Расход прошлого месяца целиком (для сравнения). */
  previousMinor: Minor;
}

/** Лимит, который при прежнем темпе закончится раньше конца месяца. */
export interface BudgetPaceItem {
  id: UUID;
  /** null — общий лимит на все расходы. */
  categoryId: UUID | null;
  limitMinor: Minor;
  spentMinor: Minor;
  pace: Extract<BudgetPace, { status: 'will-exceed' }>;
}

export interface AnalyticsData {
  base: CurrencyCode;
  month: string;
  series: MonthPoint[];
  current: MonthSummary;
  /** Прошлый месяц целиком (для прогноза «Темп»). */
  previous: MonthSummary;
  /**
   * Что сравниваем: выбранный месяц по сегодняшний день включительно (операции с датой позже сегодняшней в сравнение не входят,
   * иначе отрезки были бы неравными). У прошедшего месяца — он весь, как `current`.
   */
  through: MonthSummary;
  /** С чем сравниваем расходы и категории: прошлый месяц за те же дни, что прошли в идущем (или целиком — compareDays null). */
  compare: MonthSummary;
  /** null — сравнение с прошлым месяцем целиком; число — первые столько дней прошлого месяца. */
  compareDays: number | null;
  deltas: CategoryDelta[];
  weekday: WeekdayPoint[];
  top: TopExpense[];
  /** Только для идущего месяца и когда прогноз уже что-то значит (прошло ≥ 3 дней, расходы есть); иначе null. */
  pace: PaceSummary | null;
  /** Только для идущего месяца: лимиты, которые не дотянут до конца месяца (раньше всех — первыми). */
  budgetPaces: BudgetPaceItem[];
  /** Только для идущего месяца: категории, где уже потрачено заметно больше обычного. */
  unusual: UnusualCategory[];
  /** Что бросается в глаза в расходах месяца: крупные траты, новые статьи, возможные дубли. */
  anomalies: Anomalies;
  /** Категории (все, включая архивные): названия в списках. */
  categories: ReadonlyMap<UUID, { name: string; icon: string; color: string }>;
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
    const [rows, budgets, categoryRows] = await Promise.all([
      store.db.transactions
        .where('occurredOn')
        .between(`${shiftMonth(month, -(SERIES_MONTHS - 1))}-01`, `${month}-31`, true, true)
        .toArray(),
      store.db.budgets.toArray(),
      store.db.categories.toArray(),
    ]);
    return { base: settings.baseCurrency, rows, budgets, categoryRows };
  }, [store, month]);

  return useMemo((): AnalyticsState => {
    if (loaded === undefined || loaded === null) return loaded;
    const { base, rows, budgets, categoryRows } = loaded;
    try {
      const current = summarizeMonth(rows, month, base);
      const previous = summarizeMonth(rows, shiftMonth(month, -1), base);
      const days = monthPace(month, today);
      // идущий месяц сравниваем с тем же отрезком прошлого, а не с целым прошлым месяцем
      const compareDays = compareThroughDay(days?.elapsedDays ?? null, shiftMonth(month, -1));
      const compare = compareDays === null ? previous : summarizeThroughDay(rows, shiftMonth(month, -1), compareDays, base);
      const through = days ? summarizeThroughDay(rows, month, days.elapsedDays, base) : current;
      let pace: PaceSummary | null = null;
      const budgetPaces: BudgetPaceItem[] = [];
      let unusual: UnusualCategory[] = [];
      if (days) {
        if (days.elapsedDays >= MIN_PACE_DAYS && current.expenseMinor > 0) {
          pace = { ...days, projectedMinor: projectMonthEnd(current.expenseMinor, days.elapsedDays, days.totalDays), previousMinor: previous.expenseMinor };
        }
        const progress = computeBudgetProgress({
          budgets,
          byCategory: current.byCategory,
          expenseMinor: current.expenseMinor,
          parentOf: new Map(categoryRows.map((c) => [c.id, c.parentId] as const)),
          base,
        });
        if (progress.ok) {
          for (const p of progress.items) {
            if (!p.comparable) continue;
            const bp = budgetPace({ limitMinor: p.limitMinor, spentMinor: p.spentMinor, ...days });
            if (bp.status === 'will-exceed') budgetPaces.push({ id: p.id, categoryId: p.categoryId, limitMinor: p.limitMinor, spentMinor: p.spentMinor, pace: bp });
          }
          budgetPaces.sort((a, b) => a.pace.exhaustDay - b.pace.exhaustDay || (a.id < b.id ? -1 : 1));
        }
        unusual = unusualCategories(
          current.byCategory,
          [1, 2, 3].map((i) => summarizeMonth(rows, shiftMonth(month, -i), base).byCategory),
        );
      }
      return {
        base,
        month,
        series: monthlySeries(rows, month, SERIES_MONTHS, base),
        current,
        previous,
        through,
        compare,
        compareDays,
        // в первые дни месяца сравнивать не с чем: только категории этого месяца, без «было/стало»
        deltas: isCompareReady(compareDays)
          ? categoryDeltas(through.byCategory, compare.byCategory, previous.byCategory)
          : categoryDeltas(through.byCategory, []),
        weekday: weekdayProfile(rows, month, today, base),
        top: topExpenses(rows, month, base),
        pace,
        budgetPaces,
        unusual,
        anomalies: findAnomalies(rows, month, today, base),
        categories: new Map(categoryRows.map((c) => [c.id, { name: c.name, icon: c.icon, color: c.color }] as const)),
      };
    } catch (e) {
      if (e instanceof RangeError) return { overflow: true };
      throw e;
    }
  }, [loaded, month, today]);
}
