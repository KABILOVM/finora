import { addMinor, convertMinor } from './money';
import type { CurrencyCode, Minor } from './types';

export interface BalanceItem {
  currency: CurrencyCode;
  balanceMinor: Minor;
}

export interface TotalInBase {
  /** Сумма в базовой валюте по тем валютам, для которых курс известен. */
  totalMinor: Minor;
  /** Валюты, для которых курса нет: они НЕ вошли в итог (интерфейс обязан это показать). */
  missing: CurrencyCode[];
}

/**
 * Итог по кошелькам в базовой валюте. Сначала ТОЧНО суммируются остатки внутри каждой валюты (целые числа),
 * и только потом каждая сумма переводится по курсу один раз — так ошибка округления не копится по кошелькам.
 * getRate(from, to) — единиц `to` за 1 единицу `from`; null/некорректный курс = «курса нет».
 */
export function totalInBase(
  items: readonly BalanceItem[],
  base: CurrencyCode,
  getRate: (from: CurrencyCode, to: CurrencyCode) => number | null,
): TotalInBase {
  const perCurrency = new Map<CurrencyCode, Minor>();
  for (const it of items) perCurrency.set(it.currency, addMinor(perCurrency.get(it.currency) ?? 0, it.balanceMinor));

  let totalMinor: Minor = 0;
  const missing: CurrencyCode[] = [];
  for (const [currency, sum] of perCurrency) {
    if (currency === base) {
      totalMinor = addMinor(totalMinor, sum);
      continue;
    }
    const rate = getRate(currency, base);
    if (rate === null || !Number.isFinite(rate) || rate <= 0) {
      missing.push(currency);
      continue;
    }
    totalMinor = addMinor(totalMinor, convertMinor(sum, currency, base, rate));
  }
  return { totalMinor, missing: missing.sort() };
}
