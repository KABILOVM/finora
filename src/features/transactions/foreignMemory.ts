import { isValidCurrencyCode } from '@/domain/currency';
import type { CurrencyCode } from '@/domain/types';

/**
 * Валюта, в которой в прошлый раз вносили «сумму на чеке»: в поездке платят в одной и той же валюте, и выбирать её при каждой
 * трате незачем. Это удобство этого устройства (localStorage); недоступно хранилище — просто ничего не помним.
 */
const KEY = 'finora:last-foreign-currency';

export function lastForeignCurrency(): CurrencyCode | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v !== null && isValidCurrencyCode(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberForeignCurrency(code: CurrencyCode): void {
  try {
    window.localStorage.setItem(KEY, code);
  } catch {
    // хранилище недоступно: в следующий раз выберут заново
  }
}
