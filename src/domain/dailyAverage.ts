import { addDays, isValidIsoDate } from '@/lib/dates';
import { isAdjustment } from './adjustment';
import { categoryCovers } from './budgetLevels';
import { daysBetween, endOfMonth, floorDiv } from './forecast';
import { isMinor } from './money';
import type { CurrencyCode, IsoDate, Minor, Transaction, UUID } from './types';

/**
 * «Средняя трата в день» и «план / факт на сегодня» — ЧИСТЫЕ функции (без базы, без React, без часов: «сегодня» передаёт вызывающий).
 *
 * Траты делятся на три набора (их называют «область», Scope):
 *   all      — все расходы по правилам «Итогов месяца» (db/queries.ts): расход, не долг, не корректировка остатка, в основной валюте,
 *              плюс комиссии переводов. Регулярные платежи (аренда, подписки) тоже здесь.
 *   daily    — только «ежедневные»: расход в категории с флажком «ежедневная» (флажок действует и на подкатегории), внесённый
 *              человеком (не по расписанию). Крупные разовые покупки, «Без категории» и «Комиссии» сюда не попадают.
 *   category — расходы одной категории и её подкатегорий, внесённые человеком (не по расписанию).
 *
 * Как считается среднее:
 *   · делим на ВСЕ календарные дни периода, а день без записей считается днём с нулём (человек вносит траты каждый день);
 *   · дни, указанные в skipDays (поездки), не считаются совсем: ни их траты, ни сами дни в знаменатель не идут;
 *   · дни раньше самой первой операции человека не считаются: у нового пользователя «последние 30 дней» — это его настоящие дни.
 *
 * План / факт: лимит в день означает «в среднем не больше L». Поэтому экономия копится в пределах месяца: запас = L × (дни месяца
 * по сегодня) − потрачено по сегодня. Красным считается накопленный минус, а не один дорогой день.
 *
 * Все деления целочисленные, округление вниз (как везде в приложении); суммы, не помещающиеся в безопасное целое, — RangeError.
 */

/** Операция в том виде, как она нужна расчёту (подходит и LocalRow<Transaction>). */
export type DailyTx = Pick<Transaction, 'kind' | 'categoryId' | 'baseCurrency' | 'baseAmountMinor' | 'occurredOn' | 'deletedAt'> & {
  debtId?: UUID | null | undefined;
  recurringRuleId?: UUID | null | undefined;
  /** 'adjust' — «Корректировка остатка»; нет поля = обычная операция. */
  fxSource?: string | null | undefined;
};

export interface DailyRules {
  /** Основная валюта: в ней посчитаны снимки сумм. Операции в другой базовой валюте не смешиваем. */
  base: CurrencyCode;
  /** Категории с флажком «ежедневная». */
  dailyCategoryIds: ReadonlySet<UUID>;
  /** Категория → родитель. Нужны ВСЕ категории, в том числе архивные (у старых трат категория могла уйти в архив). */
  parentOf: ReadonlyMap<UUID, UUID | null>;
  /** Дни, которые не считаем (поездки): см. tripDaysOf. */
  skipDays?: ReadonlySet<IsoDate> | undefined;
}

export type Scope = { kind: 'all' } | { kind: 'daily' } | { kind: 'category'; categoryId: UUID };

export type PeriodKind = 'today' | 'week' | 'last30' | 'month';

export interface Period {
  kind: PeriodKind;
  from: IsoDate;
  to: IsoDate;
}

/** Защита: перепутанный период не должен зациклить расчёт. Самый длинный настоящий период — месяц. */
const MAX_WINDOW_DAYS = 400;

/** Периоды, которые показываем: сегодня; последние 7 и 30 дней (с сегодняшним); месяц с первого числа по сегодня. */
export function periodOf(kind: PeriodKind, today: IsoDate): Period {
  if (!isValidIsoDate(today)) throw new RangeError(`Некорректная дата: ${String(today)}`);
  switch (kind) {
    case 'today':
      return { kind, from: today, to: today };
    case 'week':
      return { kind, from: addDays(today, -6), to: today };
    case 'last30':
      return { kind, from: addDays(today, -29), to: today };
    case 'month':
      return { kind, from: `${today.slice(0, 7)}-01`, to: today };
  }
}

/** Все даты от `from` до `to` включительно. Пусто, если `to` раньше `from`. */
function dayList(from: IsoDate, to: IsoDate): IsoDate[] {
  const n = daysBetween(from, to) + 1;
  if (n <= 0) return [];
  if (n > MAX_WINDOW_DAYS) throw new RangeError(`Период слишком длинный: ${String(n)} дн.`);
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

/**
 * Дни поездок для skipDays: от первой до последней операции каждой поездки включительно (поездка — метка в заметках,
 * см. features/trips/trips.ts; сюда передают её firstOn / lastOn). Некорректные и перевёрнутые диапазоны пропускаются.
 */
export function tripDaysOf(ranges: readonly { firstOn: IsoDate; lastOn: IsoDate }[]): Set<IsoDate> {
  const out = new Set<IsoDate>();
  for (const r of ranges) {
    if (!isValidIsoDate(r.firstOn) || !isValidIsoDate(r.lastOn) || r.lastOn < r.firstOn) continue;
    for (const d of dayList(r.firstOn, r.lastOn)) out.add(d);
  }
  return out;
}

/** Дата самой ранней живой операции любого вида; null — операций нет. С неё начинается «история» человека. */
export function historyStart(txs: readonly Pick<DailyTx, 'occurredOn' | 'deletedAt'>[]): IsoDate | null {
  let first: IsoDate | null = null;
  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    if (first === null || t.occurredOn < first) first = t.occurredOn;
  }
  return first;
}

/** Ежедневная ли категория: флажок на ней самой или на любом из её родителей. Петля в данных (A → B → A) не зацикливает. */
export function isDailyCategory(categoryId: UUID | null, rules: Pick<DailyRules, 'dailyCategoryIds' | 'parentOf'>): boolean {
  const seen = new Set<UUID>();
  let cur = categoryId;
  while (cur !== null && !seen.has(cur)) {
    if (rules.dailyCategoryIds.has(cur)) return true;
    seen.add(cur);
    cur = rules.parentOf.get(cur) ?? null;
  }
  return false;
}

interface Spend {
  categoryId: UUID | null;
  minor: Minor;
  /** Комиссия перевода: считается только в «все расходы». */
  fee: boolean;
  /** Внесена человеком, а не создана регулярным платежом. */
  manual: boolean;
}

/** Расход, который считается тратой, или null (доход, перевод без комиссии, долг, корректировка, удалённая, чужая базовая валюта). */
function spendOf(t: DailyTx, base: CurrencyCode): Spend | null {
  if (t.deletedAt !== null) return null;
  if (!isMinor(t.baseAmountMinor) || t.baseAmountMinor <= 0) return null;
  if (t.baseCurrency !== base) return null;
  if (t.kind === 'transfer') return { categoryId: null, minor: t.baseAmountMinor, fee: true, manual: false };
  if (t.kind !== 'expense') return null;
  if ((t.debtId ?? null) !== null || isAdjustment(t)) return null;
  return { categoryId: t.categoryId, minor: t.baseAmountMinor, fee: false, manual: (t.recurringRuleId ?? null) === null };
}

/** Сколько из траты идёт в данную область (0 — не идёт). */
function shareOf(s: Spend, scope: Scope, rules: DailyRules): Minor {
  switch (scope.kind) {
    case 'all':
      return s.minor;
    case 'daily':
      return s.manual && !s.fee && s.categoryId !== null && isDailyCategory(s.categoryId, rules) ? s.minor : 0;
    case 'category':
      return s.manual && !s.fee && s.categoryId !== null && categoryCovers(scope.categoryId, s.categoryId, rules.parentOf) ? s.minor : 0;
  }
}

/** Траты области по дням: для каждого дня из `days` — сумма (дни без трат — 0). Порядок как в `days`. */
function amountsByDay(txs: readonly DailyTx[], scope: Scope, rules: DailyRules, days: readonly IsoDate[]): Minor[] {
  const sums = new Map<IsoDate, Minor>(days.map((d) => [d, 0]));
  for (const t of txs) {
    const cur = sums.get(t.occurredOn);
    if (cur === undefined) continue;
    const s = spendOf(t, rules.base);
    if (s === null) continue;
    const add = shareOf(s, scope, rules);
    if (add === 0) continue;
    const next = cur + add;
    if (!Number.isSafeInteger(next)) throw new RangeError('Переполнение суммы');
    sums.set(t.occurredOn, next);
  }
  return days.map((d) => sums.get(d) ?? 0);
}

/** Считаемые дни периода: без дней до начала истории и без skipDays. skippedDays — сколько дней периода пропущено из-за skipDays. */
function countedDays(period: Period, rules: DailyRules, start: IsoDate | null): { days: IsoDate[]; skippedDays: number; from: IsoDate } {
  if (start === null) return { days: [], skippedDays: 0, from: period.from }; // операций нет вовсе: среднего ещё нет
  const from = start > period.from ? start : period.from;
  const all = dayList(from, period.to);
  const skip = rules.skipDays;
  if (!skip || skip.size === 0) return { days: all, skippedDays: 0, from };
  const days = all.filter((d) => !skip.has(d));
  return { days, skippedDays: all.length - days.length, from };
}

/** Нижняя медиана (при чётном числе — меньшая из двух средних), как в anomalies.ts. */
function medianOf(values: readonly Minor[]): Minor {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

export interface PeriodAverage {
  period: Period;
  /** С какого дня реально считаем (не раньше начала истории). */
  from: IsoDate;
  /** Сколько дней в знаменателе: дни периода без поездок и без дней до первой операции. */
  days: number;
  /** Сколько дней периода пропущено из-за поездок. */
  skippedDays: number;
  totalMinor: Minor;
  /** Средняя трата в день (вниз до целого). null — считать нечего (ни одного считаемого дня). */
  perDayMinor: Minor | null;
  /** «Обычный день»: медиана дневных сумм (дни без трат — нули). null — считать нечего. */
  medianDayMinor: Minor | null;
  /** В скольких считаемых днях потратили не больше лимита (если лимит передан). */
  daysWithinLimit: number | null;
}

export interface PeriodAverageArgs {
  /** ВСЕ операции человека: по ним определяется и начало истории. */
  txs: readonly DailyTx[];
  period: Period;
  scope: Scope;
  rules: DailyRules;
  /** Дневной лимит этой области: для «в скольких днях уложились». */
  limitPerDayMinor?: Minor | undefined;
}

/** Средняя трата в день за период по области. */
export function periodAverage(args: PeriodAverageArgs): PeriodAverage {
  const { txs, period, scope, rules, limitPerDayMinor } = args;
  const { days, skippedDays, from } = countedDays(period, rules, historyStart(txs));
  const amounts = amountsByDay(txs, scope, rules, days);
  let total = 0;
  for (const a of amounts) {
    total += a;
    if (!Number.isSafeInteger(total)) throw new RangeError('Переполнение суммы');
  }
  const limit = limitPerDayMinor !== undefined && isMinor(limitPerDayMinor) && limitPerDayMinor > 0 ? limitPerDayMinor : null;
  return {
    period,
    from,
    days: days.length,
    skippedDays,
    totalMinor: total,
    perDayMinor: days.length > 0 ? floorDiv(total, days.length) : null,
    medianDayMinor: days.length > 0 ? medianOf(amounts) : null,
    daysWithinLimit: limit !== null && days.length > 0 ? amounts.filter((a) => a <= limit).length : null,
  };
}

/** Как идёт месяц относительно плана. */
export type PlanStatus =
  /** Запас не отрицательный и сегодня в пределах дневного плана. */
  | 'ok'
  /** Сегодня потрачено больше дневного плана, но накопленный запас это покрывает. */
  | 'above-plan'
  /** Накопленный минус: в среднем за месяц лимит уже превышен. */
  | 'over';

export type PlanFact =
  /** Не считаем: сегодня день поездки или у человека ещё нет операций. */
  | { kind: 'unavailable'; reason: 'trip' | 'no-history' }
  | {
      kind: 'plan';
      limitPerDayMinor: Minor;
      /** Потрачено сегодня. */
      todaySpentMinor: Minor;
      /** Лимит минус потрачено сегодня; отрицательное — сегодня выше дневного плана. */
      todayLeftMinor: Minor;
      /** Сколько дней месяца считаем (по сегодня включительно, без поездок и дней до первой операции). */
      monthDays: number;
      /** План с начала месяца: лимит × monthDays. */
      planToDateMinor: Minor;
      spentToDateMinor: Minor;
      /** Накопленный запас: план − потрачено. Отрицательный — накопленный перерасход. */
      reserveMinor: Minor;
      status: PlanStatus;
    };

export interface PlanFactArgs {
  txs: readonly DailyTx[];
  scope: Scope;
  /** Дневной лимит области: целое > 0. */
  limitPerDayMinor: Minor;
  today: IsoDate;
  rules: DailyRules;
}

/** План / факт на сегодня и накопленный запас месяца. */
export function planFact(args: PlanFactArgs): PlanFact {
  const { txs, scope, limitPerDayMinor, today, rules } = args;
  if (!isMinor(limitPerDayMinor) || limitPerDayMinor <= 0) throw new RangeError(`Некорректный дневной лимит: ${String(limitPerDayMinor)}`);
  const period = periodOf('month', today);
  if (rules.skipDays?.has(today)) return { kind: 'unavailable', reason: 'trip' };
  const start = historyStart(txs);
  if (start === null || start > today) return { kind: 'unavailable', reason: 'no-history' };

  const { days } = countedDays(period, rules, start);
  const amounts = amountsByDay(txs, scope, rules, days);
  let spentToDate = 0;
  for (const a of amounts) {
    spentToDate += a;
    if (!Number.isSafeInteger(spentToDate)) throw new RangeError('Переполнение суммы');
  }
  const todaySpent = amounts[days.length - 1] ?? 0; // today — последний из считаемых дней: поездку сегодня мы уже отсекли
  const planToDate = limitPerDayMinor * days.length;
  if (!Number.isSafeInteger(planToDate)) throw new RangeError('Переполнение суммы');
  const reserve = planToDate - spentToDate;
  const status: PlanStatus = reserve < 0 ? 'over' : todaySpent > limitPerDayMinor ? 'above-plan' : 'ok';
  return {
    kind: 'plan',
    limitPerDayMinor,
    todaySpentMinor: todaySpent,
    todayLeftMinor: limitPerDayMinor - todaySpent,
    monthDays: days.length,
    planToDateMinor: planToDate,
    spentToDateMinor: spentToDate,
    reserveMinor: reserve,
    status,
  };
}

/** Сколько дней в месяце 'ГГГГ-ММ'. */
export function daysInMonth(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError(`Месяц должен быть в виде ГГГГ-ММ, получено: ${String(month)}`);
  return Number(endOfMonth(`${month}-01`).slice(8, 10));
}

/**
 * «Две формы одного лимита»: месячный лимит в дневной и обратно для данного месяца. Дневной из месячного округляется вниз
 * (1200 на 31 день = 38, а не 38,7): лимит никогда не больше заданного.
 */
export function dailyFromMonthly(monthlyMinor: Minor, month: string): Minor {
  return floorDiv(monthlyMinor, daysInMonth(month));
}

export function monthlyFromDaily(dailyMinor: Minor, month: string): Minor {
  if (!isMinor(dailyMinor) || dailyMinor < 0) throw new RangeError(`Некорректная сумма: ${String(dailyMinor)}`);
  const total = dailyMinor * daysInMonth(month);
  if (!Number.isSafeInteger(total)) throw new RangeError('Переполнение суммы');
  return total;
}
