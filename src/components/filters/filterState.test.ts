import { describe, expect, it } from 'vitest';
import { countFilters, emptyFilters, filterLabels, isEmptyFilter, pruneFilters, valueOf, type FilterField } from './filterState';

const fields: FilterField[] = [
  { key: 'kind', label: 'Вид', type: 'chips', anyLabel: 'Все виды', options: [{ value: 'a', label: 'Альфа' }, { value: 'b', label: 'Бета' }] },
  { key: 'cat', label: 'Категория', type: 'select', anyLabel: 'Все категории', options: [{ value: 'x', label: 'Икс' }] },
];

describe('логика универсальных фильтров', () => {
  it('emptyFilters: все поля — «любой»', () => {
    expect(emptyFilters(fields)).toEqual({ kind: '', cat: '' });
    expect(emptyFilters([])).toEqual({});
  });

  it('valueOf: нет значения — пустая строка', () => {
    expect(valueOf({ kind: 'a' }, 'kind')).toBe('a');
    expect(valueOf({}, 'kind')).toBe('');
  });

  it('countFilters считает только поля из набора; лишние ключи не в счёт', () => {
    expect(countFilters(fields, { kind: 'a', cat: '' })).toBe(1);
    expect(countFilters(fields, { kind: 'a', cat: 'x', other: 'y' })).toBe(2);
    expect(countFilters(fields, { other: 'y' })).toBe(0);
    expect(isEmptyFilter(fields, {})).toBe(true);
    expect(isEmptyFilter(fields, { cat: 'x' })).toBe(false);
  });

  it('pruneFilters: выбор, которого больше нет среди вариантов, становится «любым»; лишние ключи отбрасываются', () => {
    expect(pruneFilters(fields, { kind: 'b', cat: 'удалена', other: 'y' })).toEqual({ kind: 'b', cat: '' });
    expect(pruneFilters(fields, {})).toEqual({ kind: '', cat: '' });
  });

  it('filterLabels: названия включённых в порядке полей; название поля, если варианта уже нет', () => {
    expect(filterLabels(fields, { kind: 'b', cat: 'x' })).toEqual(['Бета', 'Икс']);
    expect(filterLabels(fields, { cat: 'x' })).toEqual(['Икс']);
    expect(filterLabels(fields, { kind: 'нет' })).toEqual(['Вид']);
    expect(filterLabels(fields, {})).toEqual([]);
  });
});
