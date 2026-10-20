import { summarizeDay, summarizeMonth, type CategoryTotal, type MonthSummary } from '@/db/queries';
import { endOfMonth, floorDiv } from '@/domain/forecast';
import { MIN_PACE_DAYS } from '@/domain/pace';
import type { CurrencyCode, IsoDate, Minor, Transaction, UUID } from '@/domain/types';
import { shiftMonth } from '@/features/transactions/txFilters';
import { pluralRu } from '@/lib/plural';

/**
 * Чистые расчёты для экрана «Аналитика» (без React и без базы). Правила учёта те же, что у «Итогов месяца» (db/queries.ts):
 * суммы берутся по снимкам в основной валюте, переводы и операции по долгам в расходы не входят (комиссия перевода — расход),
 * операции со снимком в другой основной валюте пропускаются.
 * Бросают RangeError, если суммы не помещаются в безопасное целое — экран тогда пишет «суммы слишком большие», а не падает.
 */

type Tx = Parameters<typeof summarizeDay>[0][number];

export interface MonthPoint {
  /** 'ГГГГ-ММ' */
  month: string;
  incomeMinor: Minor;
  expenseMinor: Minor;
  /** Доходы − расходы. */
  netMinor: Minor;
}

/** Доходы, расходы и чистый поток по `count` месяцам, оканчивающимся месяцем `endMonth`; старые месяцы первыми. */
export function monthlySeries(txs: readonly Tx[], endMonth: string, count: number, base: CurrencyCode): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    const s = summarizeMonth(txs, month, base);
    out.push({ month, incomeMinor: s.incomeMinor, expenseMinor: s.expenseMinor, netMinor: s.incomeMinor - s.expenseMinor });
  }
  return out;
}

/**
 * Сколько дней прошлого месяца сравнивать с идущим: тех же, что уже прошли в этом (сегодняшний включён). null — сравниваем целиком:
 * месяц уже закончился, или прошло столько же дней, сколько в прошлом месяце (31 октября против 30 сентября).
 * Иначе в начале месяца неполный текущий месяц сравнивался бы с полным прошлым («на 85% меньше» только потому, что месяц начался).
 */
export function compareThroughDay(elapsedDays: number | null, previousMonth: string): number | null {
  if (elapsedDays === null) return null;
  const total = Number(endOfMonth(`${previousMonth}-01`).slice(8, 10));
  return elapsedDays < total ? Math.max(1, elapsedDays) : null;
}

/** Итоги месяца `month` только за дни с 1-го по `throughDay` (включительно). */
export function summarizeThroughDay(txs: readonly Tx[], month: string, throughDay: number, base: CurrencyCode): MonthSummary {
  const last = `${month}-${String(throughDay).padStart(2, '0')}`;
  const prefix = `${month}-`;
  return summarizeMonth(
    txs.filter((t) => t.occurredOn.startsWith(prefix) && t.occurredOn <= last),
    month,
    base,
  );
}

/**
 * Первые дни месяца с прошлым не сравниваем: одно-два числа против одного-двух дают «+1900%» и «новую» почти у каждой категории.
 * Порог тот же, что у прогноза «Темп трат» (MIN_PACE_DAYS).
 */
export const MIN_COMPARE_DAYS = MIN_PACE_DAYS;

/** Можно ли сравнивать: месяц закончился (сравниваем целиком) или прошло достаточно дней. */
export const isCompareReady = (throughDay: number | null): boolean => throughDay === null || throughDay >= MIN_COMPARE_DAYS;

/** С чем сравниваем: «в прошлом месяце» или «за те же 15 дней прошлого месяца». */
export function previousPhrase(throughDay: number | null): string {
  if (throughDay === null) return 'в прошлом месяце';
  if (throughDay === 1) return 'за первое число прошлого месяца';
  return `за те же ${throughDay} ${pluralRu(throughDay, 'день', 'дня', 'дней')} прошлого месяца`;
}

export type DeltaStatus = 'new' | 'later' | 'gone' | 'up' | 'down' | 'same';

export interface CategoryDelta {
  /** Для списка и ссылок: id категории, «none» (без категории) или «fee» (комиссии переводов). */
  key: string;
  categoryId: UUID | null;
  kind?: 'fee';
  currentMinor: Minor;
  previousMinor: Minor;
  /** current − previous (отрицательное — стали тратить меньше). */
  deltaMinor: Minor;
  /** Изменение в процентах от прошлого месяца (или его первых дней), целое; null — тогда трат не было. */
  percent: number | null;
  status: DeltaStatus;
}

const keyOf = (c: CategoryTotal): string => (c.kind === 'fee' ? 'fee' : (c.categoryId ?? 'none'));

/**
 * Расходы по категориям этого месяца против прошлого. «new» — в прошлом месяце не тратили, «gone» — в этом не тратите.
 * Идущий месяц сравнивается с первыми днями прошлого (`previous`), а `wholePrevious` — прошлый месяц целиком: категория, которой в
 * тех днях не было, но позже в прошлом месяце была, — «later», а не «new».
 * Порядок: больше трат в этом месяце — выше; ушедшие категории — в конце.
 */
export function categoryDeltas(current: readonly CategoryTotal[], previous: readonly CategoryTotal[], wholePrevious: readonly CategoryTotal[] = previous): CategoryDelta[] {
  const prev = new Map(previous.map((c) => [keyOf(c), c] as const));
  const spentBefore = new Set(wholePrevious.filter((c) => c.totalMinor > 0).map(keyOf));
  const seen = new Set<string>();
  const out: CategoryDelta[] = [];
  const push = (row: CategoryTotal, currentMinor: Minor, previousMinor: Minor) => {
    const deltaMinor = currentMinor - previousMinor;
    const status: DeltaStatus =
      previousMinor === 0
        ? spentBefore.has(keyOf(row)) ? 'later' : 'new'
        : currentMinor === 0 ? 'gone' : deltaMinor > 0 ? 'up' : deltaMinor < 0 ? 'down' : 'same';
    out.push({
      key: keyOf(row),
      categoryId: row.categoryId,
      ...(row.kind === 'fee' ? { kind: 'fee' as const } : {}),
      currentMinor,
      previousMinor,
      deltaMinor,
      percent: previousMinor === 0 ? null : Math.round((deltaMinor / previousMinor) * 100),
      status,
    });
  };
  for (const c of current) {
    seen.add(keyOf(c));
    push(c, c.totalMinor, prev.get(keyOf(c))?.totalMinor ?? 0);
  }
  for (const p of previous) if (!seen.has(keyOf(p))) push(p, 0, p.totalMinor);
  return out.sort((a, b) => b.currentMinor - a.currentMinor || b.previousMinor - a.previousMinor || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export interface WeekdayPoint {
  /** 0 — понедельник … 6 — воскресенье. */
  weekday: number;
  /** Расход во все такие дни месяца вместе. */
  totalMinor: Minor;
  /** Сколько таких дней уже было (в текущем месяце — до сегодняшнего включительно). */
  days: number;
  /** Средний расход за такой день, вниз до целого; 0, если таких дней ещё не было. */
  avgMinor: Minor;
}

/** День недели 'ГГГГ-ММ-ДД': 0 — понедельник … 6 — воскресенье. */
export function weekdayOf(date: IsoDate): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Сколько в среднем тратят в каждый день недели в месяце. Считаются только прошедшие дни (будущие в текущем месяце расходов
 * не имеют, и они бы занижали среднее): сегодняшний день входит, как и в «В среднем в день» на главной.
 */
export function weekdayProfile(txs: readonly Tx[], month: string, today: IsoDate, base: CurrencyCode): WeekdayPoint[] {
  const byDay = new Map<IsoDate, Tx[]>();
  const prefix = `${month}-`;
  for (const t of txs) {
    if (!t.occurredOn.startsWith(prefix)) continue;
    const list = byDay.get(t.occurredOn);
    if (list) list.push(t);
    else byDay.set(t.occurredOn, [t]);
  }
  const totals: Minor[] = Array.from({ length: 7 }, () => 0);
  const days: number[] = Array.from({ length: 7 }, () => 0);
  let last: number;
  if (today < `${month}-01`) last = 0; // месяц ещё не начался
  else if (today.startsWith(prefix)) last = Number(today.slice(8, 10)); // текущий — до сегодняшнего дня включительно
  else last = Number(endOfMonth(`${month}-01`).slice(8, 10)); // прошедший — целиком
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const w = weekdayOf(date);
    days[w]! += 1;
    totals[w] = totals[w]! + summarizeDay(byDay.get(date) ?? [], base).expenseMinor;
    if (!Number.isSafeInteger(totals[w])) throw new RangeError('Переполнение суммы');
  }
  return totals.map((totalMinor, weekday) => ({
    weekday,
    totalMinor,
    days: days[weekday]!,
    avgMinor: days[weekday]! > 0 ? floorDiv(totalMinor, days[weekday]!) : 0,
  }));
}

export interface TopExpense {
  id: UUID;
  occurredOn: IsoDate;
  categoryId: UUID | null;
  note: string;
  amountMinor: Minor;
}

/** Самые крупные расходы месяца: обычные расходы без долгов и переводов, в основной валюте; крупные первыми. */
export function topExpenses(
  txs: readonly (Tx & Pick<Transaction, 'id'>)[],
  month: string,
  base: CurrencyCode,
  limit = 5,
): TopExpense[] {
  const prefix = `${month}-`;
  return txs
    .filter((t) => t.deletedAt === null && t.kind === 'expense' && t.debtId == null && t.baseCurrency === base && t.occurredOn.startsWith(prefix))
    .map((t) => ({ id: t.id, occurredOn: t.occurredOn, categoryId: t.categoryId, note: t.note, amountMinor: t.baseAmountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor || (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0) || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;

/** 'ГГГГ-ММ' → «окт»: подпись под столбиком графика. */
export const monthShort = (month: string): string => MONTHS_SHORT[Number(month.slice(5, 7)) - 1] ?? month;

export const WEEKDAYS_SHORT_MON_FIRST = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
/** Для фразы «чаще всего тратите по …»: предложный падеж во множественном числе («по понедельникам»). */
export const WEEKDAYS_DATIVE_PLURAL = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'] as const;

