/**
 * Поиск по названию в списках (категории, покупки, регулярные платежи).
 * Регистр и «ё» не важны («Ёлка» = «елка»); в запросе несколько слов — должны найтись все, в любом порядке («молоко 1 л»).
 */

/** Вид строки для сравнения: без регистра и «ё», пробелы по краям убраны. */
export const searchKey = (s: string): string => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();

/** Подходит ли текст под запрос. Пустой запрос (и одни пробелы) подходит всему. */
export function matchesQuery(text: string, query: string): boolean {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = searchKey(text);
  return words.every((w) => hay.includes(w));
}

/** Идёт ли поиск (в поле есть что искать). */
export const isSearching = (query: string): boolean => searchKey(query) !== '';

/** С какого числа элементов в списке показывать поле поиска: в коротком списке оно только мешает. */
export const SEARCH_MIN_ITEMS = 6;

/** Показывать ли поле: список достаточно длинный; уже набранный запрос поле удерживает (иначе его нечем было бы очистить). */
export const showsSearch = (count: number, query: string): boolean => count >= SEARCH_MIN_ITEMS || query !== '';
