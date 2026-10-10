import type { CurrencyCode, RateTable } from './types';

/** Курс 1 единицы `from` в единицах `to` по таблице; null, если какой-то из валют в таблице нет. */
export function crossRate(table: RateTable, from: CurrencyCode, to: CurrencyCode): number | null {
  if (from === to) return 1;
  const a = table.perUnit[from];
  const b = table.perUnit[to];
  if (!(typeof a === 'number' && a > 0 && Number.isFinite(a))) return null;
  if (!(typeof b === 'number' && b > 0 && Number.isFinite(b))) return null;
  return a / b;
}

/** Выбирает самую свежую (по asOf) таблицу, где есть обе валюты. */
export function pickRate(
  tables: readonly RateTable[],
  from: CurrencyCode,
  to: CurrencyCode,
): { rate: number; table: RateTable } | null {
  if (from === to) return null;
  const sorted = [...tables].sort((x, y) => (x.asOf < y.asOf ? 1 : x.asOf > y.asOf ? -1 : 0));
  for (const table of sorted) {
    const rate = crossRate(table, from, to);
    if (rate !== null) return { rate, table };
  }
  return null;
}
