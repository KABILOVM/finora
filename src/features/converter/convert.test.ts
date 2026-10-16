import { describe, expect, it } from 'vitest';
import { formatNumber, formatRate, parseAmount } from './convert';

describe('parseAmount', () => {
  it.each([
    ['100', 100],
    ['1 234,5', 1234.5],
    ['1 234.50', 1234.5],
    ['0,25', 0.25],
    ['.5', 0.5],
  ])('%s → %s', (text, n) => expect(parseAmount(text)).toBe(n));
  it.each(['', ' ', '.', 'abc', '1e5', '-5', '1.2.3', '12abc'])('«%s» → null', (text) => expect(parseAmount(text)).toBeNull());
});

describe('форматирование', () => {
  it('сумма: два знака у обычных, значащие цифры у малых', () => {
    expect(formatNumber(1234.5).replace(/\s/g, ' ')).toBe('1 234,50');
    expect(formatNumber(0.00012)).toMatch(/^0,0001/);
    expect(formatNumber(Number.NaN)).toBe('—');
  });
  it('курс', () => {
    expect(formatRate(9.5237)).toBe('9,5237');
    expect(formatRate(1234.5678)).toBe('1 234,57');
    expect(formatRate(0)).toBe('—');
    expect(formatRate(-1)).toBe('—');
  });
});
