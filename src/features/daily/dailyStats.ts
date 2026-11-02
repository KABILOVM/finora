import {
  historyStart,
  isDailyCategory,
  periodAverage,
  periodOf,
  planFact,
  tripDaysOf,
  type DailyRules,
  type DailyTx,
  type PeriodAverage,
  type PeriodKind,
  type PlanFact,
  type Scope,
} from '@/domain/dailyAverage';
import type { Category, CurrencyCode, IsoDate, Minor, UUID } from '@/domain/types';
import { addDays } from '@/lib/dates';

/**
 * Всё, что показывают экраны «Траты в день»: средняя трата в день за сегодня / 7 / 30 дней / месяц, план-факт с накопленным запасом
 * и строки по каждой ежедневной категории. ЧИСТАЯ функция (без базы, React и часов) поверх domain/dailyAverage.ts: правила учёта,
 * поездки и «день без записей = ноль» описаны там. Бросает RangeError, если суммы не помещаются в безопасное целое.
 *
 * Общий дневной лимит — сумма лимитов «головных» ежедневных категорий (у которых нет ежедневного родителя), но только когда лимит
 * есть у каждой из них: иначе траты без лимита раздули бы общий факт, и сравнение с суммой лимитов врало бы.
 */

export type DailyCategory = Pick<Category, 'id' | 'name' | 'icon' | 'color' | 'parentId' | 'daily' | 'dailyLimitMinor' | 'archivedAt' | 'deletedAt'>;

export interface DailyLine {
  /** 'total' или id категории: ключ для списка. */
  key: string;
  /** null — строка «Все ежедневные». */
  categoryId: UUID | null;
  name: string;
  icon: string;
  color: string | null;
  /** Лимит в день; null — лимита нет. */
  limitPerDayMinor: Minor | null;
  today: PeriodAverage;
  week: PeriodAverage;
  last30: PeriodAverage;
  month: PeriodAverage;
  /** План / факт и запас месяца; null — лимита нет. */
  plan: PlanFact | null;
}

export interface DailyStats {
  base: CurrencyCode;
  today: IsoDate;
  /** Есть ли хотя бы одна живая ежедневная категория (не в архиве). Нет — экраны показывают только подсказку «как включить». */
  hasDaily: boolean;
  /** Все ежедневные категории вместе; лимит — сумма лимитов, если он есть у каждой головной категории. */
  total: DailyLine;
  /** Все расходы (включая крупные покупки, регулярные платежи и комиссии): для сравнения «а в целом». */
  everything: { today: PeriodAverage; week: PeriodAverage; last30: PeriodAverage; month: PeriodAverage };
  /** Ежедневные категории: сначала с лимитом (худшие впереди), потом без лимита по убыванию средней за месяц. */
  lines: DailyLine[];
  /** Сколько головных ежедневных категорий без лимита (из-за них нет общего лимита). */
  headsWithoutLimit: number;
}

export interface DailyStatsArgs {
  /** ВСЕ операции человека: по ним определяются и начало истории, и обычный день. */
  txs: readonly DailyTx[];
  categories: readonly DailyCategory[];
  today: IsoDate;
  base: CurrencyCode;
  /** Поездки (features/trips/trips.ts listTrips → firstOn / lastOn): их дни в среднее не идут. */
  tripRanges: readonly { firstOn: IsoDate; lastOn: IsoDate }[];
}

/** Сколько дней назад от сегодня читаем операции: «месяц» начинается не раньше чем 30 дней назад, «30 дней» — 29. С запасом. */
const LOOKBACK_DAYS = 40;

const PERIODS: readonly PeriodKind[] = ['today', 'week', 'last30', 'month'];

const STATUS_RANK = { over: 0, 'above-plan': 1, ok: 2 } as const;
const rankOf = (l: DailyLine): number => (l.plan !== null && l.plan.kind === 'plan' ? STATUS_RANK[l.plan.status] : 3);

export function buildDailyStats(args: DailyStatsArgs): DailyStats {
  const { txs, categories, today, base } = args;
  const live = categories.filter((c) => c.deletedAt === null);
  const flagged = live.filter((c) => c.daily === 1);
  const parentOf = new Map<UUID, UUID | null>(categories.map((c) => [c.id, c.parentId] as const));
  const dailyCategoryIds = new Set(flagged.map((c) => c.id));

  const windowFrom = addDays(today, -LOOKBACK_DAYS);
  const rules: DailyRules = {
    base,
    dailyCategoryIds,
    parentOf,
    skipDays: tripDaysOf(args.tripRanges, { from: windowFrom, to: today }),
  };
  // Начало истории считаем один раз по всем операциям, а в расчёт отдаём только недавние: так областей можно считать много
  const historyStartOn = historyStart(txs);
  const recent = txs.filter((t) => t.occurredOn >= windowFrom);

  const periodsOf = (scope: Scope, limit: Minor | null): Record<PeriodKind, PeriodAverage> => {
    const out = {} as Record<PeriodKind, PeriodAverage>;
    for (const kind of PERIODS) {
      out[kind] = periodAverage({ txs: recent, period: periodOf(kind, today), scope, rules, limitPerDayMinor: limit ?? undefined, historyStartOn });
    }
    return out;
  };

  const lineOf = (key: string, categoryId: UUID | null, meta: { name: string; icon: string; color: string | null }, scope: Scope, limit: Minor | null): DailyLine => {
    const p = periodsOf(scope, limit);
    return {
      key,
      categoryId,
      ...meta,
      limitPerDayMinor: limit,
      today: p.today,
      week: p.week,
      last30: p.last30,
      month: p.month,
      plan: limit === null ? null : planFact({ txs: recent, scope, limitPerDayMinor: limit, today, rules, historyStartOn }),
    };
  };

  // «Головные»: ежедневные категории без ежедневного родителя. Их лимиты и складываются в общий.
  const shown = flagged.filter((c) => c.archivedAt === null);
  const heads = shown.filter((c) => !isDailyCategory(c.parentId, rules));
  const headsWithoutLimit = heads.filter((c) => c.dailyLimitMinor === null || c.dailyLimitMinor === undefined).length;
  let totalLimit: Minor | null = null;
  if (heads.length > 0 && headsWithoutLimit === 0) {
    let sum = 0;
    for (const c of heads) {
      sum += c.dailyLimitMinor as number;
      if (!Number.isSafeInteger(sum)) throw new RangeError('Переполнение суммы');
    }
    totalLimit = sum;
  }

  const lines = shown.map((c) => lineOf(c.id, c.id, { name: c.name, icon: c.icon, color: c.color }, { kind: 'category', categoryId: c.id }, c.dailyLimitMinor ?? null));
  lines.sort((a, b) => rankOf(a) - rankOf(b) || (b.month.perDayMinor ?? 0) - (a.month.perDayMinor ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    base,
    today,
    hasDaily: shown.length > 0,
    total: lineOf('total', null, { name: 'Все ежедневные', icon: '🗓️', color: null }, { kind: 'daily' }, totalLimit),
    everything: periodsOf({ kind: 'all' }, null),
    lines,
    headsWithoutLimit,
  };
}
