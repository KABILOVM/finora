import { describe, expect, it } from 'vitest';
import { isSearching, matchesQuery, searchKey, SEARCH_MIN_ITEMS, showsSearch } from './search';

describe('searchKey', () => {
  it('без регистра и «ё», пробелы по краям убраны', () => {
    expect(searchKey('  ЁЛКА  ')).toBe('елка');
    expect(searchKey('Мёд')).toBe('мед');
    expect(searchKey('')).toBe('');
  });
});

describe('matchesQuery', () => {
  it('пустой запрос и одни пробелы подходят всему', () => {
    expect(matchesQuery('Молоко', '')).toBe(true);
    expect(matchesQuery('Молоко', '   ')).toBe(true);
    expect(matchesQuery('', '')).toBe(true);
  });

  it('часть слова, без учёта регистра и «ё»', () => {
    expect(matchesQuery('Молоко', 'мол')).toBe(true);
    expect(matchesQuery('Молоко', 'ЛОК')).toBe(true);
    expect(matchesQuery('Мёд', 'мед')).toBe(true);
    expect(matchesQuery('Мед', 'мёд')).toBe(true);
    expect(matchesQuery('Молоко', 'хлеб')).toBe(false);
  });

  it('несколько слов: должны найтись все, в любом порядке', () => {
    expect(matchesQuery('Молоко 3,2% в пакете', 'пакет молоко')).toBe(true);
    expect(matchesQuery('Молоко 3,2% в пакете', 'молоко бутылка')).toBe(false);
    expect(matchesQuery('Аренда · Жильё · Наличные', 'жильё  наличные')).toBe(true); // лишние пробелы в запросе
  });

  it('спецсимволы ищутся как есть, а не как шаблон', () => {
    expect(matchesQuery('Скидка 5%', '5%')).toBe(true);
    expect(matchesQuery('Скидка 5%', '.*')).toBe(false);
    expect(matchesQuery('a+b', 'a+b')).toBe(true);
  });
});

describe('isSearching и showsSearch', () => {
  it('идёт ли поиск: пробелы не считаются', () => {
    expect(isSearching('')).toBe(false);
    expect(isSearching('   ')).toBe(false);
    expect(isSearching(' а ')).toBe(true);
  });

  it('поле видно с SEARCH_MIN_ITEMS элементов; набранный запрос удерживает поле даже в коротком списке', () => {
    expect(showsSearch(SEARCH_MIN_ITEMS - 1, '')).toBe(false);
    expect(showsSearch(SEARCH_MIN_ITEMS, '')).toBe(true);
    expect(showsSearch(0, 'а')).toBe(true);
    expect(showsSearch(0, '   ')).toBe(true); // пробелы тоже запрос: поле остаётся, чтобы их можно было стереть
  });
});
