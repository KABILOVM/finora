import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AMOUNT_MAX } from '@/db/validate';
import { parseAmountToMinor } from '@/domain/money';
import { amountToMinor, parseZenCurrency, scanAmount } from './amount';

const num = (int: string, frac = '') => ({ kind: 'number', int, frac });
const bad = (code: string) => ({ kind: 'bad', code });

describe('scanAmount: текст суммы', () => {
  it('пусто и нули — «нет суммы»', () => {
    for (const s of ['', '  ', '0', '00', '0,00', '0.00', '0.000', '0,0', '-', '-0', '-0,00', ',0']) {
      expect(scanAmount(s), JSON.stringify(s)).toEqual({ kind: 'zero' });
    }
  });

  it('целые и дробные: точка или запятая', () => {
    expect(scanAmount('12')).toEqual(num('12'));
    expect(scanAmount('12,5')).toEqual(num('12', '5'));
    expect(scanAmount('12.50')).toEqual(num('12', '50'));
    expect(scanAmount('.5')).toEqual(num('0', '5'));
    expect(scanAmount('5.')).toEqual(num('5'));
    expect(scanAmount('+7')).toEqual(num('7'));
  });

  it('пробелы, неразрывные пробелы и апостроф как разделитель тысяч', () => {
    expect(scanAmount('1 234,56')).toEqual(num('1234', '56'));
    expect(scanAmount('1\u00a0234,56')).toEqual(num('1234', '56'));
    expect(scanAmount('1\u202f234.56')).toEqual(num('1234', '56'));
    expect(scanAmount("1'234.56")).toEqual(num('1234', '56'));
  });

  it('«1,000» и «1.000» — неоднозначно (тысяча или единица?), не угадываем', () => {
    for (const s of ['1,000', '1.000', '12,345', '123.456', '999,999']) {
      expect(scanAmount(s), s).toEqual(bad('ambiguous'));
    }
  });

  it('три знака после запятой там, где это не может быть тысячей, — просто лишние знаки', () => {
    expect(scanAmount('1234,567')).toEqual(num('1234', '567'));
    expect(scanAmount('0,500')).toEqual(num('0', '500'));
    expect(scanAmount('12,3456')).toEqual(num('12', '3456'));
  });

  it('оба знака: последний десятичный, другой — тысячи (если группы по три)', () => {
    expect(scanAmount('1.000,50')).toEqual(num('1000', '50'));
    expect(scanAmount('1,000.50')).toEqual(num('1000', '50'));
    expect(scanAmount('12,345,678.9')).toEqual(num('12345678', '9'));
    expect(scanAmount('1,00.50')).toEqual(bad('unreadable'));
    expect(scanAmount('1.2.3,4')).toEqual(bad('unreadable'));
    expect(scanAmount('1,000.5.5')).toEqual(bad('unreadable'));
  });

  it('несколько одинаковых знаков — это тысячи', () => {
    expect(scanAmount('1,000,000')).toEqual(num('1000000'));
    expect(scanAmount('1.000.000')).toEqual(num('1000000'));
    expect(scanAmount('1,00,000')).toEqual(bad('unreadable'));
    expect(scanAmount('1,,000')).toEqual(bad('unreadable'));
  });

  it('минус — отрицательная сумма; степени, буквы, знаки валют — нечитаемо', () => {
    expect(scanAmount('-5')).toEqual(bad('negative'));
    expect(scanAmount('−5,50')).toEqual(bad('negative'));
    for (const s of ['1e5', '1E15', '12abc', '$5', '5 с.', '١٢٣', 'NaN', 'Infinity', '--5', '5-', ',', '.', '1 2 3a', '0x10']) {
      expect(scanAmount(s).kind, s).not.toBe('number');
      expect(scanAmount(s).kind, s).toBe(s === '--5' ? 'bad' : 'bad');
    }
    expect(scanAmount('1e15')).toEqual(bad('unreadable'));
  });
});

describe('amountToMinor: в минорные единицы без float', () => {
  it('обычные суммы', () => {
    expect(amountToMinor({ int: '12', frac: '5' }, 'TJS')).toEqual({ ok: true, minor: 1250 });
    expect(amountToMinor({ int: '0', frac: '07' }, 'TJS')).toEqual({ ok: true, minor: 7 });
    expect(amountToMinor({ int: '1000', frac: '' }, 'USD')).toEqual({ ok: true, minor: 100000 });
  });

  it('суммы, на которых float ошибается', () => {
    for (const [int, frac, minor] of [
      ['4', '35', 435],
      ['1', '15', 115],
      ['0', '29', 29],
      ['1', '005', null],
      ['8', '2', 820],
      ['19', '99', 1999],
    ] as const) {
      const r = amountToMinor({ int, frac }, 'TJS');
      if (minor === null) expect(r).toEqual({ ok: false, code: 'precision' });
      else expect(r).toEqual({ ok: true, minor });
    }
  });

  it('ведущие нули не делают число «слишком длинным»', () => {
    expect(amountToMinor({ int: '0000000000000012', frac: '5' }, 'TJS')).toEqual({ ok: true, minor: 1250 });
    expect(amountToMinor({ int: '000', frac: '07' }, 'TJS')).toEqual({ ok: true, minor: 7 });
  });

  it('больше знаков после запятой, чем у валюты — отказ, не округление', () => {
    expect(amountToMinor({ int: '1', frac: '001' }, 'TJS')).toEqual({ ok: false, code: 'precision' });
    expect(amountToMinor({ int: '1', frac: '5' }, 'JPY')).toEqual({ ok: false, code: 'precision' });
    expect(amountToMinor({ int: '1500', frac: '' }, 'JPY')).toEqual({ ok: true, minor: 1500 });
  });

  it('граница сервера: 1e15 минорных единиц можно, на единицу больше — нет', () => {
    expect(AMOUNT_MAX).toBe(1_000_000_000_000_000);
    expect(amountToMinor({ int: '10000000000000', frac: '00' }, 'TJS')).toEqual({ ok: true, minor: AMOUNT_MAX });
    expect(amountToMinor({ int: '10000000000000', frac: '01' }, 'TJS')).toEqual({ ok: false, code: 'big' });
    expect(amountToMinor({ int: '99999999999999999', frac: '' }, 'TJS')).toEqual({ ok: false, code: 'big' });
    expect(amountToMinor({ int: '9'.repeat(40), frac: '99' }, 'TJS')).toEqual({ ok: false, code: 'big' });
  });

  it('согласовано с parseAmountToMinor приложения на любых «чистых» суммах', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10 ** 12 }), fc.integer({ min: 0, max: 99 }), (whole, cents) => {
        const frac = String(cents).padStart(2, '0');
        const mine = amountToMinor({ int: String(whole), frac }, 'TJS');
        const theirs = parseAmountToMinor(`${whole}.${frac}`, 'TJS');
        if (whole === 0 && cents === 0) return;
        expect(mine.ok ? mine.minor : null).toBe(theirs);
        if (theirs !== null) expect(theirs).toBe(whole * 100 + cents);
      }),
    );
  });

  it('разбор текста целиком: любая «чистая» запись даёт то же число', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 ** 12 }), fc.constantFrom('.', ','), (cents, sep) => {
        const whole = Math.floor(cents / 100);
        const text = `${whole}${sep}${String(cents % 100).padStart(2, '0')}`;
        const scanned = scanAmount(text);
        expect(scanned.kind).toBe('number');
        if (scanned.kind !== 'number') return;
        expect(amountToMinor(scanned, 'TJS')).toEqual({ ok: true, minor: cents });
      }),
    );
  });
});

describe('parseZenCurrency', () => {
  it('три латинские буквы в любом регистре и со пробелами', () => {
    expect(parseZenCurrency('TJS')).toBe('TJS');
    expect(parseZenCurrency(' usd ')).toBe('USD');
    expect(parseZenCurrency('Rub')).toBe('RUB');
  });

  it('понятные знаки', () => {
    expect(parseZenCurrency('$')).toBe('USD');
    expect(parseZenCurrency('€')).toBe('EUR');
    expect(parseZenCurrency('руб.')).toBe('RUB');
    expect(parseZenCurrency('сомони')).toBe('TJS');
  });

  it('непонятное — null, не гадаем', () => {
    for (const s of ['', ' ', 'сом', 'US', 'TJSX', '123', 'доллар', '¥']) expect(parseZenCurrency(s), s).toBeNull();
  });
});
