import { compareRu } from '@/db/sort';
import { addMinor, formatMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor } from '@/domain/types';
import { longDate } from '@/features/budgets/budgetText';
import { endSentence } from '@/features/transactions/txDisplay';
import { normName } from './debtMatch';
import { compareDebts, type DebtItem } from './debtSummary';

/** Долги по людям (без React и без базы): кто сколько должен мне и сколько я ему — по каждой валюте отдельно. */

/** Ключ человека в адресе и в группировке: имя без регистра, лишних пробелов и «ё». Долг без имени (в данных такого быть не должно) — «-». */
export const personKey = (counterparty: string): string => normName(counterparty) || '-';

export interface PersonTotals {
  currency: CurrencyCode;
  /** Сколько мне должен этот человек (остатки «мне должны»). */
  lentMinor: Minor;
  /** Сколько я должен ему (остатки «я должен»). */
  borrowedMinor: Minor;
  /** lent − borrowed: больше нуля — человек должен мне, меньше — я ему. */
  netMinor: Minor;
}

export interface Person {
  key: string;
  /** Как имя записано в самом свежем из открытых долгов (иначе — из закрытых). */
  name: string;
  /** Не закрыты и не в архиве, в порядке списка долгов. */
  open: DebtItem[];
  /** Закрытые, не в архиве. */
  closed: DebtItem[];
  /** По валютам; только где что-то осталось. В основной валюте первой, дальше по алфавиту. */
  totals: PersonTotals[];
  /** Суммы этого человека не помещаются в расчёт: итоги не показываем, только сообщение. */
  overflow: boolean;
}

const alive = (it: DebtItem): boolean => it.debt.deletedAt === null && it.debt.archivedAt === null;

/**
 * Группирует долги по людям. В итоги входят остатки открытых долгов (закрытые и архивные — нет). Человек без открытых долгов
 * остаётся в результате (с пустыми итогами): страница человека открывается и для него, а список «Люди» таких не показывает.
 */
export function groupByPerson(items: readonly DebtItem[], base?: CurrencyCode): Person[] {
  const byKey = new Map<string, DebtItem[]>();
  for (const it of items) {
    if (!alive(it)) continue;
    const key = personKey(it.debt.counterparty);
    const list = byKey.get(key);
    if (list) list.push(it);
    else byKey.set(key, [it]);
  }
  const people: Person[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => compareDebts(a.debt, b.debt));
    const open = sorted.filter((it) => it.debt.closedAt === null);
    const closed = sorted.filter((it) => it.debt.closedAt !== null);
    const sums = new Map<CurrencyCode, { lent: Minor; borrowed: Minor }>();
    let overflow = false;
    try {
      for (const it of open) {
        if (it.state === null) {
          overflow = true;
          continue;
        }
        const cur = sums.get(it.debt.currency) ?? { lent: 0, borrowed: 0 };
        if (it.debt.direction === 'lent') cur.lent = addMinor(cur.lent, it.state.remainingMinor);
        else cur.borrowed = addMinor(cur.borrowed, it.state.remainingMinor);
        sums.set(it.debt.currency, cur);
      }
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      overflow = true;
    }
    const totals: PersonTotals[] = overflow
      ? []
      : [...sums]
          .filter(([, s]) => s.lent !== 0 || s.borrowed !== 0)
          .map(([currency, s]) => ({ currency, lentMinor: s.lent, borrowedMinor: s.borrowed, netMinor: s.lent - s.borrowed }))
          .sort((a, b) => {
            if ((a.currency === base) !== (b.currency === base)) return a.currency === base ? -1 : 1;
            return compareRu(a.currency, b.currency);
          });
    people.push({ key, name: (open[0] ?? closed[0])!.debt.counterparty, open, closed, totals, overflow });
  }
  return people.sort((a, b) => compareRu(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Люди, у которых сейчас есть открытые долги: их показывает список «Люди». */
export const peopleWithOpenDebts = (people: readonly Person[]): Person[] => people.filter((p) => p.open.length > 0);

/** Что осталось у человека в этой валюте с каждой стороны: можно ли делать взаимозачёт (есть и «мне должны», и «я должен»). */
export const canNet = (t: PersonTotals): boolean => t.lentMinor > 0 && t.borrowedMinor > 0;

/** Одна строка итога человека словами: «Вам должны 500 с.», «Вы должны 200 с.», «Взаимные долги: итого вам должны 300 с.». */
export function totalsLine(t: PersonTotals): string {
  if (t.lentMinor > 0 && t.borrowedMinor > 0) {
    const side = t.netMinor > 0 ? `итого вам должны ${formatMinor(t.netMinor, t.currency)}` : t.netMinor < 0 ? `итого вы должны ${formatMinor(-t.netMinor, t.currency)}` : 'долги равны';
    return `Взаимные долги: ${side}`;
  }
  return t.lentMinor > 0 ? `Вам должны ${formatMinor(t.lentMinor, t.currency)}` : `Вы должны ${formatMinor(t.borrowedMinor, t.currency)}`;
}

/**
 * Текст напоминания человеку, который мне должен: сколько и (если срок есть) к какому числу. Берутся только его открытые долги
 * «мне должны» с остатком. null — напоминать не о чем.
 */
export function reminderText(person: Pick<Person, 'name' | 'open'>, today: IsoDate): string | null {
  const owed = person.open.filter((it) => it.debt.direction === 'lent' && it.state !== null && it.state.remainingMinor > 0);
  if (owed.length === 0) return null;
  const sums = new Map<CurrencyCode, Minor>();
  try {
    for (const it of owed) sums.set(it.debt.currency, addMinor(sums.get(it.debt.currency) ?? 0, it.state!.remainingMinor));
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  // обычные пробелы вместо неразрывных: текст уйдёт в чужой мессенджер
  const amount = [...sums].map(([currency, minor]) => formatMinor(minor, currency)).join(' и ').replace(/[\u00a0\u202f]/g, ' ');
  const dues = owed.map((it) => it.debt.dueOn).filter((d): d is IsoDate => d !== null);
  const nearest = dues.length === 0 ? null : dues.reduce((a, b) => (a < b ? a : b));
  const when = nearest === null ? '' : nearest < today ? ` Срок возврата был ${longDate(nearest)}.` : ` Срок возврата — ${longDate(nearest)}.`;
  return `${person.name}, привет! Напоминаю про долг: ${endSentence(amount)}${when} Спасибо!`;
}
