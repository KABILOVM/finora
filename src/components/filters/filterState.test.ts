import { describe, expect, it } from 'vitest';
import { countFilters, emptyFilters, filterLabels, isEmptyFilter, pruneFilters, valueOf, type FilterField } from './filterState';

const FIELDS: FilterField[] = [
  { key: 'category', label: 'Категория', type: 'select', anyLabel: 'Все категории', options: [{ value: 'food', label: 'Еда' }, { value: 'fun', label: 'Развлечения' }] },
  { key: 'level', label: 'Статус', type: 'chips', anyLabel: 'Любой', options: [{ value: 'ok', label: 'В норме' }, { value: 'over', label: 'Исчерпано' }] },
];

describe('filterState', () => {
  it('пустой набор: все поля «любые», включённых нет', () => {
    const empty = emptyFilters(FIELDS);
    expect(empty).toEqual({ category: '', level: '' });
    expect(countFilters(FIELDS, empty)).toBe(0);
    expect(isEmptyFilter(FIELDS, empty)).toBe(true);
    expect(filterLabels(FIELDS, empty)).toEqual([]);
  });

  it('считает и называет включённые поля в порядке полей', () => {
    const v = { level: 'over', category: 'food' };
    expect(countFilters(FIELDS, v)).toBe(2);
    expect(filterLabels(FIELDS, v)).toEqual(['Еда', 'Исчерпано']);
  });

  it('лишние ключи и пропущенные значения не мешают', () => {
    expect(countFilters(FIELDS, { other: 'x' })).toBe(0);
    expect(valueOf({}, 'category')).toBe('');
  });

  it('исчезнувший вариант считается «любым»', () => {
    expect(pruneFilters(FIELDS, { category: 'gone', level: 'ok' })).toEqual({ category: '', level: 'ok' });
  });

  it('у выбранного значения без варианта подпись — название поля, а не пустота', () => {
    expect(filterLabels(FIELDS, { category: 'gone' })).toEqual(['Категория']);
  });
});
