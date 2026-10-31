import type { ShoppingItem, ShoppingUnit } from './types';
import type { ParsedItem } from './shoppingAi';
import { matchProduct } from './products/catalog';

/**
 * «Каталог» покупок — то, что человек уже вносил в список: название в его написании и единица, в которой он это берёт.
 * Из него разбор списка подтягивает названия и единицы, а цены берутся из памяти цен (domain/shopping.ts, priceMemory).
 */
export interface CatalogEntry {
  name: string;
  unit: ShoppingUnit;
}

/** Название без регистра, «ё» и лишних пробелов. */
export const nameKey = (name: string): string => name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** Основа слова без падежного окончания: молоко / молока → «молок»; короткие слова не трогаем. */
const stem = (w: string): string => (w.length > 4 ? w.replace(/[аяоеиыуюьй]+$/, '') : w);
const stemKey = (name: string): string => nameKey(name).split(' ').map(stem).join(' ');

/** Каталог из позиций списка: по одной записи на название; побеждает самая свежая позиция (покупка, иначе добавление). */
export function buildCatalog(items: readonly ShoppingItem[]): CatalogEntry[] {
  const latest = new Map<string, { at: string; entry: CatalogEntry }>();
  for (const it of items) {
    if (it.deletedAt !== null) continue;
    const key = nameKey(it.name);
    if (key === '') continue;
    const at = it.purchasedAt ?? it.createdAt;
    const cur = latest.get(key);
    if (!cur || at > cur.at) latest.set(key, { at, entry: { name: it.name.trim(), unit: it.unit } });
  }
  return [...latest.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).map((v) => v.entry);
}

/** Запись каталога для названия: точное совпадение, иначе то же слово в другом падеже или числе («яблоко» — «яблоки»). */
export function findInCatalog(name: string, catalog: readonly CatalogEntry[]): CatalogEntry | null {
  const key = nameKey(name);
  if (key === '') return null;
  const exact = catalog.find((c) => nameKey(c.name) === key);
  if (exact) return exact;
  const sk = stemKey(name);
  return catalog.find((c) => stemKey(c.name) === sk) ?? null;
}

/**
 * Привязка позиции к каталогу: название берётся в написании человека. Единицу каталога берём, только если количество не называли
 * (штука в единственном числе), — названную вслух единицу («2 литра») не меняем.
 */
export function bindToCatalog(item: ParsedItem, catalog: readonly CatalogEntry[]): ParsedItem {
  const hit = findInCatalog(item.name, catalog);
  if (!hit) return item;
  const defaultQty = item.unit === 'pcs' && item.qtyMilli === 1000;
  if (!defaultQty || hit.unit === 'pcs') return { ...item, name: hit.name };
  return { ...item, name: hit.name, unit: hit.unit };
}

/**
 * Привязка к встроенному каталогу продуктов: «картошки» → «Картофель», единица каталога — только если количество не называли
 * (названную вслух единицу не меняем). Не нашли или неоднозначно — позиция как есть: в окне разбора она будет помечена «Новый продукт».
 */
export function bindToProducts(item: ParsedItem): ParsedItem {
  const p = matchProduct(item.name);
  if (!p) return item;
  const defaultQty = item.unit === 'pcs' && item.qtyMilli === 1000;
  if (!defaultQty || p.unit === 'pcs') return { ...item, name: p.name };
  return { ...item, name: p.name, unit: p.unit };
}

/** Позиция из речи: сначала то, что человек уже вносил (его написание), потом встроенный каталог продуктов. */
export function bindItem(item: ParsedItem, history: readonly CatalogEntry[]): ParsedItem {
  return findInCatalog(item.name, history) ? bindToCatalog(item, history) : bindToProducts(item);
}

/** Подсказки из каталога по набранному: названия, где есть введённое (без точного совпадения). */
export function suggestFromCatalog(query: string, catalog: readonly CatalogEntry[], limit = 5): CatalogEntry[] {
  const q = nameKey(query);
  if (q === '') return [];
  return catalog
    .filter((c) => {
      const k = nameKey(c.name);
      return k !== q && k.includes(q);
    })
    .slice(0, limit);
}
