import type { ShoppingUnit } from '../types';
import { PRODUCT_GROUPS, RAW_PRODUCTS } from './data';
import type { Product, ProductGroup, ProductGroupId } from './types';

/**
 * Встроенный каталог продуктов: общий для всех, без цен (цены личные, считаются по покупкам человека, см. stats.ts).
 * Названия в чеках и в речи пишут по-разному («картошка», «картофель молодой»), поэтому поиск знает синонимы и падежи.
 */
export type { Product, ProductGroup, ProductGroupId };
export { PRODUCT_GROUPS };

/** Ключ для сравнения названий: без регистра, «ё», знаков и лишних пробелов («Яйца, С1» → «яйца с1»). */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const CATALOG: readonly Product[] = RAW_PRODUCTS.map(([id, name, group, unit, synonyms = []]) => ({
  id,
  name,
  group,
  unit,
  keys: [...new Set([normName(name), ...synonyms.map(normName)])].filter((k) => k !== ''),
}));

const BY_ID: ReadonlyMap<string, Product> = new Map(CATALOG.map((p) => [p.id, p]));
// Если ключ (название или синоним) встречается у двух продуктов, побеждает тот, что выше в списке; тест следит, что такого нет.
const BY_KEY: ReadonlyMap<string, Product> = (() => {
  const m = new Map<string, Product>();
  for (const p of CATALOG) for (const k of p.keys) if (!m.has(k)) m.set(k, p);
  return m;
})();

export const productById = (id: string): Product | undefined => BY_ID.get(id);

/** Продукт каталога по названию или синониму (точное совпадение после нормализации). */
export function productByName(name: string): Product | undefined {
  const k = normName(name);
  return k === '' ? undefined : BY_KEY.get(k);
}

/** Начало слова без падежного окончания: «картошки» → «картошк», «помидоров» → «помидор». Короткие слова не трогаем. */
function stemOf(token: string): string {
  if (token.length >= 7) return token.slice(0, -2);
  if (token.length >= 5) return token.slice(0, -1);
  return token;
}

/** Совпадает ли запрос с ключом: точно (3), по началу ключа (2), по началам слов (1); иначе 0. */
function scoreKey(queryTokens: readonly string[], query: string, key: string): number {
  if (key === query) return 4;
  if (key.startsWith(query)) return 3;
  const words = key.split(' ');
  const hit = queryTokens.every((q) => {
    const stem = stemOf(q);
    return words.some((w) => w.startsWith(q) || w.startsWith(stem));
  });
  if (hit) return 2;
  return queryTokens.every((q) => key.includes(stemOf(q))) ? 1 : 0;
}

/**
 * Поиск по каталогу для строки поиска и подсказок: лучшие совпадения первыми (точное название или синоним, потом начало, потом слова,
 * потом вхождение), при равенстве — как в каталоге. Пустой запрос — пустой список.
 */
export function searchCatalog(query: string, opts: { limit?: number; group?: ProductGroupId } = {}): Product[] {
  const q = normName(query);
  if (q === '') return [];
  const tokens = q.split(' ');
  const scored: { p: Product; score: number; order: number }[] = [];
  CATALOG.forEach((p, order) => {
    if (opts.group !== undefined && p.group !== opts.group) return;
    let best = 0;
    for (const k of p.keys) best = Math.max(best, scoreKey(tokens, q, k));
    if (best > 0) scored.push({ p, score: best, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const out = scored.map((s) => s.p);
  return opts.limit === undefined ? out : out.slice(0, opts.limit);
}

/** Единица по умолчанию для названия из каталога; null — продукта нет в каталоге. */
export function defaultUnitFor(name: string): ShoppingUnit | null {
  return productByName(name)?.unit ?? null;
}
