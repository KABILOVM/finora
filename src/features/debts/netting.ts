import { addMinor } from '@/domain/money';
import type { CurrencyCode, Minor, UUID } from '@/domain/types';
import { canNet } from './people';
import type { DebtItem } from './debtSummary';
import type { Person, PersonTotals } from './people';

/**
 * Взаимозачёт: человек должен мне, и я должен ему — вычитаем меньшую сумму из обеих сторон. Чистый расчёт (без React и без базы).
 * Берутся открытые долги человека в одной валюте с остатком; идём по порядку списка долгов (ближайший срок первым).
 */

export interface NettingStep {
  /** Долг «мне должны», который уменьшается. */
  lentId: UUID;
  /** Долг «я должен», который уменьшается. */
  borrowedId: UUID;
  amountMinor: Minor;
}

export interface NettingPlan {
  currency: CurrencyCode;
  steps: NettingStep[];
  /** Сколько зачтётся всего: меньшая из двух сторон. */
  totalMinor: Minor;
  /** Остаток каждого долга после зачёта (только затронутые зачётом и нетронутые, но участвующие). */
  after: ReadonlyMap<UUID, Minor>;
}

// Объединённый долг в зачёте не участвует: платёж зачёта не делится между его частями, у которых свои условия (части зачитываются на своих страницах)
const usable = (it: DebtItem, currency: CurrencyCode): it is DebtItem & { state: NonNullable<DebtItem['state']> } =>
  it.parts === undefined && it.state !== null && it.debt.currency === currency && it.debt.closedAt === null && it.debt.archivedAt === null && it.state.remainingMinor > 0;

/**
 * План зачёта по долгам человека в валюте `currency`. null — зачитывать нечего: нет одной из сторон или суммы не помещаются в расчёт.
 * Каждый шаг — пара (долг «мне должны», долг «я должен») и сумма: min(остаток первого, остаток второго). Меньшая сторона гасится целиком.
 */
export function planNetting(items: readonly DebtItem[], currency: CurrencyCode): NettingPlan | null {
  const lent = items.filter((it) => it.debt.direction === 'lent' && usable(it, currency));
  const borrowed = items.filter((it) => it.debt.direction === 'borrowed' && usable(it, currency));
  if (lent.length === 0 || borrowed.length === 0) return null;
  try {
    const left = new Map<UUID, Minor>([...lent, ...borrowed].map((it) => [it.debt.id, it.state!.remainingMinor]));
    const steps: NettingStep[] = [];
    let total: Minor = 0;
    let i = 0;
    let j = 0;
    while (i < lent.length && j < borrowed.length) {
      const l = lent[i]!;
      const b = borrowed[j]!;
      const ll = left.get(l.debt.id)!;
      const bl = left.get(b.debt.id)!;
      const amount = Math.min(ll, bl);
      steps.push({ lentId: l.debt.id, borrowedId: b.debt.id, amountMinor: amount });
      total = addMinor(total, amount);
      left.set(l.debt.id, ll - amount);
      left.set(b.debt.id, bl - amount);
      if (left.get(l.debt.id) === 0) i++;
      if (left.get(b.debt.id) === 0) j++;
    }
    return { currency, steps, totalMinor: total, after: left };
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** Валюты человека, в которых зачёт возможен (есть обе стороны). */
export const nettableCurrencies = (person: Pick<Person, 'totals'>): PersonTotals[] => person.totals.filter(canNet);
