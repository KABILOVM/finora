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

/**
 * Ключ продукта в истории: продукт каталога («c:kartofel») или своё название («n:курт сушёный»). «Картошка» и «Картофель» — один ключ.
 * По нему считаются цены (stats.ts) и память цен списка покупок (shopping.ts, priceKey).
 */
export function productKeyOf(name: string): string {
  const p = productByName(name);
  return p ? `c:${p.id}` : `n:${normName(name)}`;
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

/** Окончания, которые отсекаем при сравнении основ слов (длинные первыми): «картошки» и «картошка» — одна основа «картош». */
const ENDINGS = [
  'ого', 'его', 'ому', 'ему', 'ами', 'ями', 'ыми', 'ими', 'ией',
  'ов', 'ев', 'ей', 'ом', 'ем', 'ах', 'ях', 'ую', 'юю', 'ая', 'яя', 'ой', 'ый', 'ий', 'ое', 'ее', 'ие', 'ые', 'ам', 'ям', 'ья', 'ье', 'ью', 'ия',
  'а', 'я', 'у', 'ю', 'ы', 'и', 'е', 'о', 'ь', 'й',
];

/** Основа слова: без падежного окончания, но не короче трёх букв («сыра» → «сыр», «чай» остаётся «чай»). */
function stemWord(w: string): string {
  for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length);
  return w;
}
const stemKeyOf = (key: string): string => key.split(' ').map(stemWord).join(' ');

/** Основы всех названий и синонимов → продукт; null — основа у двух разных продуктов (неоднозначно). */
let stemIndex: ReadonlyMap<string, Product | null> | null = null;
function stems(): ReadonlyMap<string, Product | null> {
  if (stemIndex) return stemIndex;
  const m = new Map<string, Product | null>();
  for (const p of CATALOG) {
    for (const k of p.keys) {
      const sk = stemKeyOf(k);
      const cur = m.get(sk);
      if (cur === undefined) m.set(sk, p);
      else if (cur !== null && cur.id !== p.id) m.set(sk, null);
    }
  }
  return (stemIndex = m);
}

/**
 * Уверенное сопоставление названия из голоса или чека с продуктом каталога: «картошки» → Картофель, «Молоко 3,2% 1л» → Молоко.
 * Не угадываем: точное название или синоним, иначе совпадение всех слов по основам (падежи и числа). Неоднозначное («печенья» — печенье
 * или печень), частичное слово («кар») и слова, которых нет в каталоге («Сыр Российский Брест»), — null: пусть человек выберет сам.
 */
export function matchProduct(name: string): Product | null {
  const direct = productByName(name);
  if (direct) return direct;
  // числа, проценты, граммовки («3,2%», «1л», «500г», «С1») названия не меняют
  const tokens = normName(name)
    .split(' ')
    .filter((t) => t.length > 1 && !/\d/.test(t));
  if (tokens.length === 0) return null;
  return BY_KEY.get(tokens.join(' ')) ?? stems().get(stemKeyOf(tokens.join(' '))) ?? null;
}

/** Продукт питания (не «Дом и гигиена»): такая позиция на чеке из магазина относится к категории «Продукты». */
export const isFoodProduct = (p: Product): boolean => p.group !== 'home';

/** Напитки и сладкое на словах чаще «кафе» (кофе, мороженое), чем покупка в магазине: в речи их в «Продукты» сами не кладём. */
const OUT_OF_HOME: ReadonlySet<ProductGroupId> = new Set(['drinks', 'sweets']);

/** Бесспорный продукт для речи: овощи, мясо, молочное, хлеб, крупы… (не напитки, не сладкое, не «Дом и гигиена»). */
export const isStapleProduct = (p: Product): boolean => isFoodProduct(p) && !OUT_OF_HOME.has(p.group);

/**
 * «Автораспределение»: продукт питания, названный на чеке или в речи, без категории попадает в «Продукты» человека (категорию ищем по
 * названию среди его категорий расходов). Для речи — только бесспорные продукты (`staplesOnly`), для чека из магазина — любые
 * продукты питания. Нет такой категории или название не из каталога — null: ничего не навязываем.
 */
export function groceryCategoryFor(name: string, categories: readonly { id: string; name: string }[], opts: { staplesOnly?: boolean } = {}): string | null {
  const p = matchProduct(name);
  if (!p || !(opts.staplesOnly ? isStapleProduct(p) : isFoodProduct(p))) return null;
  return categories.find((c) => normName(c.name) === 'продукты')?.id ?? null;
}

/** Единица по умолчанию для названия из каталога; null — продукта нет в каталоге. */
export function defaultUnitFor(name: string): ShoppingUnit | null {
  return productByName(name)?.unit ?? null;
}
