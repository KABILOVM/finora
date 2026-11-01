import { normName, searchCatalog } from '@/domain/products/catalog';
import { ownProducts, statsForProduct, type PriceBook, type ProductStats } from '@/domain/products/stats';
import type { ShoppingUnit } from '@/domain/types';

/** Что можно выбрать в подсказках: продукт каталога, свой продукт из истории или (в окне «Что куплено») новое название. */
export interface Choice {
  key: string;
  name: string;
  /** Единица, в которой продукт обычно покупают: из истории, иначе из каталога. */
  unit: ShoppingUnit;
  stats: ProductStats | null;
  /** Новое название: в каталоге и истории такого нет. */
  fresh?: boolean;
}

/**
 * Подсказки по набранному: продукты каталога (с падежами и синонимами: «картошки» → «Картофель») и свои продукты из истории покупок,
 * у каждого — личные цены. Пусто, пока ничего не набрано.
 */
export function searchProducts(query: string, book: PriceBook, limit: number): Choice[] {
  const q = normName(query);
  if (q === '') return [];
  const found: Choice[] = searchCatalog(query, { limit }).map((p) => {
    const stats = statsForProduct(book, p);
    return { key: `c:${p.id}`, name: p.name, unit: stats?.unit ?? p.unit, stats };
  });
  const own = ownProducts(book)
    .filter((s) => normName(s.name).includes(q))
    .slice(0, limit)
    .map((s): Choice => ({ key: `n:${s.key}|${s.unit}`, name: s.name, unit: s.unit, stats: s }));
  return [...found, ...own].slice(0, limit);
}
