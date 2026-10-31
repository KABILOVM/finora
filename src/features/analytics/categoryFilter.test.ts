import { describe, expect, it } from 'vitest';
import { categoryFilterOptions, effectiveCategory, filterSpendRows, inCategoryFilter } from './categoryFilter';

// food ⊃ lunch; fun — отдельная категория
const parentOf = new Map<string, string | null>([
  ['food', null],
  ['lunch', 'food'],
  ['fun', null],
]);

describe('фильтр аналитики по категории', () => {
  it('effectiveCategory: только известная категория; неизвестная или пустая — фильтра нет', () => {
    const known = new Set(['food', 'fun']);
    expect(effectiveCategory('food', known)).toBe('food');
    expect(effectiveCategory('ghost', known)).toBeNull();
    expect(effectiveCategory(null, known)).toBeNull();
  });

  it('inCategoryFilter: сама категория и подкатегории; «без категории» при фильтре не проходит; без фильтра проходит всё', () => {
    expect(inCategoryFilter('food', 'food', parentOf)).toBe(true);
    expect(inCategoryFilter('food', 'lunch', parentOf)).toBe(true);
    expect(inCategoryFilter('food', 'fun', parentOf)).toBe(false);
    expect(inCategoryFilter('lunch', 'food', parentOf)).toBe(false); // родитель в подкатегорию не входит
    expect(inCategoryFilter('food', null, parentOf)).toBe(false);
    expect(inCategoryFilter(null, null, parentOf)).toBe(true);
    expect(inCategoryFilter(null, 'fun', parentOf)).toBe(true);
  });

  it('filterSpendRows: оставляет строки категории и подкатегорий, комиссии и «без категории» отбрасывает; без фильтра — копия как есть', () => {
    const rows = [
      { categoryId: 'food', totalMinor: 1 },
      { categoryId: 'lunch', totalMinor: 2 },
      { categoryId: 'fun', totalMinor: 3 },
      { categoryId: null, totalMinor: 4 },
      { categoryId: null, totalMinor: 5, kind: 'fee' as const },
    ];
    expect(filterSpendRows(rows, 'food', parentOf).map((r) => r.totalMinor)).toEqual([1, 2]);
    const all = filterSpendRows(rows, null, parentOf);
    expect(all).toEqual(rows);
    expect(all).not.toBe(rows);
  });

  it('categoryFilterOptions: категории с расходами по названию, без комиссий и «без категории»; выбранная остаётся и без трат', () => {
    const names = new Map([
      ['food', { name: 'Еда' }],
      ['fun', { name: 'Развлечения' }],
      ['car', { name: 'Авто' }],
    ]);
    const rows = [{ categoryId: 'fun' }, { categoryId: 'food' }, { categoryId: 'food' }, { categoryId: null }, { categoryId: null, kind: 'fee' as const }];
    expect(categoryFilterOptions(rows, names, null).map((o) => o.label)).toEqual(['Еда', 'Развлечения']);
    expect(categoryFilterOptions(rows, names, 'car').map((o) => o.label)).toEqual(['Авто', 'Еда', 'Развлечения']);
    expect(categoryFilterOptions(rows, new Map(), 'ghost').map((o) => o.label)).toEqual(['Категория удалена', 'Категория удалена', 'Категория удалена']);
  });
});
