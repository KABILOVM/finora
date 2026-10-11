import type { BudgetLevel, BudgetProgress } from '@/domain/budgetProgress';
import { formatMinor } from '@/domain/money';
import type { Category, CurrencyCode, IsoDate, UUID } from '@/domain/types';
import { pluralRu } from '@/lib/plural';

/** Тексты и мелкие помощники экранов бюджетов (без React). */

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/** '2026-10-31' → '31 октября'. Нечитаемую дату возвращает как есть. */
export function longDate(iso: IsoDate): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS_GEN[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : iso;
}

export const daysText = (n: number): string => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;

/** Слова вместо одного цвета: уровень бюджета называется вслух. */
export const LEVEL_WORDS: Record<BudgetLevel, string> = {
  ok: 'В пределах лимита',
  warn: 'Внимание: больше 70%',
  danger: 'Почти исчерпан',
  over: 'Лимит превышен',
};

type Compared = Extract<BudgetProgress, { comparable: true }>;

/** Слово уровня; ровно на лимите (не превышен) — «Лимит исчерпан». */
export function levelWord(p: Compared): string {
  return p.level === 'over' && p.overMinor === 0 ? 'Лимит исчерпан' : LEVEL_WORDS[p.level];
}

/** «Потрачено 78%». Огромный процент не растягивает строку. */
export const spentWord = (percent: number): string => (percent > 999 ? 'Потрачено более 999%' : `Потрачено ${percent}%`);

/** «Осталось 220 с.» / «Превышен на 50 с.» / «Лимит исчерпан». */
export function restWord(p: Compared, currency: CurrencyCode): string {
  if (p.overMinor > 0) return `Превышен на ${formatMinor(p.overMinor, currency)}`;
  return `Осталось ${formatMinor(p.remainingMinor, currency)}`;
}

/** Название и значок бюджета: общий лимит или категория (в том числе уже удалённая). */
export function budgetLabel(
  categoryId: UUID | null,
  categories: ReadonlyMap<UUID, Pick<Category, 'name' | 'icon' | 'color'>>,
): { name: string; icon: string; color: string | null } {
  if (categoryId === null) return { name: 'Все расходы', icon: '🧾', color: null };
  const c = categories.get(categoryId);
  return c ? { name: c.name, icon: c.icon, color: c.color } : { name: 'Категория удалена', icon: '❔', color: null };
}

/** Предупреждение про расходы в иной прежней валюте (общее для экрана бюджетов). */
export function excludedText(count: number, base: CurrencyCode): string {
  return `Часть операций не учтена: ${count} ${pluralRu(count, 'операция внесена', 'операции внесены', 'операций внесено')} в другой основной валюте, чем сейчас (${base}). Потрачено может быть больше.`;
}
