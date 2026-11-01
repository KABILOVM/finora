import { factorOf } from './currency';
import type { CurrencyCode, IsoDate, Minor } from './types';

/**
 * Сезонные траты — ЧИСТЫЕ функции (без базы, React и часов): предупредить, что до срока цели впереди месяц, в котором год назад
 * расходов было заметно больше обычного (праздники, отпуск, учебный год), и посоветовать заложить запас. Числа плана целей это НЕ
 * меняет (domain/savingsPlan.ts): здесь только предупреждение со ссылкой на прошлый год.
 *
 *  1. Исходные данные — расходы по месяцам ('ГГГГ-ММ' → сумма в основной валюте, как в итогах месяца). «Год» — 12 полных месяцев перед
 *     текущим. «Обычно» — среднее по тем месяцам года, где расходы были (пустой месяц среднее не занижает). Меньше
 *     SEASON_MIN_ACTIVE_MONTHS месяцев с расходами — истории мало, подсказок нет.
 *  2. Предмет — месяцы после текущего до месяца срока включительно, не больше SEASON_MAX_MONTHS (считая от текущего). Срок в текущем
 *     месяце или прошёл, срока нет — подсказок нет. Для каждого берём тот же календарный месяц год назад.
 *  3. Месяц «сезонный», если год назад расходов в нём было не меньше SEASON_RATIO_PERCENT % от обычного, а превышение не меньше порога
 *     (SEASON_MIN_EXTRA_PERCENT % от обычного, но не меньше одной основной единицы валюты).
 *  4. Целочисленно (BigInt), вниз. Переполнение безопасных целых — пустой результат, а не исключение.
 */

/** Сколько месяцев вперёд (считая от текущего) смотрим. */
export const SEASON_MAX_MONTHS = 3;
/** Сколько из последних 12 месяцев должны быть с расходами, чтобы «обычно» что-то значило. */
export const SEASON_MIN_ACTIVE_MONTHS = 9;
/** Месяц сезонный, если в нём год назад потратили не меньше стольких процентов от обычного. */
export const SEASON_RATIO_PERCENT = 125;
/** …и превышение не меньше стольких процентов от обычного (ещё не меньше одной основной единицы валюты). */
export const SEASON_MIN_EXTRA_PERCENT = 5;

export interface SeasonalHint {
  /** Будущий месяц 'ГГГГ-ММ', о котором предупреждаем. */
  month: string;
  /** Сколько потратили в этом месяце год назад. */
  yearAgoMinor: Minor;
  /** Сколько обычно тратят за месяц (среднее по месяцам года с расходами). */
  averageMinor: Minor;
  /** Насколько год назад было больше обычного: yearAgo − average. */
  extraMinor: Minor;
  /** На сколько процентов выше обычного, целое вниз. */
  percent: number;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function toMinor(v: bigint): Minor {
  if (v > MAX || v < -MAX) throw new RangeError('Переполнение суммы');
  return Number(v);
}

/** Сдвиг месяца 'ГГГГ-ММ' на n месяцев (можно отрицательное). Некорректный месяц — RangeError. */
export function shiftMonthKey(key: string, delta: number): string {
  const m = MONTH_RE.exec(key);
  if (!m) throw new RangeError(`Месяц должен быть в виде ГГГГ-ММ: ${String(key)}`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const y = Math.floor(total / 12);
  return `${String(y).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Месяцы, о которых предупреждаем: после текущего до месяца срока включительно, не больше SEASON_MAX_MONTHS от текущего.
 * Нет срока, срок в текущем месяце или раньше, нечитаемая дата — пусто.
 */
export function upcomingMonths(today: IsoDate, dueOn: IsoDate | null): string[] {
  if (dueOn === null || !DATE_RE.test(today) || !DATE_RE.test(dueOn)) return [];
  const current = today.slice(0, 7);
  const due = dueOn.slice(0, 7);
  if (due <= current) return [];
  const out: string[] = [];
  for (let i = 1; i <= SEASON_MAX_MONTHS; i++) {
    const month = shiftMonthKey(current, i);
    if (month > due) break;
    out.push(month);
  }
  return out;
}

/** 12 полных месяцев перед текущим (от самого раннего к последнему): «год», по которому считается обычное. */
export function yearWindow(today: IsoDate): string[] {
  const current = today.slice(0, 7);
  return Array.from({ length: 12 }, (_, i) => shiftMonthKey(current, i - 12));
}

/**
 * Среднее по положительным значениям (вниз); null — положительных нет. Нули и отрицательные не считаются: месяц без расходов
 * («приложением не пользовался») не должен занижать обычное. Бросает RangeError при переполнении.
 */
export function averageOfActive(values: readonly Minor[]): Minor | null {
  let sum = 0n;
  let n = 0n;
  for (const v of values) {
    if (!Number.isSafeInteger(v) || v <= 0) continue;
    sum += BigInt(v);
    n += 1n;
  }
  return n === 0n ? null : toMinor(sum / n);
}

const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'] as const;

/** Месяц в предложном падеже: '2026-12' → 'декабре' (для «в декабре»). Нечитаемый месяц — пустая строка. */
export function monthPrepositional(month: string): string {
  const m = MONTH_RE.exec(month);
  return m ? (MONTHS_PREP[Number(m[2]) - 1] ?? '') : '';
}

/**
 * Предупреждения о сезонных месяцах до срока (по возрастанию месяца). monthTotals — расходы по месяцам в основной валюте; пропущенный
 * месяц — «расходов не было». currency нужна для порога «не меньше одной основной единицы».
 */
export function seasonalHeadsUp(monthTotals: ReadonlyMap<string, Minor>, today: IsoDate, dueOn: IsoDate | null, currency: CurrencyCode): SeasonalHint[] {
  const targets = upcomingMonths(today, dueOn);
  if (targets.length === 0) return [];
  try {
    const year = yearWindow(today).map((m) => monthTotals.get(m) ?? 0);
    if (year.filter((v) => Number.isSafeInteger(v) && v > 0).length < SEASON_MIN_ACTIVE_MONTHS) return [];
    const average = averageOfActive(year);
    if (average === null) return [];
    const floor = Math.max(factorOf(currency), toMinor((BigInt(average) * BigInt(SEASON_MIN_EXTRA_PERCENT)) / 100n));
    const out: SeasonalHint[] = [];
    for (const month of targets) {
      const yearAgo = monthTotals.get(shiftMonthKey(month, -12)) ?? 0;
      if (!Number.isSafeInteger(yearAgo) || yearAgo <= 0) continue;
      if (BigInt(yearAgo) * 100n < BigInt(average) * BigInt(SEASON_RATIO_PERCENT)) continue;
      const extra = yearAgo - average;
      if (extra < floor) continue;
      out.push({
        month,
        yearAgoMinor: yearAgo,
        averageMinor: average,
        extraMinor: extra,
        percent: Number((BigInt(extra) * 100n) / BigInt(average)),
      });
    }
    return out;
  } catch (e) {
    if (e instanceof RangeError) return [];
    throw e;
  }
}
