import { exponentOf, factorOf, currencyInfo } from './currency';
import type { CurrencyCode, Minor } from './types';

/**
 * Правила денег Finora:
 *  1) сумма — всегда целое число минорных единиц (Number.isSafeInteger), без дробных;
 *  2) разбор строки и форматирование — только целочисленная арифметика (без Number("12.34") * 100);
 *  3) переполнение — ошибка, а не тихая потеря точности.
 */

export function isMinor(n: unknown): n is Minor {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

export function assertMinor(n: unknown, what = 'сумма'): asserts n is Minor {
  if (!isMinor(n)) throw new RangeError(`${what}: ожидалось целое безопасное число, получено ${String(n)}`);
}

export function addMinor(a: Minor, b: Minor): Minor {
  assertMinor(a);
  assertMinor(b);
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new RangeError('Переполнение суммы');
  return r;
}

export function sumMinor(values: readonly Minor[]): Minor {
  let acc = 0;
  for (const v of values) acc = addMinor(acc, v);
  return acc;
}

const SPACES = /[\s   ']/g;

/**
 * '12,5' → 1250 (TJS). Принимает пробелы-разделители тысяч, запятую или точку (одну). Минус, буквы, степени — null.
 * Больше знаков после запятой, чем у валюты → null ВСЕГДА, даже если лишние знаки нули:
 * '1,000' — это не «одна тысяча», а двусмысленная запись (для человека с английской привычкой
 * запятая = разделитель тысяч), и молча прочитать её как 1 значило бы ошибиться в 1000 раз.
 * Ноль допустим ('0' → 0); проверку «> 0» делает вызывающий код.
 */
export function parseAmountToMinor(input: string, currency: CurrencyCode): Minor | null {
  if (typeof input !== 'string') return null;
  const s = input.replace(SPACES, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const [intRaw = '', frac = ''] = s.split('.');
  const exp = exponentOf(currency);
  if (frac.length > exp) return null;
  const digits = (intRaw === '' ? '0' : intRaw) + frac.padEnd(exp, '0');
  if (digits.length > 16) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

export interface FormatOptions {
  /** 'auto' — скрывать «,00»; 'always' — всегда показывать знаки после запятой. */
  fraction?: 'auto' | 'always';
  /** Показывать символ валюты после суммы (по умолчанию да). */
  symbol?: boolean;
  /** '-' для отрицательных всегда; '+' для положительных при 'always'. По умолчанию 'auto' (только минус). */
  sign?: 'auto' | 'always' | 'never';
}

const NBSP = ' ';

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 123450, 'TJS' → '1 234,50 с.' (между цифрами и символом — неразрывный пробел). Только целочисленная арифметика. */
export function formatMinor(minor: Minor, currency: CurrencyCode, opts: FormatOptions = {}): string {
  assertMinor(minor);
  const { fraction = 'auto', symbol = true, sign = 'auto' } = opts;
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const factor = factorOf(currency);
  const exp = exponentOf(currency);
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  let body = groupThousands(String(whole));
  if (exp > 0 && (fraction === 'always' || frac !== 0)) {
    body += ',' + String(frac).padStart(exp, '0');
  }
  let prefix = '';
  if (sign !== 'never') {
    if (neg) prefix = '−';
    else if (sign === 'always' && abs > 0) prefix = '+';
  }
  return prefix + body + (symbol ? NBSP + currencyInfo(currency).symbol : '');
}

/** Строка для поля ввода: 1250,'TJS' → '12,5'; 100 → '1'. */
export function minorToInputString(minor: Minor, currency: CurrencyCode): string {
  assertMinor(minor);
  const factor = factorOf(currency);
  const exp = exponentOf(currency);
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  const fracStr = exp > 0 ? String(frac).padStart(exp, '0').replace(/0+$/, '') : '';
  return (minor < 0 ? '-' : '') + String(whole) + (fracStr ? ',' + fracStr : '');
}

/**
 * Пересчёт суммы в минорных единицах между валютами.
 * rate = сколько единиц `to` за 1 основную единицу `from` (например USD→TJS = 10.9).
 * Округление — «от нуля» на половинке. rate обязан быть конечным и > 0.
 */
export function convertMinor(minor: Minor, from: CurrencyCode, to: CurrencyCode, rate: number): Minor {
  assertMinor(minor);
  if (from === to) return minor;
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`Некорректный курс: ${rate}`);
  const major = Math.abs(minor) / factorOf(from);
  const out = Math.round(major * rate * factorOf(to));
  if (!Number.isSafeInteger(out)) throw new RangeError('Переполнение при пересчёте валюты');
  return minor < 0 ? -out : out;
}

/** Знаков курса в базе данных: колонка fx_rate — numeric(20,10). Курс в операции округляем так же, чтобы локальная копия == серверной. */
export const FX_RATE_DECIMALS = 10;

/**
 * Снимок «сумма в базовой валюте» для сохранения в операции.
 * Курс сначала округляется до FX_RATE_DECIMALS знаков, и сумма считается уже по округлённому курсу —
 * тогда то, что лежит на телефоне, побитово совпадает с тем, что вернёт сервер.
 */
export function fxSnapshot(
  amountMinor: Minor,
  walletCurrency: CurrencyCode,
  baseCurrency: CurrencyCode,
  rate: number | null,
): { baseAmountMinor: Minor; fxRate: number } {
  if (walletCurrency === baseCurrency) return { baseAmountMinor: amountMinor, fxRate: 1 };
  if (rate === null) throw new RangeError(`Нет курса ${walletCurrency}→${baseCurrency}`);
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`Некорректный курс: ${rate}`);
  const stored = Number(rate.toFixed(FX_RATE_DECIMALS));
  if (!(stored > 0)) throw new RangeError(`Курс слишком мал для хранения: ${rate}`);
  return { baseAmountMinor: convertMinor(amountMinor, walletCurrency, baseCurrency, stored), fxRate: stored };
}
