import { valueOf, type FilterField, type FilterValues } from '@/components/filters/filterState';
import { compareRu } from '@/db/sort';
import { debtCategoryKey, matchesDebtCategory, NO_DEBT_CATEGORY, normalizeDebtCategory, usedDebtCategories } from '@/domain/debtCategory';
import type { Debt, IsoDate } from '@/domain/types';
import { isOwing, type DebtItem } from './debtSummary';
import { daysBetween } from './debtText';
import { personKey } from './people';

/**
 * Фильтры экрана «Долги» — чистая логика (без React и без базы). Значения хранит страница; поля собираются из самих долгов,
 * поэтому в шите нет вариантов, по которым ничего не найти (нет ни одной категории — нет и поля «Категория»).
 *
 * ОБЪЕДИНЁННЫЕ ДОЛГИ. В списке объединение — один элемент (главный долг, у которого в `parts` лежат свои долги каждой части,
 * см. debtSummary.foldGroups), но у каждой части свои категория, срок, проценты. Поэтому фильтр проверяет ЧАСТИ: элемент
 * подходит, если хотя бы одна его часть подходит под ВСЕ включённые фильтры сразу. Показывается он целиком, с полным итогом
 * по всем частям: резать итог объединения по частям значило бы показывать сумму, которой нет ни на одной странице долга.
 * Чтобы цифры не расходились с подписью молча, applyDebtFilters возвращает partialGroups — сколько таких объединений показано
 * целиком при том, что подошли не все их части; экран пишет об этом под итогом.
 */

/** «Скоро»: срок в ближайшие столько дней (сегодня включительно). */
export const DUE_SOON_DAYS = 7;

export const FILTER_CATEGORY = 'category';
export const FILTER_PERSON = 'person';
export const FILTER_DUE = 'due';
export const FILTER_INTEREST = 'interest';
export const FILTER_CURRENCY = 'currency';

export type DueFilter = 'overdue' | 'soon' | 'none';
export type InterestFilter = 'with' | 'without';

/** Свои долги элемента списка: части объединения или он сам. */
export function ownDebtItems(it: DebtItem): DebtItem[] {
  return it.parts && it.parts.length > 0 ? it.parts : [it];
}

/** Категории элемента без повторов и пустых, в порядке частей: у объединения их может быть несколько. */
export function debtCategoriesOf(it: DebtItem): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const own of ownDebtItems(it)) {
    const name = normalizeDebtCategory(own.debt.category ?? '');
    if (name === '') continue;
    const key = debtCategoryKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const hasInterest = (d: Pick<Debt, 'interestMinor'>): boolean => (d.interestMinor ?? 0) > 0;

/** Один долг (не объединение) подходит под значения фильтров: все включённые поля должны совпасть. */
export function debtMatches(it: DebtItem, values: FilterValues, today: IsoDate): boolean {
  const d = it.debt;

  const category = valueOf(values, FILTER_CATEGORY);
  if (category !== '' && !matchesDebtCategory(d.category ?? '', category)) return false;

  const person = valueOf(values, FILTER_PERSON);
  if (person !== '' && personKey(d.counterparty) !== person) return false;

  const currency = valueOf(values, FILTER_CURRENCY);
  if (currency !== '' && d.currency !== currency) return false;

  const interest = valueOf(values, FILTER_INTEREST);
  if (interest === 'with' && !hasInterest(d)) return false;
  if (interest === 'without' && hasInterest(d)) return false;

  const due = valueOf(values, FILTER_DUE);
  if (due === 'none') {
    if (d.dueOn !== null) return false;
  } else if (due === 'overdue' || due === 'soon') {
    // просрочка и «скоро» бывают только у долга, по которому ещё что-то осталось (как в итоге «Просрочено»)
    if (!isOwing(it) || d.dueOn === null) return false;
    const days = daysBetween(today, d.dueOn);
    if (days === null) return false;
    if (due === 'overdue' ? days >= 0 : days < 0 || days > DUE_SOON_DAYS) return false;
  }
  return true;
}

export interface FilteredDebts {
  items: DebtItem[];
  /** Объединения, показанные целиком, хотя под фильтры подошла лишь часть их долгов. */
  partialGroups: number;
}

/** Элементы списка, подходящие под фильтры; порядок прежний. Пустые значения — ничего не отсеивается (тот же массив копией). */
export function applyDebtFilters(items: readonly DebtItem[], values: FilterValues, today: IsoDate): FilteredDebts {
  if (!Object.values(values).some((v) => v !== '')) return { items: [...items], partialGroups: 0 };
  const out: DebtItem[] = [];
  let partialGroups = 0;
  for (const it of items) {
    const own = ownDebtItems(it);
    const matching = own.filter((p) => debtMatches(p, values, today)).length;
    if (matching === 0) continue;
    out.push(it);
    if (it.parts && matching < own.length) partialGroups++;
  }
  return { items: out, partialGroups };
}

const DUE_OPTIONS = [
  { value: 'overdue', label: 'Просроченные' },
  { value: 'soon', label: `Скоро (${DUE_SOON_DAYS} дней)` },
  { value: 'none', label: 'Без срока' },
] as const;

const INTEREST_OPTIONS = [
  { value: 'with', label: 'С процентами' },
  { value: 'without', label: 'Без процентов' },
] as const;

/**
 * Поля шита «Фильтры» по текущим долгам. Поле появляется, только если по нему есть из чего выбирать:
 * категория — когда у какого-то долга она есть; человек — когда людей больше одного; проценты — когда у какого-то долга они есть;
 * валюта — когда валют больше одной. «Срок» есть всегда. `base` — основная валюта: в списке валют идёт первой.
 */
export function debtFilterFields(items: readonly DebtItem[], base?: string | null): FilterField[] {
  const owns = items.flatMap(ownDebtItems);
  const fields: FilterField[] = [];

  const used = usedDebtCategories(owns.map((o) => o.debt.category ?? ''));
  if (used.length > 0) {
    const anyUncategorised = owns.some((o) => normalizeDebtCategory(o.debt.category ?? '') === '');
    fields.push({
      key: FILTER_CATEGORY,
      label: 'Категория',
      type: 'select',
      anyLabel: 'Все категории',
      options: [...(anyUncategorised ? [{ value: NO_DEBT_CATEGORY, label: 'Без категории' }] : []), ...used.map((c) => ({ value: c, label: c }))],
    });
  }

  const people = new Map<string, string>();
  for (const o of owns) {
    const key = personKey(o.debt.counterparty);
    if (!people.has(key)) people.set(key, o.debt.counterparty);
  }
  if (people.size > 1) {
    fields.push({
      key: FILTER_PERSON,
      label: 'Человек',
      type: 'select',
      anyLabel: 'Все люди',
      options: [...people].map(([value, label]) => ({ value, label })).sort((a, b) => compareRu(a.label, b.label) || (a.value < b.value ? -1 : 1)),
    });
  }

  fields.push({ key: FILTER_DUE, label: 'Срок возврата', type: 'chips', anyLabel: 'Любой', options: DUE_OPTIONS });

  if (owns.some((o) => hasInterest(o.debt))) {
    fields.push({ key: FILTER_INTEREST, label: 'Проценты', type: 'chips', anyLabel: 'Любые', options: INTEREST_OPTIONS });
  }

  const currencies = [...new Set(owns.map((o) => o.debt.currency))].sort((a, b) => {
    if ((a === base) !== (b === base)) return a === base ? -1 : 1;
    return compareRu(a, b);
  });
  if (currencies.length > 1) {
    fields.push({ key: FILTER_CURRENCY, label: 'Валюта', type: 'chips', anyLabel: 'Все', options: currencies.map((c) => ({ value: c, label: c })) });
  }
  return fields;
}
