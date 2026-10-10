import { useEffect, useState } from 'react';
import type { TxFilter } from '@/db';
import { addMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor, Transaction, TxKind } from '@/domain/types';
import { monthKey } from '@/lib/dates';

/** Чистая логика фильтров списка операций и итога дня. */

export type PeriodKind = 'this' | 'prev' | 'all' | 'month';

/** Особое значение фильтра по категории: операции без категории. */
export const NO_CATEGORY = '__none__';

export interface ListFilters {
  period: PeriodKind;
  /** 'ГГГГ-ММ' — для period = 'month'. */
  month: string;
  /** '' — любой. */
  walletId: string;
  /** '' — любая, NO_CATEGORY — без категории. */
  categoryId: string;
  /** '' — любой. */
  kind: '' | TxKind;
  search: string;
}

export const MIN_MONTH = '2000-01';
export const MAX_MONTH = '2100-12';

/** Сдвиг месяца 'ГГГГ-ММ' на n месяцев (можно отрицательное). */
export function shiftMonth(key: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new RangeError(`Месяц должен быть в виде ГГГГ-ММ: ${key}`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const y = Math.floor(total / 12);
  return `${String(y).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export const canShiftMonth = (key: string, delta: number): boolean => {
  const next = shiftMonth(key, delta);
  return next >= MIN_MONTH && next <= MAX_MONTH;
};

/** Даты периода (включительно). Весь месяц: с 1-го по «31-е» — сравнение строк, лишние числа ни на что не влияют. */
export function periodRange(period: PeriodKind, month: string, today: IsoDate): { from?: IsoDate; to?: IsoDate } {
  if (period === 'all') return {};
  const key = period === 'this' ? monthKey(today) : period === 'prev' ? shiftMonth(monthKey(today), -1) : month;
  return { from: `${key}-01`, to: `${key}-31` };
}

/** Фильтры экрана → фильтр запроса к базе. search приходит уже «успокоенным» (после паузы в наборе). */
export function toTxFilter(f: ListFilters, search: string, today: IsoDate): TxFilter {
  const out: TxFilter = { ...periodRange(f.period, f.month, today) };
  if (f.walletId !== '') out.walletId = f.walletId;
  if (f.categoryId === NO_CATEGORY) out.categoryId = null;
  else if (f.categoryId !== '') out.categoryId = f.categoryId;
  if (f.kind !== '') out.kind = f.kind;
  if (search.trim() !== '') out.search = search;
  return out;
}

export interface DayTotal {
  /** Доходы минус расходы за день в базовой валюте (по снимкам на момент внесения). Переводы не считаются. */
  netMinor: Minor;
  /** Сколько операций дня не вошло в итог: их снимок сделан в другой (прежней) базовой валюте. */
  excluded: number;
}

/** null — сумма не помещается в безопасное целое (экран должен показать прочерк, а не упасть). */
export function dayTotal(
  items: readonly Pick<Transaction, 'kind' | 'baseCurrency' | 'baseAmountMinor'>[],
  base: CurrencyCode,
): DayTotal | null {
  let net: Minor = 0;
  let excluded = 0;
  try {
    for (const t of items) {
      if (t.kind === 'transfer') continue;
      if (t.baseCurrency !== base) {
        excluded++;
        continue;
      }
      net = addMinor(net, t.kind === 'income' ? t.baseAmountMinor : -t.baseAmountMinor);
    }
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  return { netMinor: net, excluded };
}

/** Значение, которое «догоняет» входное с задержкой: поиск не гоняет запросы на каждую букву. */
export function useDebounced<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return shown;
}
