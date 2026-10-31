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
/** Пополнять можно только отдельный долг: у объединённого непонятно, к какой части добавлять (части пополняются на своих страницах). */
const topUpable = (it: DebtItem): boolean => usable(it) && it.parts === undefined;

/**
 * Долги того же человека, того же направления и той же валюты — те, к которым можно «добавить ещё».
 * Закрытые тоже подходят (пополнение откроет долг снова). Порядок — как в списке долгов: открытые первыми.
 */
export function findMatchingDebts(items: readonly DebtItem[], q: DebtMatchQuery): DebtItem[] {
  const name = normName(q.counterparty);
  if (name === '') return [];
  return items.filter(
    (it) => topUpable(it) && it.debt.direction === q.direction && it.debt.currency === q.currency && normName(it.debt.counterparty) === name,
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
  /** Сумма процентов объединяемых долгов (0 — процентов нет). */
  interestMinor: Minor;
  paidMinor: Minor;
  remainingMinor: Minor;
  overpaidMinor: Minor;
  /** Ближайший срок среди тех, что ещё должны (нет таких — среди всех); null — сроков нет. */
  dueOn: IsoDate | null;
}

/**
 * Что получится после объединения: суммы, проценты и платежи складываются; остаток — сумма остатков частей (у каждой части свой
 * остаток, переплата одной другую не гасит). Закрытые части в остаток не входят, если есть хоть одна незакрытая. Срок — ближайший.
 * null — суммы не помещаются в расчёт.
 */
export function mergePreview(items: readonly DebtItem[]): MergePreview | null {
  try {
    const anyOpen = items.some((it) => it.debt.closedAt === null);
    let principal: Minor = 0;
    let interest: Minor = 0;
    let paid: Minor = 0;
    let overpaid: Minor = 0;
    let remaining: Minor = 0;
    let dueOwing: IsoDate | null = null;
    let dueAny: IsoDate | null = null;
    for (const it of items) {
      if (it.state === null) return null;
      principal = addMinor(principal, it.state.principalMinor);
      interest = addMinor(interest, it.state.interestMinor);
      paid = addMinor(paid, it.state.paidMinor);
      overpaid = addMinor(overpaid, it.state.overpaidMinor);
      if (!anyOpen || it.debt.closedAt === null) remaining = addMinor(remaining, it.state.remainingMinor);
      const due = it.debt.dueOn;
      if (due !== null) {
        if (dueAny === null || due < dueAny) dueAny = due;
        if (it.debt.closedAt === null && it.state.remainingMinor > 0 && (dueOwing === null || due < dueOwing)) dueOwing = due;
      }
    }
    return { principalMinor: principal, interestMinor: interest, paidMinor: paid, remainingMinor: remaining, overpaidMinor: overpaid, dueOn: dueOwing ?? dueAny };
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}
