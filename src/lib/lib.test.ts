import { describe, expect, it } from 'vitest';
import { cn } from './cn';
import { pluralRu } from './plural';

describe('cn', () => {
  it('склеивает строки и пропускает пустые значения', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });
  it('поддерживает массивы и объекты', () => {
    expect(cn(['a', ['b']], { c: true, d: false, e: 1 })).toBe('a b c e');
  });
  it('ноль-число не теряется', () => {
    expect(cn('p', 0)).toBe('p 0');
  });
});

describe('pluralRu', () => {
  const f = (n: number) => pluralRu(n, 'запись', 'записи', 'записей');
  it('склоняет по последней цифре', () => {
    expect([0, 1, 2, 4, 5, 9].map(f)).toEqual(['записей', 'запись', 'записи', 'записи', 'записей', 'записей']);
  });
  it('11–14 всегда «записей»', () => {
    expect([11, 12, 13, 14, 111, 112].map(f)).toEqual(Array(6).fill('записей'));
  });
  it('21, 22, 25, 101', () => {
    expect([21, 22, 25, 101, 102].map(f)).toEqual(['запись', 'записи', 'записей', 'запись', 'записи']);
  });
  it('отрицательные числа — по модулю', () => {
    expect(f(-1)).toBe('запись');
    expect(f(-5)).toBe('записей');
  });
});
