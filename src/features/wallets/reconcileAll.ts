import { bankDifference } from './reconcile';

export type RowDiff =
  /** Фактический остаток не введён: этот кошелёк не проверяем. */
  | { kind: 'skip' }
  /** Совпадает. */
  | { kind: 'match' }
  /** Расхождение: plus — в кошельке больше, чем в приложении. */
  | { kind: 'diff'; diffMinor: number }
  /** Сумма не помещается в безопасное целое. */
  | { kind: 'overflow' };

/** Что показать в строке «Сверки всех кошельков»: фактический остаток против остатка в приложении. `negative` — фактический остаток отрицательный. */
export function rowDiff(appMinor: number, actual: number | null, negative: boolean): RowDiff {
  if (actual === null) return { kind: 'skip' };
  try {
    const diffMinor = bankDifference(actual, negative, appMinor);
    return diffMinor === 0 ? { kind: 'match' } : { kind: 'diff', diffMinor };
  } catch {
    return { kind: 'overflow' };
  }
}
