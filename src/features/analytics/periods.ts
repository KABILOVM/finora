import { summarizeDay, summarizeMonth, type CategoryTotal } from '@/db/queries';
import { isAdjustment } from '@/domain/adjustment';
import { daysBetween, floorDiv } from '@/domain/forecast';
import { addMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor } from '@/domain/types';
import { shiftMonth } from '@/features/transactions/txFilters';
import { addDays, isValidIsoDate, monthKey } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { categoryDeltas, type CategoryDelta, type MonthPoint } from './analytics';

/**
 * Отчёты за период: год, квартал или любые даты, и сравнение с другим периодом. Чистые расчёты (без React и без базы) по тем же
 * правилам учёта, что «Итоги месяца» и «Аналитика» (db/queries.ts): суммы по снимкам в основной валюте, переводы и операции по долгам
 * в доходы и расходы не входят (комиссия перевода — расход), операции в другой основной валюте пропускаются и считаются отдельно.
 * Бросают RangeError, если суммы не помещаются в безопасное целое — экран тогда пишет «суммы слишком большие».
 */

type Tx = Parameters<typeof summarizeDay>[0][number];

export type PeriodKind = 'year' | 'quarter' | 'custom';
export type CompareMode = 'prev' | 'yoy' | 'none';

/** Самый длинный свой период, дней: пять лет. Больше не читаем: список месяцев и память должны оставаться разумными. */
export const MAX_CUSTOM_DAYS = 1830;
/** Самый ранний год, который можно выбрать (как у выбора месяца в «Операциях»). */
export const MIN_YEAR = 2000;

export interface Period {
  kind: PeriodKind;
  /** Включительно. */
  from: IsoDate;
  /** Включительно; не позже сегодняшнего дня: будущего в отчёте нет. */
  to: IsoDate;
  /** Когда период закончится целиком (31 декабря, конец квартала); у своего периода совпадает с `to`. */
  fullEnd: IsoDate;
  /** Период ещё идёт: сегодня раньше его конца. */
  partial: boolean;
}

export interface ComparePeriod {
  from: IsoDate;
  to: IsoDate;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const lastDay = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a <= b ? a : b);

/** Тот же день и месяц в другом году; 29 февраля в невисокосном году — 28 февраля. */
export function shiftYear(date: IsoDate, delta: number): IsoDate {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const year = y + delta;
  return `${pad(year, 4)}-${pad(m)}-${pad(m === 2 && d === 29 && !isLeap(year) ? 28 : d)}`;
}

/** Целый календарный год. Будущий (позже сегодняшнего) — null. */
export function yearPeriod(year: number, today: IsoDate): Period | null {
  if (!Number.isInteger(year) || year < MIN_YEAR) return null;
  const from = `${pad(year, 4)}-01-01`;
  if (from > today) return null;
  const fullEnd = `${pad(year, 4)}-12-31`;
  const to = minDate(fullEnd, today);
  return { kind: 'year', from, to, fullEnd, partial: to < fullEnd };
}

/** Квартал 1–4 года `year`. Будущий — null. */
export function quarterPeriod(year: number, quarter: number, today: IsoDate): Period | null {
  if (!Number.isInteger(year) || year < MIN_YEAR || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) return null;
  const firstMonth = (quarter - 1) * 3 + 1;
  const from = `${pad(year, 4)}-${pad(firstMonth)}-01`;
  if (from > today) return null;
  const lastMonth = firstMonth + 2;
  const fullEnd = `${pad(year, 4)}-${pad(lastMonth)}-${pad(lastDay(year, lastMonth))}`;
  const to = minDate(fullEnd, today);
  return { kind: 'quarter', from, to, fullEnd, partial: to < fullEnd };
}

/**
 * Любые даты от `from` до `to` включительно. Конец позже сегодняшнего подрезается до сегодняшнего. null — даты не годятся:
 * не даты, конец раньше начала, начало в будущем или период длиннее MAX_CUSTOM_DAYS.
 */
export function customPeriod(from: unknown, to: unknown, today: IsoDate): Period | null {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return null;
  if (from < `${MIN_YEAR}-01-01` || from > to || from > today) return null;
  const end = minDate(to, today);
  if (daysBetween(from, end) + 1 > MAX_CUSTOM_DAYS) return null;
  return { kind: 'custom', from, to: end, fullEnd: end, partial: false };
}

/** Квартал (1–4) и год, в которые попадает дата. */
export function quarterOf(date: IsoDate): { year: number; quarter: number } {
  const [y = 0, m = 1] = date.split('-').map(Number);
  return { year: y, quarter: Math.floor((m - 1) / 3) + 1 };
}

/** Сколько дней в периоде (включая оба края). */
export const periodDays = (p: { from: IsoDate; to: IsoDate }): number => daysBetween(p.from, p.to) + 1;

/**
 * С чем сравниваем.
 *  - 'prev' — с предыдущим таким же периодом: год — с прошлым годом, квартал — с прошлым кварталом, свой период — с отрезком такой же
 *    длины, который шёл сразу перед ним. Идущий год или квартал сравнивается с тем же числом первых дней прошлого (а не с целым
 *    прошлым): иначе в начале года любые расходы выглядели бы «на 90% меньше».
 *  - 'yoy' — с тем же отрезком год назад (для года совпадает с 'prev').
 *  - 'none' — без сравнения (null).
 */
export function comparePeriod(p: Period, mode: CompareMode): ComparePeriod | null {
  if (mode === 'none') return null;
  if (mode === 'yoy' || p.kind === 'year') {
    if (p.kind === 'year' && mode === 'prev' && !p.partial) {
      return { from: shiftYear(p.from, -1), to: shiftYear(p.fullEnd, -1) };
    }
    const from = shiftYear(p.from, -1);
    // идущий год: те же числа прошлого года, а не 365 дней подряд: «31 декабря» не должно сползать из-за високосного года
    return { from, to: shiftYear(p.to, -1) };
  }
  if (p.kind === 'quarter') {
    const { year, quarter } = quarterOf(p.from);
    const prevYear = quarter === 1 ? year - 1 : year;
    const prevQuarter = quarter === 1 ? 4 : quarter - 1;
    const full = quarterPeriod(prevYear, prevQuarter, '9999-12-31');
    if (!full) return null;
    if (!p.partial) return { from: full.from, to: full.fullEnd };
    // идущий квартал: столько же дней от начала прошлого
    const to = addDays(full.from, periodDays(p) - 1);
    return { from: full.from, to: minDate(to, full.fullEnd) };
  }
  // свой период: такой же длины сразу перед ним
  const len = periodDays(p);
  const to = addDays(p.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

/** «в прошлом году», «за те же дни прошлого квартала», «за предыдущие 30 дней»: подставляется в «… было 5 000 с.» и «Больше, чем …». */
export function comparePhrase(p: Period, mode: CompareMode): string {
  if (mode === 'none') return '';
  if (mode === 'yoy' && p.kind !== 'year') return 'за тот же период год назад';
  if (p.kind === 'year') return p.partial ? 'за те же дни прошлого года' : 'в прошлом году';
  if (p.kind === 'quarter') return p.partial ? 'за те же дни прошлого квартала' : 'в прошлом квартале';
  const n = periodDays(p);
  return `за предыдущие ${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;
}

// ───────────────────────── итоги периода ─────────────────────────

export interface PeriodSummary {
  incomeMinor: Minor;
  expenseMinor: Minor;
  /** Доходы − расходы. */
  netMinor: Minor;
  /** Доля дохода, которая не потрачена, целым процентом (может быть отрицательной: потратили больше). null — доходов нет. */
  savingsRate: number | null;
  /** Расходы по категориям (комиссии переводов — отдельной строкой kind: 'fee'), от большего к меньшему. */
  expenseByCategory: CategoryTotal[];
  /** Доходы по категориям, от большего к меньшему; «без категории» — categoryId null. */
  incomeByCategory: CategoryTotal[];
  /** По месяцам периода (с неполными крайними): для графика. */
  months: MonthPoint[];
  /** Сколько операций пропущено: внесены в другой основной валюте. */
  excludedCount: number;
  /** Сколько дней в периоде. */
  days: number;
}

/**
 * Доля `part` от `total` целым процентом, округляя «от нуля» (50,5% → 51%, −50,5% → −51%). Точно, через BigInt. null — total не больше нуля.
 */
export function ratioPercent(part: Minor, total: Minor): number | null {
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || total <= 0) return null;
  const p = BigInt(part) * 100n;
  const t = BigInt(total);
  const half = t / 2n;
  return Number(p >= 0n ? (p + half) / t : -((-p + half) / t));
}

/** Максимум месяцев в графике периода (пять лет). */
const MAX_MONTHS = 61;

/** Доходы по категориям: обычные доходы в основной валюте, без долгов и корректировок остатка. */
function incomeCategories(txs: readonly Tx[], base: CurrencyCode): CategoryTotal[] {
  const byCat = new Map<string | null, Minor>();
  for (const t of txs) {
    if (t.deletedAt !== null || t.kind !== 'income' || t.baseCurrency !== base || t.debtId != null || isAdjustment(t)) continue;
    byCat.set(t.categoryId, addMinor(byCat.get(t.categoryId) ?? 0, t.baseAmountMinor));
  }
  return [...byCat.entries()]
    .map(([categoryId, totalMinor]) => ({ categoryId, totalMinor }))
    .sort((a, b) => {
      if (a.totalMinor !== b.totalMinor) return b.totalMinor - a.totalMinor;
      if (a.categoryId === b.categoryId) return 0;
      if (a.categoryId === null) return 1;
      if (b.categoryId === null) return -1;
      return a.categoryId < b.categoryId ? -1 : 1;
    });
}

/** Итоги операций за [from, to] включительно. */
export function summarizePeriod(txs: readonly Tx[], range: { from: IsoDate; to: IsoDate }, base: CurrencyCode): PeriodSummary {
  const inRange = txs.filter((t) => t.occurredOn >= range.from && t.occurredOn <= range.to);
  const s = summarizeDay(inRange, base);
  const months: MonthPoint[] = [];
  for (let m = monthKey(range.from); m <= monthKey(range.to) && months.length < MAX_MONTHS; m = shiftMonth(m, 1)) {
    const ms = summarizeMonth(inRange, m, base);
    months.push({ month: m, incomeMinor: ms.incomeMinor, expenseMinor: ms.expenseMinor, netMinor: addMinor(ms.incomeMinor, -ms.expenseMinor) });
  }
  const netMinor = addMinor(s.incomeMinor, -s.expenseMinor);
  return {
    incomeMinor: s.incomeMinor,
    expenseMinor: s.expenseMinor,
    netMinor,
    savingsRate: ratioPercent(netMinor, s.incomeMinor),
    expenseByCategory: s.byCategory,
    incomeByCategory: incomeCategories(inRange, base),
    months,
    excludedCount: s.excludedCount,
    days: periodDays(range),
  };
}

export interface PeriodReport {
  period: Period;
  current: PeriodSummary;
  /** null — сравнения нет (режим «без сравнения»). */
  compare: { range: ComparePeriod; summary: PeriodSummary } | null;
  /** Расходы по категориям против сравниваемого периода (без сравнения — только текущие, previousMinor 0). */
  expenseDeltas: CategoryDelta[];
  incomeDeltas: CategoryDelta[];
}

/** Весь отчёт: итоги периода, итоги сравниваемого и сдвиги по категориям. `txs` должны покрывать оба периода. */
export function buildReport(txs: readonly Tx[], period: Period, mode: CompareMode, base: CurrencyCode): PeriodReport {
  const current = summarizePeriod(txs, period, base);
  const range = comparePeriod(period, mode);
  const compare = range ? { range, summary: summarizePeriod(txs, range, base) } : null;
  return {
    period,
    current,
    compare,
    expenseDeltas: categoryDeltas(current.expenseByCategory, compare?.summary.expenseByCategory ?? []),
    incomeDeltas: categoryDeltas(current.incomeByCategory, compare?.summary.incomeByCategory ?? []),
  };
}

// ───────────────────────── «Куда ушёл доход» ─────────────────────────

export interface FlowSegment {
  /** Ключ категории: id, 'none' (без категории), 'fee' (комиссии) или 'rest' (всё остальное). */
  key: string;
  categoryId: string | null;
  kind?: 'fee' | 'rest';
  minor: Minor;
  /** Доля от всей полосы, 0–100 (не целым: для ширины сегмента). */
  share: number;
}

export interface IncomeFlow {
  /** Вся полоса: больший из дохода и расходов. */
  totalMinor: Minor;
  /** Самые крупные расходы по категориям и, если категорий больше, одним сегментом «остальное». */
  segments: FlowSegment[];
  /** Осталось (доход больше расходов), иначе 0. */
  savedMinor: Minor;
  /** Потрачено сверх дохода, иначе 0. */
  deficitMinor: Minor;
}

/** Сколько отдельных категорий в полосе, дальше — «остальное». */
export const FLOW_TOP = 5;

/**
 * Полоса «Куда ушёл доход»: расходы по категориям, остаток. Полоса — это весь доход; если расходы больше дохода, полоса — это все расходы,
 * а превышение показывается отдельно (deficitMinor). Без доходов и расходов полосы нет (null).
 */
export function incomeFlow(s: Pick<PeriodSummary, 'incomeMinor' | 'expenseMinor' | 'netMinor' | 'expenseByCategory'>, top = FLOW_TOP): IncomeFlow | null {
  const totalMinor = Math.max(s.incomeMinor, s.expenseMinor);
  if (totalMinor <= 0) return null;
  const share = (minor: Minor): number => Number((BigInt(minor) * 10000n) / BigInt(totalMinor)) / 100;
  const key = (c: CategoryTotal): string => (c.kind === 'fee' ? 'fee' : (c.categoryId ?? 'none'));
  const rows = s.expenseByCategory.filter((c) => c.totalMinor > 0);
  const head = rows.slice(0, top);
  const tail = rows.slice(top);
  const segments: FlowSegment[] = head.map((c) => ({
    key: key(c),
    categoryId: c.categoryId,
    ...(c.kind === 'fee' ? { kind: 'fee' as const } : {}),
    minor: c.totalMinor,
    share: share(c.totalMinor),
  }));
  if (tail.length > 0) {
    const rest = tail.reduce((sum, c) => addMinor(sum, c.totalMinor), 0);
    segments.push({ key: 'rest', categoryId: null, kind: 'rest', minor: rest, share: share(rest) });
  }
  return { totalMinor, segments, savedMinor: Math.max(s.netMinor, 0), deficitMinor: Math.max(-s.netMinor, 0) };
}

// ───────────────────────── главное за период ─────────────────────────

export interface PeriodHighlights {
  /** Месяц с самыми большими расходами; null — расходов нет. */
  peakExpenseMonth: MonthPoint | null;
  /** Месяц с самыми большими доходами; null — доходов нет. */
  peakIncomeMonth: MonthPoint | null;
  /** Самая крупная категория расходов (не комиссии); null — расходов по категориям нет. */
  topExpense: CategoryTotal | null;
  /** Средний расход в месяц по месяцам, в которых были расходы, вниз до целого; null — расходов нет. */
  avgMonthlyExpenseMinor: Minor | null;
}

/** Что отметить в итогах: самый затратный и самый доходный месяц, главная категория, средний расход в месяц. */
export function highlights(s: Pick<PeriodSummary, 'months' | 'expenseByCategory'>): PeriodHighlights {
  const pick = (key: 'incomeMinor' | 'expenseMinor'): MonthPoint | null => {
    let best: MonthPoint | null = null;
    for (const m of s.months) if (m[key] > 0 && (best === null || m[key] > best[key])) best = m;
    return best;
  };
  const withSpend = s.months.filter((m) => m.expenseMinor > 0);
  const total = withSpend.reduce((sum, m) => addMinor(sum, m.expenseMinor), 0);
  return {
    peakExpenseMonth: pick('expenseMinor'),
    peakIncomeMonth: pick('incomeMinor'),
    topExpense: s.expenseByCategory.find((c) => c.kind !== 'fee' && c.totalMinor > 0) ?? null,
    avgMonthlyExpenseMinor: withSpend.length > 0 ? floorDiv(total, withSpend.length) : null,
  };
}
