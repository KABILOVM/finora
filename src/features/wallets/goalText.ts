import { formatMinor } from '@/domain/money';
import type { GoalProgress, SavingNudge } from '@/domain/goals';
import type { CurrencyCode, IsoDate } from '@/domain/types';
import { daysWord, ruDateShort } from '@/features/debts/debtText';

/** Слова для целей накопления (без React и базы): проверяются тестом. */

/** «Накоплено 3 000 TJS из 10 000 TJS» / «Цель достигнута: 12 000 TJS из 10 000 TJS». */
export function goalSavedLine(p: GoalProgress, currency: CurrencyCode): string {
  const saved = formatMinor(p.balanceMinor, currency);
  const goal = formatMinor(p.goalMinor, currency);
  return p.reached ? `Цель достигнута: ${saved} из ${goal}` : `Накоплено ${saved} из ${goal}`;
}

/** «Осталось 7 000 TJS»; для достигнутой цели — пусто. */
export function goalRemainingLine(p: GoalProgress, currency: CurrencyCode): string {
  return p.reached ? '' : `Осталось ${formatMinor(p.remainingMinor, currency)}`;
}

/** Срок словами: «К 25.11.2026 · через 5 дней», «Срок прошёл 3 дня назад (было 25.11.2026)». Нет срока — пусто. */
export function goalDueLine(goalOn: IsoDate | null, p: GoalProgress): string {
  if (goalOn === null || p.daysLeft === null) return '';
  const date = ruDateShort(goalOn);
  if (p.reached) return `Срок был ${date}`;
  const d = p.daysLeft;
  if (d < 0) return `Срок прошёл ${-d} ${daysWord(-d)} назад (было ${date})`;
  if (d === 0) return `К ${date} · срок сегодня`;
  if (d === 1) return `К ${date} · срок завтра`;
  return `К ${date} · через ${d} ${daysWord(d)}`;
}

/** «Откладывайте около 1 000 TJS в месяц». Меньше месяца до срока — «Нужно отложить 700 TJS до срока». Нет срока — пусто. */
export function goalPaceLine(p: GoalProgress, currency: CurrencyCode): string {
  if (p.perMonthMinor === null || p.perMonthMinor <= 0 || p.monthsLeft === null) return '';
  const sum = formatMinor(p.perMonthMinor, currency);
  return p.monthsLeft <= 1 ? `Нужно отложить ${sum} до срока` : `Откладывайте около ${sum} в месяц`;
}

/** «Пора отложить: в этом месяце отложено 200 TJS из ~1 000 TJS». */
export function nudgeLine(n: SavingNudge, currency: CurrencyCode): string {
  return `Пора отложить: в этом месяце отложено ${formatMinor(n.savedMinor, currency)} из ~${formatMinor(n.neededMinor, currency)}`;
}

/** Подпись полосы для скринридера. */
export function goalBarLabel(walletName: string, p: GoalProgress): string {
  return `Цель «${walletName}»: накоплено ${p.percent}%`;
}
