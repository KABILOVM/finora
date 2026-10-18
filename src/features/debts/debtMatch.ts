import { addMinor } from '@/domain/money';
import { normName } from '@/domain/names';
import type { CurrencyCode, Debt, DebtDirection, IsoDate, Minor } from '@/domain/types';
import type { DebtItem } from './debtSummary';

/** Поиск одного и того же человека среди долгов и расчёты для объединения (без React и без базы). */

export { normName };

export interface DebtMatchQuery {
  direction: DebtDirection;
  currency: CurrencyCode;
  counterparty: string;
}

/** Долг можно пополнять или объединять: живой, не в архиве, и сумму по нему удалось посчитать. */
const usable = (it: DebtItem): boolean => it.debt.deletedAt === null && it.debt.archivedAt === null && it.state !== null;

/**
 * Долги того же человека, того же направления и той же валюты — те, к которым можно «добавить ещё».
 * Закрытые тоже подходят (пополнение откроет долг снова). Порядок — как в списке долгов: открытые первыми.
 */
export function findMatchingDebts(items: readonly DebtItem[], q: DebtMatchQuery): DebtItem[] {
  const name = normName(q.counterparty);
  if (name === '') return [];
  return items.filter(
    (it) => usable(it) && it.debt.direction === q.direction && it.debt.currency === q.currency && normName(it.debt.counterparty) === name,
  );
}

export interface MergeCandidate {
  item: DebtItem;
  /** Тот же человек, что и в основном долге: такие отмечаются заранее. */
  sameName: boolean;
}

/** С какими долгами можно объединить `target`: того же направления и валюты, кроме него самого. Одноимённые — первыми. */
export function mergeCandidates(items: readonly DebtItem[], target: Pick<Debt, 'id' | 'direction' | 'currency' | 'counterparty'>): MergeCandidate[] {
  const name = normName(target.counterparty);
  const out = items
    .filter((it) => usable(it) && it.debt.id !== target.id && it.debt.direction === target.direction && it.debt.currency === target.currency)
    .map((item) => ({ item, sameName: normName(item.debt.counterparty) === name }));
  return [...out.filter((c) => c.sameName), ...out.filter((c) => !c.sameName)];
}

export interface MergePreview {
  principalMinor: Minor;
  paidMinor: Minor;
  remainingMinor: Minor;
  overpaidMinor: Minor;
  /** Ближайший срок; null — сроков нет. */
  dueOn: IsoDate | null;
  /** Переплата одного долга погасила часть другого: общий остаток меньше суммы остатков. */
  netted: boolean;
}

/**
 * Что получится после объединения (в точности как посчитает computeDebtState по общему набору операций):
 * сумма = Σ сумм, оплачено = Σ платежей, остаток = сумма − оплачено, но не меньше 0. null — суммы не помещаются в расчёт.
 */
export function mergePreview(items: readonly DebtItem[]): MergePreview | null {
  try {
    let principal: Minor = 0;
    let paid: Minor = 0;
    let remainingSum: Minor = 0;
    let dueOn: IsoDate | null = null;
    for (const it of items) {
      if (it.state === null) return null;
      principal = addMinor(principal, it.state.principalMinor);
      paid = addMinor(paid, it.state.paidMinor);
      remainingSum = addMinor(remainingSum, it.state.remainingMinor);
      if (it.debt.dueOn !== null && (dueOn === null || it.debt.dueOn < dueOn)) dueOn = it.debt.dueOn;
    }
    const left = principal - paid;
    const remaining = left > 0 ? left : 0;
    return { principalMinor: principal, paidMinor: paid, remainingMinor: remaining, overpaidMinor: left < 0 ? -left : 0, dueOn, netted: remaining < remainingSum };
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}
