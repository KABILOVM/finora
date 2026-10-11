import type { CurrencyCode, IsoDate } from '@/domain/types';
import { todayLocal } from '@/lib/dates';

/** Тексты про курс, который человек ввёл сам в операции. Один источник слов для формы, «Всего» и Настроек. */

/** '2026-10-10' → '10.10' (ДД.ММ); если год не текущий — '10.10.2025'. Не дату возвращает как есть. */
export function dayMonth(iso: IsoDate, today: IsoDate = todayLocal()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const year = today.slice(0, 4);
  return m[1] === year ? `${m[3]}.${m[2]}` : `${m[3]}.${m[2]}.${m[1]}`;
}

/** «введён вручную 10.10» — подпись курса в форме операции и в Настройках. */
export const enteredLabel = (asOf: IsoDate): string => `введён вручную ${dayMonth(asOf)}`;

/** «по введённому вами курсу от 10.10» */
export const enteredPhrase = (asOf: IsoDate): string => `по введённому вами курсу от ${dayMonth(asOf)}`;

export interface EnteredUse {
  currency: CurrencyCode;
  asOf: IsoDate;
}

/** Пояснение под итогом «≈», когда часть денег пересчитана по курсу, введённому в операции. Пустой список — пустая строка. */
export function enteredNote(list: readonly EnteredUse[]): string {
  const first = list[0];
  if (!first) return '';
  if (list.length === 1) return `Остаток в ${first.currency} пересчитан ${enteredPhrase(first.asOf)}.`;
  return `Пересчитано: ${list.map((u) => `${u.currency} ${enteredPhrase(u.asOf)}`).join('; ')}.`;
}
