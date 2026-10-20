import { addMinor, isMinor } from '@/domain/money';
import { planFinished } from '@/domain/debts';
import type { CurrencyCode, Frequency, IsoDate, Minor, RecurringRule } from '@/domain/types';

/**
 * «Сколько в месяц»: регулярные платежи, пересчитанные на месяц (раз в неделю ×52/12, раз в год ÷12 и т. д.). Чистый расчёт.
 * Считаются доходы и расходы; переводы деньги не тратят и не приносят. Не считаются платежи в архиве, закончившиеся (дата окончания
 * прошла) и остановленные (план по закрытому долгу). Валюты не складываются: у каждой свой итог. Значения приблизительные
 * (в месяце 4,33 недели): округление до целой минорной единицы.
 */

export interface MonthlyTotal {
  currency: CurrencyCode;
  expenseMinor: Minor;
  incomeMinor: Minor;
}

type RuleLike = Pick<RecurringRule, 'id' | 'kind' | 'walletId' | 'amountMinor' | 'frequency' | 'intervalN' | 'endOn' | 'archivedAt' | 'deletedAt'>;

/** Месячный эквивалент одного платежа: amount × (платежей в год) / (12 × интервал), BigInt — суммы до 1e15 не помещаются в double при умножении. */
export function monthlyEquivalent(amountMinor: Minor, frequency: Frequency, intervalN: number): Minor {
  const n = BigInt(Math.max(1, Math.trunc(intervalN)));
  const perYear: Record<Frequency, bigint> = { daily: 365n, weekly: 52n, monthly: 12n, yearly: 1n };
  const num = BigInt(amountMinor) * perYear[frequency];
  const den = 12n * n;
  const result = (num * 2n + den) / (2n * den); // округление до ближайшего
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Месячный эквивалент не помещается в безопасное целое');
  return Number(result);
}

/**
 * Итоги по валютам кошельков: базовая первой. null — суммы не помещаются в расчёт (переполнение). Пусто — нечего считать.
 * isStopped — правило остановлено (например, план по закрытому долгу); currencyOf — валюта кошелька правила (нет кошелька — правило пропускается).
 */
export function monthlyTotals(
  rules: readonly RuleLike[],
  currencyOf: (walletId: string) => CurrencyCode | undefined,
  today: IsoDate,
  base: CurrencyCode,
  isStopped: (rule: RuleLike) => boolean = () => false,
): MonthlyTotal[] | null {
  const by = new Map<CurrencyCode, MonthlyTotal>();
  try {
    for (const r of rules) {
      if (r.deletedAt !== null || r.archivedAt !== null) continue;
      if (r.kind !== 'expense' && r.kind !== 'income') continue;
      if (!isMinor(r.amountMinor) || r.amountMinor <= 0 || planFinished(r, today) || isStopped(r)) continue;
      const currency = currencyOf(r.walletId);
      if (currency === undefined) continue;
      const row = by.get(currency) ?? { currency, expenseMinor: 0, incomeMinor: 0 };
      const monthly = monthlyEquivalent(r.amountMinor, r.frequency, r.intervalN);
      if (r.kind === 'expense') row.expenseMinor = addMinor(row.expenseMinor, monthly);
      else row.incomeMinor = addMinor(row.incomeMinor, monthly);
      by.set(currency, row);
    }
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  return [...by.values()].sort((a, b) => Number(b.currency === base) - Number(a.currency === base) || (a.currency < b.currency ? -1 : 1));
}
