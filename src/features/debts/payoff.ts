import { floorDiv } from '@/domain/forecast';
import { occurrencesBetween, SCHEDULE_MAX_DATE } from '@/domain/schedule';
import type { IsoDate, Minor, RecurringRule } from '@/domain/types';
import { addDays } from '@/lib/dates';

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

/**
 * Когда закончится действующий план, если платить дальше по его же датам и суммам, а остаток теперь remainingMinor: дата последнего
 * платежа (по расписанию самого правила, считая с from). null — платить нечем (сумма 0), остатка нет или платежей получается больше
 * MAX_PAYOFF_PAYMENTS. Нужна, когда долг вырос (пополнение), а план закончился бы раньше долга.
 */
export function planEndFor(
  rule: Pick<RecurringRule, 'frequency' | 'intervalN' | 'startOn' | 'amountMinor'>,
  remainingMinor: Minor,
  from: IsoDate,
): IsoDate | null {
  if (!Number.isSafeInteger(remainingMinor) || remainingMinor <= 0) return null;
  if (!Number.isSafeInteger(rule.amountMinor) || rule.amountMinor <= 0) return null;
  const payments = floorDiv(remainingMinor - 1, rule.amountMinor) + 1;
  if (payments > MAX_PAYOFF_PAYMENTS) return null;
  // горизонт по числу платежей, а не до 2100 года: у ежедневного плана иначе набрались бы десятки тысяч дат
  const step = { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[rule.frequency] * Math.max(1, rule.intervalN);
  const horizon = addDays(from, payments * step + 31);
  const to = horizon < SCHEDULE_MAX_DATE ? horizon : SCHEDULE_MAX_DATE;
  const dates = occurrencesBetween({ frequency: rule.frequency, intervalN: rule.intervalN, startOn: rule.startOn, endOn: null }, from, to);
  return dates[payments - 1] ?? null;
}
