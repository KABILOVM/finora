import { formatMinor } from '@/domain/money';
import type { CategoryAdvice, DayPlan, GoalPlanItem } from '@/domain/savingsPlan';
import type { CurrencyCode, IsoDate, Minor } from '@/domain/types';
import { longDate } from '../budgetText';

/** Слова для целей накопления в «Бюджетах» (без React и базы): проверяются тестом. */

/** «до конца месяца» / «до 12 ноября»: до какого дня считается план (горизонт прогноза «Осталось на день»). */
export function horizonLabel(horizonEnd: IsoDate, monthEnd: IsoDate): string {
  return horizonEnd >= monthEnd ? 'до конца месяца' : `до ${longDate(horizonEnd)}`;
}

/** Сколько ещё откладывать в этом месяце по всем целям. */
export function monthLeftLine(leftMinor: Minor, currency: CurrencyCode): string {
  return leftMinor > 0 ? `В этом месяце нужно отложить ещё ${formatMinor(leftMinor, currency)}` : 'В этом месяце уже отложено сколько нужно';
}

/** Строка цели про этот месяц: «За месяц нужно ~1 000 с. · уже отложено 400 с.»; для не «активной» цели — её состояние. */
export function goalMonthLine(item: GoalPlanItem, currency: CurrencyCode): string {
  if (item.state === 'reached') return 'Цель достигнута';
  if (item.state === 'overdue') return 'Срок прошёл, а цель не достигнута';
  if (item.state === 'other-currency') return 'Цель задана в другой валюте — укажите сумму заново';
  const need = formatMinor(item.monthNeedMinor, currency);
  if (item.leftThisMonthMinor === 0) return `В этом месяце отложено сколько нужно (${need})`;
  return item.savedThisMonthMinor > 0
    ? `За месяц нужно ${need} · уже отложено ${formatMinor(item.savedThisMonthMinor, currency)}`
    : `За месяц нужно отложить ${need}`;
}

/** Совет по категории: «Не больше 5 000 с. (обычно ~8 000 с.)», «Лучше не тратить», «Как обычно», «Обязательная — без изменений». */
export function adviceLine(c: CategoryAdvice, currency: CurrencyCode): string {
  const usual = formatMinor(c.usualRestMinor, currency);
  if (c.essential) return `Обязательная: без изменений (~${usual})`;
  if (c.advice === 'skip') return `Лучше не тратить (обычно ~${usual})`;
  if (c.advice === 'trim') return `Не больше ${formatMinor(c.allowedMinor, currency)} (обычно ~${usual})`;
  return `Как обычно (~${usual})`;
}

/** Главная фраза плана: что делать, чтобы успеть. */
export function planStatusLine(day: DayPlan, currency: CurrencyCode, until: string): string {
  const withBreakdown = day.cutTotalMinor !== null;
  if (day.status === 'ok') return 'Привычные траты укладываются: тратьте как обычно, цель не пострадает.';
  if (day.status === 'cut') {
    return withBreakdown
      ? `Чтобы успеть, ${until} сократите привычные траты на ${formatMinor(day.cutTotalMinor ?? 0, currency)}.`
      : `Чтобы успеть, ${until} тратьте не больше ${formatMinor(day.perDayWithGoalMinor, currency)} в день.`;
  }
  return withBreakdown
    ? `Даже без необязательных трат не хватает ${formatMinor(day.uncoveredMinor, currency)}. Сдвиньте срок или уменьшите сумму цели.`
    : `Денег не хватает: ${until} можно отложить меньше нужного, не хватает ${formatMinor(day.uncoveredMinor, currency)}. Сдвиньте срок или уменьшите сумму цели.`;
}

/** Подпись под крупным числом: «Без цели — 400 с. в день». */
export function withoutGoalLine(perDayMinor: Minor, currency: CurrencyCode): string {
  return `Без цели — ${formatMinor(perDayMinor, currency)} в день`;
}

/** Подсказка, когда разбора по категориям нет: нужна история трат. */
export const NO_HISTORY_TEXT = 'Разбор по категориям появится, когда накопится история трат за прошлые месяцы.';
