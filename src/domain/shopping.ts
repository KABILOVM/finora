import { addMinor, isMinor } from './money';
import type { IsoDateTime, Minor, ShoppingItem, ShoppingUnit, UUID } from './types';

/**
 * Список покупок — ЧИСТЫЕ расчёты (без базы и React). Всё целыми числами: количество в тысячных долях (qtyMilli),
 * деньги в минорных единицах; произведения идут через BigInt, поэтому точность не теряется на больших суммах.
 * Округление денег — до ближайшей минорной единицы, половинка вверх.
 */

export const SHOPPING_UNITS: readonly ShoppingUnit[] = ['pcs', 'kg', 'l'];
export const UNIT_LABEL: Readonly<Record<ShoppingUnit, string>> = { pcs: 'шт', kg: 'кг', l: 'л' };
/** shopping_items.qty_milli: от 1 (0,001) до 1 000 000 000 (1 000 000 единиц). */
export const QTY_MIN = 1;
export const QTY_MAX = 1_000_000_000;
export const NAME_MAX = 80;

/** Разобрать количество из текста ('1,4', '2', '0.25') в тысячные доли. Больше трёх знаков, минус, мусор → null. Штуки — только целые. */
export function parseQty(text: string, unit: ShoppingUnit): number | null {
  const s = text.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const [intRaw = '', frac = ''] = s.split('.');
  if (frac.length > 3) return null;
  if (unit === 'pcs' && frac.replace(/0+$/, '') !== '') return null;
  const digits = `${intRaw === '' ? '0' : intRaw}${frac.padEnd(3, '0')}`;
  if (digits.length > 12) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n >= QTY_MIN && n <= QTY_MAX ? n : null;
}

/** 1400 → '1,4', 3000 → '3', 250 → '0,25'. */
export function formatQty(qtyMilli: number): string {
  const whole = Math.floor(qtyMilli / 1000);
  const frac = String(qtyMilli % 1000).padStart(3, '0').replace(/0+$/, '');
  return frac === '' ? String(whole) : `${whole},${frac}`;
}

/** Строка для поля ввода количества. */
export const qtyToInput = formatQty;

/** 'Молоко 2 л', 'Яблоки 1,4 кг', 'Хлеб × 3'. */
export function itemTitle(name: string, qtyMilli: number, unit: ShoppingUnit): string {
  if (unit === 'pcs') return qtyMilli === 1000 ? name : `${name} × ${formatQty(qtyMilli)}`;
  return `${name} ${formatQty(qtyMilli)} ${UNIT_LABEL[unit]}`;
}

/** Ключ памяти цен: название без регистра, лишних пробелов и «ё» + единица (цена за кг и за шт несравнимы). */
export function priceKey(name: string, unit: ShoppingUnit): string {
  return `${name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')}|${unit}`;
}

/** Деление с округлением половинки вверх (положительные числа). */
function divRound(num: bigint, den: bigint): bigint {
  return (2n * num + den) / (2n * den);
}

/** Цена за единицу (за 1 кг / 1 л / 1 шт) из цены позиции: round(price × 1000 / qtyMilli). */
export function unitPrice(priceMinor: Minor, qtyMilli: number): Minor | null {
  if (!isMinor(priceMinor) || priceMinor < 0 || !Number.isSafeInteger(qtyMilli) || qtyMilli < QTY_MIN) return null;
  const r = divRound(BigInt(priceMinor) * 1000n, BigInt(qtyMilli));
  return r <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(r) : null;
}

/** Ожидаемая цена позиции: round(цена за единицу × количество / 1000). */
export function expectedPrice(unitMinor: Minor, qtyMilli: number): Minor | null {
  if (!isMinor(unitMinor) || unitMinor < 0 || !Number.isSafeInteger(qtyMilli) || qtyMilli < QTY_MIN) return null;
  const r = divRound(BigInt(unitMinor) * BigInt(qtyMilli), 1000n);
  return r <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(r) : null;
}

/** Последняя запомненная цена за единицу по ключу «название|единица»: из купленных позиций, побеждает позднейшая покупка. */
export function priceMemory(items: readonly ShoppingItem[]): Map<string, Minor> {
  const latest = new Map<string, { at: IsoDateTime; id: UUID; unit: Minor }>();
  for (const it of items) {
    if (it.deletedAt !== null || it.purchasedAt === null || it.priceMinor === null) continue;
    const u = unitPrice(it.priceMinor, it.qtyMilli);
    if (u === null) continue;
    const key = priceKey(it.name, it.unit);
    const cur = latest.get(key);
    if (!cur || it.purchasedAt > cur.at || (it.purchasedAt === cur.at && it.id > cur.id)) {
      latest.set(key, { at: it.purchasedAt, id: it.id, unit: u });
    }
  }
  return new Map([...latest].map(([k, v]) => [k, v.unit]));
}

/** Как позиция выглядит в списке. */
export interface ItemView {
  item: ShoppingItem;
  checked: boolean;
  /** Что показать справа: вписанная цена (отмечена) или ожидаемая (нет); null — цена ещё неизвестна. */
  priceMinor: Minor | null;
  /** true — цена ожидаемая (рисуется с «≈»). */
  approx: boolean;
  /** Цена за единицу отмеченной позиции (подпись «13,00 за л»). */
  unitMinor: Minor | null;
  /** Запомненная прошлая цена за единицу («раньше …» / «обычно …»). */
  lastUnitMinor: Minor | null;
}

export function viewItem(item: ShoppingItem, memory: ReadonlyMap<string, Minor>): ItemView {
  const lastUnitMinor = memory.get(priceKey(item.name, item.unit)) ?? null;
  const checked = item.checkedAt !== null && item.priceMinor !== null;
  if (checked) {
    return { item, checked, priceMinor: item.priceMinor, approx: false, unitMinor: unitPrice(item.priceMinor as Minor, item.qtyMilli), lastUnitMinor };
  }
  const exp = lastUnitMinor === null ? null : expectedPrice(lastUnitMinor, item.qtyMilli);
  return { item, checked, priceMinor: exp, approx: true, unitMinor: null, lastUnitMinor };
}

export interface ShoppingTotals {
  /** План: сумма ожидаемых цен ещё не купленных позиций (у кого цена известна). */
  planMinor: Minor;
  /** Сколько позиций в плане без известной цены. */
  unknownCount: number;
  /** В корзине: сумма цен отмеченных позиций. */
  cartMinor: Minor;
  cartCount: number;
}

/** Итоги по активным (не купленные, не удалённые) позициям. Бросает RangeError при переполнении суммы. */
export function totalsOf(items: readonly ShoppingItem[], memory: ReadonlyMap<string, Minor>): ShoppingTotals {
  let planMinor = 0;
  let cartMinor = 0;
  let unknownCount = 0;
  let cartCount = 0;
  for (const it of items) {
    if (it.deletedAt !== null || it.purchasedAt !== null) continue;
    const last = memory.get(priceKey(it.name, it.unit));
    const exp = last === undefined ? null : expectedPrice(last, it.qtyMilli);
    if (exp === null) unknownCount++;
    else planMinor = addMinor(planMinor, exp);
    if (it.checkedAt !== null && it.priceMinor !== null) {
      cartMinor = addMinor(cartMinor, it.priceMinor);
      cartCount++;
    }
  }
  return { planMinor, unknownCount, cartMinor, cartCount };
}

/** Активные позиции в порядке добавления. */
export function activeItems<T extends ShoppingItem>(items: readonly T[]): T[] {
  return items
    .filter((i) => i.deletedAt === null && i.purchasedAt === null)
    .sort((a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1));
}
