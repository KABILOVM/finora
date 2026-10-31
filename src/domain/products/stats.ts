import { isMinor } from '../money';
import { QTY_MIN, unitPrice } from '../shopping';
import type { IsoDateTime, Minor, ShoppingItem, ShoppingUnit } from '../types';
import { productByName, productKeyOf, type Product } from './catalog';

export { productKeyOf };

/**
 * Цены продуктов — ЛИЧНЫЕ: считаются по купленным позициям самого человека (shopping_items с ценой), новой схемы данных не нужно.
 * «Последняя» — цена за единицу из самой свежей покупки. «Средняя» — по покупкам за последние 90 дней, а если за них покупок нет —
 * по последним пяти. Среднее взвешенное: сумма потраченного делится на сумму купленного количества (3 кг по 6 и 1 кг по 10 — это 7, а не 8).
 */
export const AVG_WINDOW_DAYS = 90;
export const AVG_FALLBACK_COUNT = 5;

export interface ProductStats {
  /** Ключ продукта (см. productKeyOf). */
  key: string;
  unit: ShoppingUnit;
  /** Как показывать: название из каталога или последнее написание человека. */
  name: string;
  /** Сколько покупок с ценой за всё время. */
  count: number;
  /** Цена за единицу в последней покупке. */
  lastUnitMinor: Minor;
  lastAt: IsoDateTime;
  /** Средняя цена за единицу (взвешенная). */
  avgUnitMinor: Minor;
  /** По чему посчитана средняя: покупки за 90 дней или последние пять. */
  avgBasis: 'days' | 'recent';
  /** Сколько покупок вошло в среднюю. */
  avgCount: number;
}

/** Книга цен: статистика по «продукт + единица» (цена за кг и за штуку несравнимы). */
export type PriceBook = ReadonlyMap<string, ProductStats>;

export const bookKey = (productKey: string, unit: ShoppingUnit): string => `${productKey}|${unit}`;

interface Purchase {
  at: IsoDateTime;
  id: string;
  name: string;
  qtyMilli: number;
  priceMinor: Minor;
}

/** Средневзвешенная цена за единицу: round(Σцена × 1000 / Σколичество). null — не помещается в безопасное целое. */
function weightedUnit(list: readonly Purchase[]): Minor | null {
  let price = 0n;
  let qty = 0n;
  for (const p of list) {
    price += BigInt(p.priceMinor);
    qty += BigInt(p.qtyMilli);
  }
  if (qty <= 0n || price > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return unitPrice(Number(price), Number(qty));
}

const daysAgo = (now: IsoDateTime, days: number): IsoDateTime => new Date(Date.parse(now) - days * 86_400_000).toISOString();

/**
 * Книга цен по купленным позициям. Не купленные, удалённые, без цены и с нулевой ценой (не рыночная) в расчёт не входят.
 * now — «сейчас» (передаёт экран; в тестах — любое), от него отсчитываются 90 дней.
 */
export function buildPriceBook(items: readonly ShoppingItem[], now: IsoDateTime): PriceBook {
  const groups = new Map<string, { key: string; unit: ShoppingUnit; list: Purchase[] }>();
  for (const it of items) {
    if (it.deletedAt !== null || it.purchasedAt === null || it.priceMinor === null) continue;
    if (!isMinor(it.priceMinor) || it.priceMinor <= 0 || !Number.isSafeInteger(it.qtyMilli) || it.qtyMilli < QTY_MIN) continue;
    const key = productKeyOf(it.name);
    const bk = bookKey(key, it.unit);
    let g = groups.get(bk);
    if (!g) groups.set(bk, (g = { key, unit: it.unit, list: [] }));
    g.list.push({ at: it.purchasedAt, id: it.id, name: it.name.trim(), qtyMilli: it.qtyMilli, priceMinor: it.priceMinor });
  }

  const since = daysAgo(now, AVG_WINDOW_DAYS);
  const book = new Map<string, ProductStats>();
  for (const [bk, g] of groups) {
    // новые первыми; при равной дате — по id, чтобы порядок был полностью определён
    g.list.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? 1 : -1));
    const latest = g.list[0]!;
    const last = unitPrice(latest.priceMinor, latest.qtyMilli);
    if (last === null) continue;
    const recentDays = g.list.filter((p) => p.at >= since);
    const basis: 'days' | 'recent' = recentDays.length > 0 ? 'days' : 'recent';
    const used = basis === 'days' ? recentDays : g.list.slice(0, AVG_FALLBACK_COUNT);
    const avg = weightedUnit(used);
    if (avg === null) continue;
    const catalogName = g.key.startsWith('c:') ? productByName(latest.name)?.name : undefined;
    book.set(bk, {
      key: g.key,
      unit: g.unit,
      name: catalogName ?? latest.name,
      count: g.list.length,
      lastUnitMinor: last,
      lastAt: latest.at,
      avgUnitMinor: avg,
      avgBasis: basis,
      avgCount: used.length,
    });
  }
  return book;
}

/**
 * Статистика продукта каталога: в его единице по умолчанию, а если в ней покупок не было — в той единице, где покупка свежее всех
 * (молоко взяли «штуками» — это тоже история). null — по продукту ещё ничего не куплено.
 */
export function statsForProduct(book: PriceBook, product: Pick<Product, 'id' | 'unit'>): ProductStats | null {
  const key = `c:${product.id}`;
  const own = book.get(bookKey(key, product.unit));
  if (own) return own;
  let best: ProductStats | null = null;
  for (const s of book.values()) if (s.key === key && (best === null || s.lastAt > best.lastAt)) best = s;
  return best;
}

/** Средние цены за единицу из книги цен под ключами памяти цен (domain/shopping.ts, priceKey): «продукт|единица». */
export function averageMemory(book: PriceBook): Map<string, Minor> {
  return new Map([...book].map(([k, s]) => [k, s.avgUnitMinor]));
}

/** Свои продукты человека: названия из его покупок, которых нет в каталоге. Самые свежие первыми. */
export function ownProducts(book: PriceBook): ProductStats[] {
  return [...book.values()].filter((s) => s.key.startsWith('n:')).sort((a, b) => (a.lastAt !== b.lastAt ? (a.lastAt < b.lastAt ? 1 : -1) : a.name < b.name ? -1 : 1));
}
