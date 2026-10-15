import { floorDiv } from '@/domain/forecast';
import { occurrencesBetween, SCHEDULE_MAX_DATE } from '@/domain/schedule';
import type { IsoDate, Minor } from '@/domain/types';

/** «Платить частями»: когда долг закроется, если платить каждый месяц одну и ту же сумму. Чистый расчёт (без React и без базы). */

/** Больше стольких платежей не планируем: это 50 лет, а не план. */
export const MAX_PAYOFF_PAYMENTS = 600;

export interface Payoff {
  /** Сколько платежей понадобится. */
  payments: number;
  /** Дата последнего платежа. */
  lastOn: IsoDate;
  /** Сколько в последнем платеже нужно, чтобы закрыть долг ровно (не больше обычной суммы). */
  lastAmountMinor: Minor;
}

export type PayoffResult = { ok: true; payoff: Payoff } | { ok: false; reason: 'nothing-left' | 'bad-amount' | 'too-long' | 'bad-date' };

/**
 * remaining — остаток долга, perMonth — платёж раз в месяц, startOn — дата первого платежа. Даты считаются по тому же правилу,
 * что и у регулярного платежа «раз в месяц» (29–31 число в коротком месяце — последний день месяца).
 */
export function payoffPlan(remainingMinor: Minor, perMonthMinor: Minor, startOn: IsoDate): PayoffResult {
  if (!Number.isSafeInteger(remainingMinor) || remainingMinor <= 0) return { ok: false, reason: 'nothing-left' };
  if (!Number.isSafeInteger(perMonthMinor) || perMonthMinor <= 0) return { ok: false, reason: 'bad-amount' };
  const payments = floorDiv(remainingMinor - 1, perMonthMinor) + 1; // потолок деления: остаток ≥ 1, переполнения нет
  if (payments > MAX_PAYOFF_PAYMENTS) return { ok: false, reason: 'too-long' };
  const dates = occurrencesBetween({ frequency: 'monthly', intervalN: 1, startOn, endOn: null }, startOn, SCHEDULE_MAX_DATE);
  const lastOn = dates[payments - 1];
  if (lastOn === undefined) return { ok: false, reason: dates.length === 0 ? 'bad-date' : 'too-long' };
  return { ok: true, payoff: { payments, lastOn, lastAmountMinor: remainingMinor - (payments - 1) * perMonthMinor } };
}
