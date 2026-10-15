import type { DebtDirection, IsoDate, Minor } from '@/domain/types';
import { isValidIsoDate } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';

/** Слова и чистые расчёты для экранов долгов (без React и без базы): проверяются тестом. */

export const DIRECTION_LABEL: Record<DebtDirection, string> = { lent: 'Мне должны', borrowed: 'Я должен' };
/** Для шита «Новый долг»: от первого лица, что человек сделал. */
export const DIRECTION_ACTION: Record<DebtDirection, string> = { lent: 'Я дал в долг', borrowed: 'Я взял в долг' };
export const DIRECTION_NAME_LABEL: Record<DebtDirection, string> = { lent: 'Кому я дал', borrowed: 'У кого я взял' };
/** Кнопка «добавить ещё» на странице долга и заголовок шита. */
export const TOP_UP_ACTION: Record<DebtDirection, string> = { lent: 'Дал ещё в долг', borrowed: 'Взял ещё в долг' };
/** Кнопка «платить частями» на странице долга и заголовок окна. */
export const PARTS_ACTION: Record<DebtDirection, string> = { lent: 'Получать частями', borrowed: 'Платить частями' };
/** Подпись суммы пополнения. */
export const TOP_UP_AMOUNT_LABEL: Record<DebtDirection, string> = { lent: 'Сколько ещё дали', borrowed: 'Сколько ещё взяли' };

const DAY_MS = 86_400_000;

/**
 * Сколько календарных дней от `from` до `to` ('ГГГГ-ММ-ДД'); отрицательное — `to` раньше. null — одна из дат некорректна.
 * Считается по полуночи UTC обеих дат, поэтому часовой пояс и переход на летнее время на результат не влияют.
 */
export function daysBetween(from: IsoDate, to: IsoDate): number | null {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return null;
  const day = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  };
  return day(to) - day(from);
}

export const daysWord = (n: number): string => pluralRu(n, 'день', 'дня', 'дней');

export type DueTone = 'none' | 'ok' | 'soon' | 'today' | 'overdue';

export interface DueInfo {
  tone: DueTone;
  /** Дней до срока (отрицательное — просрочка). null — срока нет. */
  days: number | null;
  /** «через 5 дней», «завтра», «сегодня», «просрочен на 3 дня», «без срока»; для закрытого долга — пусто. */
  text: string;
}

/**
 * Срок возврата словами. active = долг не закрыт и по нему ещё что-то осталось: у закрытого или погашенного долга просрочки нет,
 * поэтому красить его в красный нельзя — показываем только дату.
 */
export function dueInfo(dueOn: IsoDate | null, today: IsoDate, active = true): DueInfo {
  if (dueOn === null) return { tone: 'none', days: null, text: 'без срока' };
  const days = daysBetween(today, dueOn);
  if (days === null) return { tone: 'none', days: null, text: 'срок указан неверно' };
  if (!active) return { tone: 'none', days, text: '' };
  if (days < 0) return { tone: 'overdue', days, text: `просрочен на ${-days} ${daysWord(-days)}` };
  if (days === 0) return { tone: 'today', days, text: 'сегодня' };
  if (days === 1) return { tone: 'soon', days, text: 'завтра' };
  return { tone: days <= 3 ? 'soon' : 'ok', days, text: `через ${days} ${daysWord(days)}` };
}

/** '2026-11-25' → '25.11.2026'. Не дату возвращает как есть. */
export function ruDateShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Сколько процентов долга погашено: целое 0…100 (вниз, чтобы «100%» значило «выплачено полностью»). BigInt: суммы до 1e15, умножение на 100 не помещается в double. */
export function progressPercent(paidMinor: Minor, principalMinor: Minor): number {
  if (!Number.isSafeInteger(paidMinor) || !Number.isSafeInteger(principalMinor) || principalMinor <= 0 || paidMinor <= 0) return 0;
  if (paidMinor >= principalMinor) return 100;
  return Number((BigInt(paidMinor) * 100n) / BigInt(principalMinor));
}

/** «Возвращено 40%» (мне вернули) / «Выплачено 40%» (я выплатил). */
export function repaidWord(direction: DebtDirection, percent: number): string {
  return `${direction === 'lent' ? 'Возвращено' : 'Выплачено'} ${percent}%`;
}

/** Подпись к остатку на странице долга. */
export const REMAINING_LABEL: Record<DebtDirection, string> = { lent: 'Вам ещё должны', borrowed: 'Вы ещё должны' };

const capitalize = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** Срок одной строкой для списка: «Срок 25.11.2026 · через 5 дней», «Просрочен на 3 дня (срок был 25.11.2026)», «Без срока». */
export function dueLine(dueOn: IsoDate | null, info: DueInfo): string {
  if (dueOn === null) return 'Без срока';
  const date = ruDateShort(dueOn);
  if (info.tone === 'overdue') return `${capitalize(info.text)} (срок был ${date})`;
  return info.text === '' ? `Срок ${date}` : `Срок ${date} · ${info.text}`;
}
