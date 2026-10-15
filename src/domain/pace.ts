import type { SpendRow } from './budgetProgress';
import { endOfMonth } from './forecast';
import { isMinor } from './money';
import type { IsoDate, Minor, UUID } from './types';

/**
 * Темп трат — ЧИСТЫЕ функции (без базы, без React, без часов): куда придут расходы к концу месяца и когда кончится лимит,
 * если тратить так же, как до сих пор. Прогноз линейный: он не знает про разовые крупные траты (аренду, покупку),
 * поэтому в первые дни месяца ничего не обещает (MIN_PACE_DAYS), а экран объясняет, как число получено.
 * Целая арифметика через BigInt, как у percentOf (budgetProgress.ts): на больших суммах точность не теряется.
 */

/** Раньше этого дня месяца прогноз не показываем: одна покупка в первый день растянулась бы на весь месяц. */
export const MIN_PACE_DAYS = 3;

export interface MonthDays {
  /** Сколько дней месяца прошло, считая сегодняшний. */
  elapsedDays: number;
  /** Сколько всего дней в месяце. */
  totalDays: number;
}

/**
 * Дни текущего месяца ('ГГГГ-ММ') на сегодня. Прошедший и будущий месяц — null: темп имеет смысл только у идущего месяца
 * (в прошедшем нечего прогнозировать, в будущем нечего считать).
 */
export function monthPace(month: string, today: IsoDate): MonthDays | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !today.startsWith(`${month}-`)) return null;
  return { elapsedDays: Number(today.slice(8, 10)), totalDays: Number(endOfMonth(`${month}-01`).slice(8, 10)) };
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function toMinor(v: bigint): Minor {
  if (v > MAX) throw new RangeError('Переполнение суммы');
  return Number(v);
}

/** Расход к концу месяца при прежнем темпе: floor(потрачено × дней в месяце ÷ прошло дней). RangeError — суммы не помещаются или дни некорректны. */
export function projectMonthEnd(spentMinor: Minor, elapsedDays: number, totalDays: number): Minor {
  if (!isMinor(spentMinor) || spentMinor < 0) throw new RangeError(`Некорректная сумма: ${String(spentMinor)}`);
  if (!Number.isInteger(elapsedDays) || !Number.isInteger(totalDays) || elapsedDays < 1 || totalDays < elapsedDays) {
    throw new RangeError(`Некорректные дни месяца: ${String(elapsedDays)} из ${String(totalDays)}`);
  }
  return toMinor((BigInt(spentMinor) * BigInt(totalDays)) / BigInt(elapsedDays));
}

export type BudgetPace =
  /** Прогноз невозможен: нет трат, лимит некорректен или прошло меньше MIN_PACE_DAYS дней. */
  | { status: 'unknown' }
  /** Лимит уже исчерпан: прогнозировать нечего, это видно по уровню бюджета. */
  | { status: 'over' }
  /** К концу месяца уложитесь в лимит. */
  | { status: 'on-track'; projectedMinor: Minor }
  /** При таком темпе лимит закончится раньше конца месяца: в день `exhaustDay` (номер дня месяца), к концу выйдет `overByMinor` сверх лимита. */
  | { status: 'will-exceed'; projectedMinor: Minor; overByMinor: Minor; exhaustDay: number };

export interface BudgetPaceArgs extends MonthDays {
  limitMinor: Minor;
  spentMinor: Minor;
}

/**
 * Хватит ли лимита до конца месяца. День исчерпания — первый день, на конец которого траты при прежнем темпе дойдут до лимита:
 * ceil(лимит × прошло ÷ потрачено). Он всегда позже сегодняшнего (потрачено меньше лимита) и не позже последнего дня месяца
 * (иначе прогноз был бы в пределах лимита).
 */
export function budgetPace({ limitMinor, spentMinor, elapsedDays, totalDays }: BudgetPaceArgs): BudgetPace {
  if (!isMinor(limitMinor) || limitMinor <= 0 || !isMinor(spentMinor) || spentMinor <= 0) return { status: 'unknown' };
  if (spentMinor >= limitMinor) return { status: 'over' };
  if (elapsedDays < MIN_PACE_DAYS) return { status: 'unknown' };
  const projectedMinor = projectMonthEnd(spentMinor, elapsedDays, totalDays);
  if (projectedMinor <= limitMinor) return { status: 'on-track', projectedMinor };
  const num = BigInt(limitMinor) * BigInt(elapsedDays);
  const den = BigInt(spentMinor);
  return {
    status: 'will-exceed',
    projectedMinor,
    overByMinor: projectedMinor - limitMinor,
    exhaustDay: Number((num + den - 1n) / den),
  };
}

export interface UnusualCategory {
  categoryId: UUID;
  /** Потрачено в этом месяце. */
  spentMinor: Minor;
  /** Обычно за месяц: медиана трёх предыдущих месяцев. */
  usualMinor: Minor;
}

/** Необычно много: уже потрачено не меньше 120 % от обычного за месяц. */
export const UNUSUAL_PERCENT = 120;
/** Сколько из предыдущих месяцев категория должна быть «живой» (с тратами), чтобы «обычное» что-то значило. */
export const UNUSUAL_MIN_MONTHS = 2;

const sumOf = (rows: readonly SpendRow[], categoryId: UUID): Minor => {
  let total = 0n;
  for (const r of rows) if (r.kind !== 'fee' && r.categoryId === categoryId) total += BigInt(r.totalMinor);
  return toMinor(total);
};

/**
 * Категории, где этот месяц уже обошёлся дороже обычного. «Обычное» — медиана предыдущих месяцев (`history`, по строке расходов
 * на месяц; нули входят). Нужны траты минимум в двух из них (UNUSUAL_MIN_MONTHS): по одному месяцу «обычного» нет. Без прогноза на конец
 * месяца, поэтому от дня месяца не зависит. «Комиссии» и «без категории» не проверяются. Больше превышение — выше в списке.
 */
export function unusualCategories(current: readonly SpendRow[], history: readonly (readonly SpendRow[])[]): UnusualCategory[] {
  const out: UnusualCategory[] = [];
  for (const row of current) {
    if (row.kind === 'fee' || row.categoryId === null || !isMinor(row.totalMinor) || row.totalMinor <= 0) continue;
    const id = row.categoryId;
    const amounts = history.map((m) => sumOf(m, id));
    if (amounts.filter((a) => a > 0).length < UNUSUAL_MIN_MONTHS) continue;
    const sorted = [...amounts].sort((a, b) => a - b);
    const usual = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0; // середина (при чётном числе — нижняя)
    if (usual <= 0) continue;
    if (BigInt(row.totalMinor) * 100n >= BigInt(usual) * BigInt(UNUSUAL_PERCENT)) out.push({ categoryId: id, spentMinor: row.totalMinor, usualMinor: usual });
  }
  return out.sort((a, b) => b.spentMinor - b.usualMinor - (a.spentMinor - a.usualMinor) || (a.categoryId < b.categoryId ? -1 : 1));
}
