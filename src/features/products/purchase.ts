import { draftToMinor } from '@/components/amountText';
import { sumMinor } from '@/domain/money';
import { normName, productByName } from '@/domain/products/catalog';
import { bookKey, productKeyOf, type PriceBook, type ProductStats } from '@/domain/products/stats';
import { NAME_MAX, parseQty, unitPrice } from '@/domain/shopping';
import type { CurrencyCode, Minor, ShoppingUnit } from '@/domain/types';

/**
 * «Что куплено» в новой операции: строки черновика. Человек вводит для каждой строки количество и СУММУ за всю строку (как в чеке);
 * цена за единицу считается сама. Сумма расхода — сумма строк. Всё хранится как текст полей, разбор — здесь, в одном месте.
 */
export interface PurchaseLine {
  /** Номер строки внутри окна (ключ списка), не хранится. */
  rid: number;
  name: string;
  unit: ShoppingUnit;
  qtyText: string;
  amountText: string;
}

/** Строка, разобранная и проверенная. */
export interface LineView {
  qtyMilli: number | null;
  /** null — пусто или не читается. */
  amountMinor: Minor | null;
  /** Цена за единицу (за кг, л, шт): считается, когда есть и количество, и сумма. */
  unitMinor: Minor | null;
  /** Что не так со строкой (человеческим языком); null — строка готова. */
  problem: string | null;
}

const NAME_PROBLEM = 'Введите название продукта';

export function viewLine(l: PurchaseLine, currency: CurrencyCode): LineView {
  const qtyMilli = parseQty(l.qtyText, l.unit);
  const trimmedAmount = l.amountText.trim();
  const amountMinor = trimmedAmount === '' ? null : draftToMinor(trimmedAmount, currency);
  const unitMinor = qtyMilli !== null && amountMinor !== null && amountMinor > 0 ? unitPrice(amountMinor, qtyMilli) : null;
  let problem: string | null = null;
  if (l.name.trim() === '') problem = NAME_PROBLEM;
  else if (l.name.trim().length > NAME_MAX) problem = `Название не длиннее ${NAME_MAX} символов`;
  else if (qtyMilli === null) problem = l.unit === 'pcs' ? 'Количество — целое число больше нуля' : 'Количество — число больше нуля, например 1,5';
  else if (trimmedAmount === '') problem = 'Введите сумму за этот продукт';
  else if (amountMinor === null) problem = 'Сумма не читается: например, 12 или 12,50';
  else if (amountMinor <= 0) problem = 'Сумма должна быть больше нуля';
  return { qtyMilli, amountMinor, unitMinor, problem };
}

/** Сумма строк, у которых сумма читается и больше нуля. null — нечего складывать или сумма не помещается в расчёт. */
export function totalOfLines(lines: readonly PurchaseLine[], currency: CurrencyCode): Minor | null {
  const amounts: Minor[] = [];
  for (const l of lines) {
    const { amountMinor } = viewLine(l, currency);
    if (amountMinor !== null && amountMinor > 0) amounts.push(amountMinor);
  }
  if (amounts.length === 0) return null;
  try {
    return sumMinor(amounts);
  } catch {
    return null;
  }
}

/** Строка для записи чека (то, что принимает ShoppingRepo.recordReceipt). */
export interface ReceiptLineInput {
  name: string;
  qtyMilli: number;
  unit: ShoppingUnit;
  priceMinor: Minor;
}

export type LinesCheck =
  | { ok: true; lines: ReceiptLineInput[]; total: Minor }
  | { ok: false; rid: number | null; message: string };

/**
 * Все строки → строки чека. Первая же негодная останавливает проверку и называет себя (rid): окно раскроет её и подсветит.
 * Название приводится к каталожному («картошка» → «Картофель»), чтобы цены одного продукта складывались вместе, а не по написаниям.
 */
export function checkLines(lines: readonly PurchaseLine[], currency: CurrencyCode): LinesCheck {
  if (lines.length === 0) return { ok: false, rid: null, message: 'Добавьте хотя бы один продукт' };
  const out: ReceiptLineInput[] = [];
  for (const l of lines) {
    const v = viewLine(l, currency);
    if (v.problem !== null || v.qtyMilli === null || v.amountMinor === null) return { ok: false, rid: l.rid, message: v.problem ?? NAME_PROBLEM };
    const name = l.name.trim().replace(/\s+/g, ' ');
    out.push({ name: productByName(name)?.name ?? name, qtyMilli: v.qtyMilli, unit: l.unit, priceMinor: v.amountMinor });
  }
  try {
    return { ok: true, lines: out, total: sumMinor(out.map((x) => x.priceMinor)) };
  } catch {
    return { ok: false, rid: null, message: 'Сумма покупки слишком велика' };
  }
}

/** Статистика продукта по названию и единице (продукт каталога или свой); null — по нему ещё нет покупок с ценой. */
export function statsOfName(book: PriceBook, name: string, unit: ShoppingUnit): ProductStats | null {
  if (normName(name) === '') return null;
  return book.get(bookKey(productKeyOf(name), unit)) ?? null;
}

const GROCERY = 'продукты';

/** Минимум полей категории, нужный для проверки «это Продукты?». */
export interface CategoryRef {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * Категория «Продукты» или её подкатегория («Продукты › Овощи»): для неё в «Новой операции» есть блок «Что куплено».
 * Узнаём по названию — у человека может быть своя «Продукты» (стартовая переименована или создана заново).
 */
export function isGroceryCategory(categoryId: string | null, categories: readonly CategoryRef[]): boolean {
  if (categoryId === null) return false;
  const byId = new Map(categories.map((c) => [c.id, c] as const));
  const cat = byId.get(categoryId);
  if (!cat) return false;
  if (normName(cat.name) === GROCERY) return true;
  const parent = cat.parentId !== null && cat.parentId !== cat.id ? byId.get(cat.parentId) : undefined;
  return parent !== undefined && normName(parent.name) === GROCERY;
}
