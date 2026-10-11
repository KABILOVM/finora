import type { CurrencyCode } from './types';

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  /** Короткий символ для интерфейса (ставится ПОСЛЕ суммы). */
  symbol: string;
  /** Сколько знаков после запятой: 2 → минорная единица = 1/100 */
  exponent: number;
}

/** Валюты, доступные при создании кошелька. Остальные коды ISO тоже работают (exponent 2, символ = код). */
export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'TJS', name: 'Сомони', symbol: 'с.', exponent: 2 },
  { code: 'USD', name: 'Доллар США', symbol: '$', exponent: 2 },
  { code: 'EUR', name: 'Евро', symbol: '€', exponent: 2 },
  { code: 'RUB', name: 'Российский рубль', symbol: '₽', exponent: 2 },
  { code: 'KZT', name: 'Тенге', symbol: '₸', exponent: 2 },
  { code: 'UZS', name: 'Узбекский сум', symbol: 'сум', exponent: 2 },
  { code: 'KGS', name: 'Киргизский сом', symbol: 'сом', exponent: 2 },
  { code: 'CNY', name: 'Юань', symbol: '¥', exponent: 2 },
  { code: 'TRY', name: 'Турецкая лира', symbol: '₺', exponent: 2 },
  { code: 'AED', name: 'Дирхам ОАЭ', symbol: 'AED', exponent: 2 },
  { code: 'GBP', name: 'Фунт стерлингов', symbol: '£', exponent: 2 },
  { code: 'KRW', name: 'Вона', symbol: '₩', exponent: 0 },
  { code: 'JPY', name: 'Иена', symbol: 'JP¥', exponent: 0 },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyInfo(code: CurrencyCode): CurrencyInfo {
  return BY_CODE.get(code) ?? { code, name: code, symbol: code, exponent: 2 };
}

export function exponentOf(code: CurrencyCode): number {
  return currencyInfo(code).exponent;
}

/** 10^exponent: сколько минорных единиц в одной основной. */
export function factorOf(code: CurrencyCode): number {
  return 10 ** exponentOf(code);
}

export function isValidCurrencyCode(code: unknown): code is CurrencyCode {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}
