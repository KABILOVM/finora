import { categoryCovers } from '@/domain/budgetLevels';
import { exponentOf } from '@/domain/currency';
import { addMinor } from '@/domain/money';
import type { CurrencyCode, Minor, UUID } from '@/domain/types';
import type { SpendRow } from '@/domain/budgetProgress';

/** Расходы одного прошедшего месяца в основной валюте (итоги месяца из db/queries.ts summarizeMonth). */
export interface MonthSpend {
  month: string;
  byCategory: readonly SpendRow[];
  expenseMinor: Minor;
  /** Сколько операций месяца не вошло в итог: они внесены в другой основной валюте, чем сейчас. */
  excludedCount?: number;
}

/**
 * Сколько потрачено за месяц в области лимита — по тем же правилам, что и прогресс бюджета: общий лимит — все расходы месяца
 * (с комиссиями), лимит на категорию — её расходы и расходы подкатегорий (без комиссий и «Без категории»).
 * Бросает RangeError, если сумма не помещается в безопасное целое.
 */
export function spentInScope(m: MonthSpend, categoryId: UUID | null, parentOf: ReadonlyMap<UUID, UUID | null>): Minor {
  if (categoryId === null) return m.expenseMinor;
  let spent: Minor = 0;
  for (const row of m.byCategory) {
    if (row.kind === 'fee' || row.categoryId === null) continue;
    if (categoryCovers(categoryId, row.categoryId, parentOf)) spent = addMinor(spent, row.totalMinor);
  }
  return spent;
}

/**
 * Округление до «красивой» суммы лимита по порядку величины (а не по числу единиц валюты: сум и тенге — это тысячи):
 * до 20 целых единиц — до целой, до 100 — до 5, дальше — две значащие цифры (437 → 440, 1 234 → 1 200, 437 812 → 440 000).
 * Округляется к ближайшему: подсказка остаётся близкой к тратам, а не завышает их до 10 %. Меньше одной единицы не бывает.
 */
export function niceRound(minor: Minor, currency: CurrencyCode): Minor {
  const factor = 10 ** exponentOf(currency);
  const units = minor / factor;
  const digits = Math.floor(Math.log10(Math.max(units, 1))) + 1; // число цифр в целой части
  const step = units < 20 ? 1 : units < 100 ? 5 : 10 ** (digits - 2);
  return Math.max(step, Math.round(units / step) * step) * factor;
}

export interface LimitHints {
  /** Потрачено в прошлом месяце (null — там ничего не тратили в этой области). */
  lastMonth: Minor | null;
  /** «Обычно»: середина трат по месяцам, в которых они были (null — таких месяцев меньше двух). */
  typical: Minor | null;
  /** Предлагаемые суммы лимита: те же числа, округлённые до «красивых». */
  lastMonthLimit: Minor | null;
  typicalLimit: Minor | null;
}

const median = (values: readonly Minor[]): Minor => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round(addMinor(sorted[mid - 1] ?? 0, sorted[mid] ?? 0) / 2);
};

/**
 * Подсказки суммы лимита по прошлым тратам. history — прошедшие месяцы от ближайшего к дальнему (обычно три).
 * Если подсказать нечего (трат не было), все поля null.
 */
export function limitHints(
  history: readonly MonthSpend[],
  categoryId: UUID | null,
  parentOf: ReadonlyMap<UUID, UUID | null>,
  currency: CurrencyCode,
): LimitHints {
  const empty: LimitHints = { lastMonth: null, typical: null, lastMonthLimit: null, typicalLimit: null };
  try {
    const spent = history.map((m) => spentInScope(m, categoryId, parentOf));
    const last = spent[0] ?? 0;
    const nonZero = spent.filter((v) => v > 0);
    const lastMonth = last > 0 ? last : null;
    const typical = nonZero.length >= 2 ? median(nonZero) : null;
    return {
      lastMonth,
      typical,
      lastMonthLimit: lastMonth === null ? null : niceRound(lastMonth, currency),
      typicalLimit: typical === null ? null : niceRound(typical, currency),
    };
  } catch (e) {
    if (e instanceof RangeError) return empty; // суммы слишком велики — подсказки просто нет
    throw e;
  }
}
