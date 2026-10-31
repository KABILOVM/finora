import type { ShoppingUnit } from '../types';

/** Разделы встроенного каталога продуктов (только для поиска и порядка на экране; расход всегда остаётся в категории «Продукты»). */
export type ProductGroupId =
  | 'veg'
  | 'fruit'
  | 'greens'
  | 'meat'
  | 'fish'
  | 'dairy'
  | 'bread'
  | 'grain'
  | 'oil'
  | 'drinks'
  | 'sweets'
  | 'nuts'
  | 'home';

export interface ProductGroup {
  id: ProductGroupId;
  label: string;
}

/**
 * Запись данных каталога: [id, название, раздел, единица цены по умолчанию, синонимы].
 * id — латиницей, не меняется никогда (на него смогут ссылаться данные); название — как пишут в чеке и говорят вслух, именительный падеж;
 * синонимы — другие названия и разговорные слова («картошка» для «Картофеля»), строчными.
 */
export type RawProduct = readonly [
  id: string,
  name: string,
  group: ProductGroupId,
  unit: ShoppingUnit,
  synonyms?: readonly string[],
];

/** Продукт каталога после разбора: ключи — нормализованное название и синонимы. */
export interface Product {
  id: string;
  name: string;
  group: ProductGroupId;
  unit: ShoppingUnit;
  keys: readonly string[];
}
