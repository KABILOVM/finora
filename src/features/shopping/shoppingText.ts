import { newId } from '@/db/ids';
import { MINOR_LIMIT } from '@/db/validate';
import { SHOPPING_TITLE_MAX } from '@/db/validateShopping';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, Minor, ShoppingItem, ShoppingUnit } from '@/domain/types';
import { pluralRu } from '@/lib/plural';

/** Тексты и счёт списка покупок (без React). Деньги — целые минорные единицы, дробей нет. */

export const UNIT_OPTIONS: readonly { value: ShoppingUnit; label: string }[] = [
  { value: 'шт', label: 'шт' },
  { value: 'кг', label: 'кг' },
  { value: 'г', label: 'г' },
  { value: 'л', label: 'л' },
  { value: 'мл', label: 'мл' },
];

/** 1,5 → «1,5». */
export const qtyNumber = (qty: number): string => String(qty).replace('.', ',');

/** «2 кг», «1,5 л», «× 3» для штук; одна штука не пишется. */
export function qtyText(item: Pick<ShoppingItem, 'qty' | 'unit'>): string {
  if (item.unit === 'шт') return item.qty === 1 ? '' : `× ${qtyNumber(item.qty)}`;
  return `${qtyNumber(item.qty)} ${item.unit}`;
}

/** Разбор количества из поля ввода: «1,5», «2.25». null — не число, не больше нуля или больше трёх знаков после запятой. */
export function parseQty(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 1_000_000 ? n : null;
}

export function newItem(title: string): ShoppingItem {
  return { id: newId(), title: title.trim().slice(0, SHOPPING_TITLE_MAX), qty: 1, unit: 'шт', priceMinor: null, checked: false };
}

export interface Totals {
  /** Сумма цен (null — не помещается в безопасное число: итог тогда вводят вручную). */
  sum: Minor | null;
  /** Сколько товаров с ценой / без цены. */
  priced: number;
  unpriced: number;
}

function total(items: readonly ShoppingItem[]): Totals {
  let sum = 0;
  let priced = 0;
  let unpriced = 0;
  for (const i of items) {
    if (i.priceMinor === null) unpriced++;
    else {
      priced++;
      sum += i.priceMinor;
    }
  }
  return { sum: sum > MINOR_LIMIT ? null : sum, priced, unpriced };
}

/** План: цены всех товаров. */
export const plannedTotals = (items: readonly ShoppingItem[]): Totals => total(items);
/** В корзине: цены отмеченных товаров. */
export const boughtTotals = (items: readonly ShoppingItem[]): Totals => total(items.filter((i) => i.checked));

export const itemsWord = (n: number): string => `${n} ${pluralRu(n, 'товар', 'товара', 'товаров')}`;

/** «3 из 5 куплено». */
export function progressText(items: readonly ShoppingItem[]): string {
  const bought = items.filter((i) => i.checked).length;
  return `${bought} из ${items.length} куплено`;
}

/** Заметка расхода: «Покупки 12 окт: Молоко, Хлеб, …» (до 500 знаков, лишнее — «и ещё N»). */
export function purchaseNote(name: string, items: readonly ShoppingItem[], max = 500): string {
  const titles = items.map((i) => i.title);
  let note = name;
  if (titles.length === 0) return note.slice(0, max);
  note += ': ';
  for (let k = 0; k < titles.length; k++) {
    const piece = (k === 0 ? '' : ', ') + titles[k];
    const rest = titles.length - k - 1;
    const tail = rest > 0 ? ` и ещё ${rest}` : '';
    if ((note + piece + tail).length > max) {
      const left = titles.length - k;
      return `${note.replace(/, $/, '')} и ещё ${left}`.slice(0, max);
    }
    note += piece;
  }
  return note.slice(0, max);
}

/** Не купленное: товары без отметки, цены остаются подсказкой «в прошлый раз». */
export function leftoverItems(items: readonly ShoppingItem[]): ShoppingItem[] {
  return items.filter((i) => !i.checked).map((i) => ({ ...i, id: newId(), checked: false }));
}

/** Повторить покупку: все товары заново без отметок; прежние цены остаются подсказкой. */
export function repeatItems(items: readonly ShoppingItem[]): ShoppingItem[] {
  return items.map((i) => ({ ...i, id: newId(), checked: false }));
}

export const priceText = (minor: Minor | null, currency: CurrencyCode, planned = false): string =>
  minor === null ? '' : `${planned ? '≈ ' : ''}${formatMinor(minor, currency)}`;
