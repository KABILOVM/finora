import { formatMinor } from '@/domain/money';
import type { CatchUp, CategoryAdvice, DayPlan, GoalPlanItem } from '@/domain/savingsPlan';
import type { CurrencyCode, IsoDate, Minor } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import type { WhatIfRow } from '@/domain/savingsWhatIf';
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

/** '2027-02-15' → '15 февраля 2027 года', если год не текущий, иначе '15 февраля'. */
export function catchUpDate(iso: IsoDate, today: IsoDate): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? longDate(iso) : `${longDate(iso)} ${iso.slice(0, 4)} года`;
}

/**
 * Подсказка срока, когда «впритык»: самая ранняя дата, к которой накопится остаток. many — целей несколько, дата для всех вместе.
 * Это нижняя граница (темп — всё, что остаётся после обязательных трат), поэтому слова «не раньше», а не «успеете».
 */
export function catchUpLine(c: CatchUp, currency: CurrencyCode, many: boolean, today: IsoDate): string {
  const who = many ? 'Все цели вместе' : 'Цель';
  if (c.kind === 'none') return 'После обязательных трат ничего не остаётся: цель не накопить, пока обязательные расходы не уменьшатся.';
  if (c.kind === 'far') {
    return `${who}: при таком темпе (около ${formatMinor(c.monthlyMinor, currency)} в месяц) накопление затянется больше чем на десять лет. Уменьшите сумму или пересмотрите обязательные траты.`;
  }
  return `${who}: не раньше ${catchUpDate(c.date, today)}. Даже если не тратить на необязательное, получается откладывать около ${formatMinor(c.monthlyMinor, currency)} в месяц.`;
}

/** «на 5 дней раньше», «на 3 недели раньше», «примерно на 2 месяца раньше»; меньше дня — «почти без разницы по сроку». */
export function earlierText(days: number): string {
  if (!(days >= 1)) return 'срок почти не изменится';
  if (days < 14) return `на ${days} ${pluralRu(days, 'день', 'дня', 'дней')} раньше`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `на ${weeks} ${pluralRu(weeks, 'неделю', 'недели', 'недель')} раньше`;
  const months = Math.round(days / 30.4375);
  return `примерно на ${months} ${pluralRu(months, 'месяц', 'месяца', 'месяцев')} раньше`;
}

/** Строка «Что если»: «+120 000 с. в месяц · цели накопятся на 3 недели раньше». */
export function whatIfLine(row: Pick<WhatIfRow, 'extraMonthlyMinor' | 'daysEarlier'>, currency: CurrencyCode): string {
  const extra = `+${formatMinor(row.extraMonthlyMinor, currency)} в месяц`;
  return row.daysEarlier >= 1 ? `${extra} · накопите ${earlierText(row.daysEarlier)}` : `${extra} · ${earlierText(row.daysEarlier)}`;
}

/** Подпись кнопки сдвига срока: «Сдвинуть срок на 15 февраля 2027 года». */
export function shiftDueLabel(date: IsoDate, today: IsoDate): string {
  return `Сдвинуть срок на ${catchUpDate(date, today)}`;
}
