import type { CurrencyCode, IsoDate, IsoDateTime, Minor, ShoppingItem, ShoppingList, ShoppingStatus, ShoppingUnit, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import {
  MINOR_LIMIT,
  isPlainObject,
  optId,
  optStamp,
  reqCurrency,
  reqDate,
  reqEnum,
  reqId,
  reqMinorInRange,
  reqText,
} from './validate';

/**
 * Проверки списка покупок. Границы совпадают с CHECK в supabase/schema.sql (shopping_lists_*): запись за границей сервер отвергнет
 * навсегда, поэтому клиент её не принимает.
 */
export const SHOPPING_NAME_MAX = 60;
export const SHOPPING_TITLE_MAX = 80;
export const SHOPPING_ITEMS_MAX = 200;
/** shopping_lists.items_json: не длиннее 30000 знаков. */
export const SHOPPING_JSON_MAX = 30000;
export const SHOPPING_QTY_MAX = 1_000_000;
export const SHOPPING_UNITS: readonly ShoppingUnit[] = ['шт', 'кг', 'г', 'л', 'мл'];
export const SHOPPING_STATUSES: readonly ShoppingStatus[] = ['open', 'done'];

const fail = (message: string): never => {
  throw new ValidationError(message);
};

function reqQty(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > SHOPPING_QTY_MAX) {
    return fail(`Количество: число больше нуля, не больше ${SHOPPING_QTY_MAX}`);
  }
  const thousandths = Math.round(v * 1000);
  if (Math.abs(v * 1000 - thousandths) > 1e-6) return fail('Количество: не больше трёх знаков после запятой');
  return thousandths / 1000;
}

function parseItem(raw: unknown): ShoppingItem {
  if (!isPlainObject(raw)) return fail('Товар: ожидался объект');
  const price = raw['priceMinor'];
  return {
    id: reqId(raw['id'], 'Товар: id'),
    title: reqText(raw['title'], 'Название товара', SHOPPING_TITLE_MAX),
    qty: reqQty(raw['qty']),
    unit: reqEnum(raw['unit'], 'Единица товара', SHOPPING_UNITS),
    priceMinor: price === null || price === undefined ? null : reqMinorInRange(price, 'Цена товара', 0, MINOR_LIMIT),
    checked: typeof raw['checked'] === 'boolean' ? raw['checked'] : fail('Товар: отметка «куплено» должна быть да или нет'),
  };
}

/** Товары (массив объектов) → проверенные товары. Повтор id, больше SHOPPING_ITEMS_MAX товаров — ошибка. */
export function parseShoppingItems(raw: unknown): ShoppingItem[] {
  if (!Array.isArray(raw)) return fail('Товары: ожидался список');
  if (raw.length > SHOPPING_ITEMS_MAX) return fail(`В списке не больше ${SHOPPING_ITEMS_MAX} товаров`);
  const items = raw.map(parseItem);
  if (new Set(items.map((i) => i.id)).size !== items.length) return fail('Товары: у двух товаров один и тот же id');
  return items;
}

/** Проверенные товары → строка для shopping_lists.items_json (с проверкой длины). */
export function itemsToJson(items: readonly ShoppingItem[]): string {
  const json = JSON.stringify(parseShoppingItems(items));
  if (json.length > SHOPPING_JSON_MAX) return fail('Список слишком большой: уберите часть товаров или сократите названия');
  return json;
}

/** items_json → товары. Нечитаемая строка — ошибка (а не пустой список: молча потерять товары нельзя). */
export function parseItemsJson(json: unknown): ShoppingItem[] {
  if (typeof json !== 'string' || json.length > SHOPPING_JSON_MAX) return fail('Товары списка: ожидался текст не длиннее 30000 знаков');
  try {
    return parseShoppingItems(JSON.parse(json));
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    return fail('Товары списка: не удалось прочитать');
  }
}

/** Товары списка для показа: нечитаемое превращается в пустой список (экран не должен падать). */
export function safeItems(list: Pick<ShoppingList, 'itemsJson'>): ShoppingItem[] {
  try {
    return parseItemsJson(list.itemsJson);
  } catch {
    return [];
  }
}

export interface ShoppingListData {
  name: string;
  itemsJson: string;
  status: ShoppingStatus;
  currency: CurrencyCode;
  categoryId: UUID | null;
  transactionId: UUID | null;
  totalMinor: Minor | null;
  doneOn: IsoDate | null;
  archivedAt: IsoDateTime | null;
}

export function parseShoppingListData(raw: Record<string, unknown>): ShoppingListData {
  const totalRaw = raw['totalMinor'];
  const doneRaw = raw['doneOn'];
  const itemsJson = raw['itemsJson'];
  parseItemsJson(itemsJson);
  return {
    name: reqText(raw['name'], 'Название списка', SHOPPING_NAME_MAX),
    itemsJson: itemsJson as string,
    status: reqEnum(raw['status'], 'Статус списка', SHOPPING_STATUSES),
    currency: reqCurrency(raw['currency'], 'Валюта списка'),
    categoryId: optId(raw['categoryId'], 'Категория списка'),
    transactionId: optId(raw['transactionId'], 'Расход списка'),
    totalMinor: totalRaw === null || totalRaw === undefined ? null : reqMinorInRange(totalRaw, 'Итог покупки', 0, MINOR_LIMIT),
    doneOn: doneRaw === null || doneRaw === undefined ? null : reqDate(doneRaw, 'Дата покупки'),
    archivedAt: optStamp(raw['archivedAt'], 'Дата архивации списка'),
  };
}
