import { describe, expect, it } from 'vitest';
import { applyPctKey } from './FeeField';

describe('applyPctKey: экранная клавиатура в поле процента', () => {
  it('цифры добавляются, не длиннее 8 знаков', () => {
    expect(applyPctKey('', '1')).toBe('1');
    expect(applyPctKey('1,5', '2')).toBe('1,52');
    expect(applyPctKey('12345678', '9')).toBe('12345678');
  });
  it('запятая одна; в пустом поле даёт «0,»', () => {
    expect(applyPctKey('', ',')).toBe('0,');
    expect(applyPctKey('2', ',')).toBe('2,');
    expect(applyPctKey('2,5', ',')).toBe('2,5');
    expect(applyPctKey('2.5', ',')).toBe('2.5');
  });
  it('«стереть» убирает последний знак, в пустом поле ничего не ломает', () => {
    expect(applyPctKey('1,5', 'backspace')).toBe('1,');
    expect(applyPctKey('', 'backspace')).toBe('');
  });
  it('знаки действий и «=» игнорируются', () => {
    expect(applyPctKey('1', '+')).toBe('1');
    expect(applyPctKey('1', '=')).toBe('1');
  });
});
