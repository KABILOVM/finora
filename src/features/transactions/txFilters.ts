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

/** Часть фильтров, которая живёт в шите «Фильтры» (период и поиск видны на самом экране). */
export type SheetFilters = Pick<ListFilters, 'walletId' | 'kind' | 'categoryId'>;

export const EMPTY_SHEET_FILTERS: SheetFilters = { walletId: '', kind: '', categoryId: '' };

/** Сколько фильтров из шита включено (0–3): это число показывает кнопка «Фильтры». */
export function activeFilterCount(f: SheetFilters): number {
  return (f.walletId !== '' ? 1 : 0) + (f.kind !== '' ? 1 : 0) + (f.categoryId !== '' ? 1 : 0);
}

/**
 * Смена вида в шите. Категория другого вида (или любая, если смотрим переводы) к новому виду не подходит — сбрасывается.
 * categoryKind — вид выбранной категории (undefined: категории нет или это «Без категории»).
 */
export function withKind(f: SheetFilters, kind: '' | TxKind, categoryKind: TxKind | undefined): SheetFilters {
  const drop = kind === 'transfer' || (categoryKind !== undefined && kind !== '' && categoryKind !== kind);
  return drop ? { ...f, kind, categoryId: '' } : { ...f, kind };
}

const KIND_NAMES: Record<TxKind, string> = { expense: 'Расходы', income: 'Доходы', transfer: 'Переводы' };

/** Короткие названия включённых фильтров для строки под поиском: «Карта · Расходы · Еда». */
export function activeFilterLabels(
  f: SheetFilters,
  wallets: readonly { id: string; name: string }[],
  categories: readonly { id: string; name: string }[],
): string[] {
  const out: string[] = [];
  if (f.walletId !== '') out.push(wallets.find((w) => w.id === f.walletId)?.name ?? 'Кошелёк');
  if (f.kind !== '') out.push(KIND_NAMES[f.kind]);
  if (f.categoryId === NO_CATEGORY) out.push('Без категории');
  else if (f.categoryId !== '') out.push(categories.find((c) => c.id === f.categoryId)?.name ?? 'Категория');
  return out;
}

export const MIN_MONTH = '2000-01';
export const MAX_MONTH = '2100-12';

export const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_PARAM = /^[0-9A-Za-z_-]{1,64}$/;

/**
 * Фильтры из адреса: `?month=ГГГГ-ММ&category=<id>|none&kind=expense`. Так ссылки с других экранов (аналитика) открывают готовый
 * список. Всё, что не похоже на правду (чужой месяц, мусор вместо id), молча пропускается: страница откроется с обычными фильтрами.
 */
export function filtersFromParams(params: URLSearchParams, today: IsoDate): Partial<ListFilters> {
  const out: Partial<ListFilters> = {};
  const month = params.get('month');
  if (month !== null && MONTH_PARAM.test(month) && month >= MIN_MONTH && month <= MAX_MONTH) {
    out.period = month === monthKey(today) ? 'this' : 'month';
    out.month = month;
  }
  const category = params.get('category');
  if (category === 'none') out.categoryId = NO_CATEGORY;
  else if (category !== null && ID_PARAM.test(category)) out.categoryId = category;
  const kind = params.get('kind');
  if (kind === 'expense' || kind === 'income' || kind === 'transfer') out.kind = kind;
  return out;
}

/**
 * Строка запроса для ссылки на список операций с готовыми фильтрами (обратное к filtersFromParams): `month=…&category=…&kind=…`.
 * Ссылка пишется как <Link to={`/transactions?${transactionsQuery(…)}`}>: начало адреса фиксировано в самой ссылке, из данных
 * подставляется только закодированный хвост (так требует статический аудит e2e/sec). categoryId null — «без категории».
 */
export function transactionsQuery(f: { month: string; categoryId?: string | null; kind?: TxKind }): string {
  const q = new URLSearchParams({ month: f.month });
  if (f.categoryId === null) q.set('category', 'none');
  else if (f.categoryId !== undefined) q.set('category', f.categoryId);
  if (f.kind !== undefined) q.set('kind', f.kind);
  return q.toString();
}

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
  /**
   * Доходы минус расходы за день в базовой валюте (по снимкам на момент внесения) — те же правила, что в summarizeDay:
   * комиссия перевода — расход, сам перевод не считается, операции по долгам (debtId) не входят.
   */
  netMinor: Minor;
  /** Сколько операций дня не вошло в итог: их снимок сделан в другой (прежней) базовой валюте. */
  excluded: number;
}

/** null — сумма не помещается в безопасное целое (экран должен показать прочерк, а не упасть). */
export function dayTotal(
  items: readonly (Pick<Transaction, 'kind' | 'baseCurrency' | 'baseAmountMinor'> & { debtId?: Transaction['debtId'] | undefined })[],
  base: CurrencyCode,
): DayTotal | null {
  let net: Minor = 0;
  let excluded = 0;
  try {
    for (const t of items) {
      // у перевода baseAmountMinor — комиссия (расход дня); 0 — комиссии нет, считать нечего
      if (t.kind === 'transfer' && t.baseAmountMinor === 0) continue;
      if (t.baseCurrency !== base) {
        excluded++;
        continue;
      }
      if (t.kind === 'transfer') {
        net = addMinor(net, -t.baseAmountMinor);
        continue;
      }
      if (t.debtId != null) continue; // выдача/получение долга и платежи — не доход и не расход
      net = addMinor(net, t.kind === 'income' ? t.baseAmountMinor : -t.baseAmountMinor);
    }
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  return { netMinor: net, excluded };
}

export interface CurrencyTotal {
  currency: CurrencyCode;
  incomeMinor: Minor;
  expenseMinor: Minor;
}

/**
 * Доходы и расходы за период по валютам СЧЕТОВ (в родных суммах, без пересчёта). Операции по долгам и переводы не входят.
 * Валюты идут в порядке первого появления; слишком большая сумма (RangeError) — null, экран покажет прочерк.
 */
export function totalsByCurrency(
  items: readonly (Pick<Transaction, 'kind' | 'walletId' | 'amountMinor'> & { debtId?: Transaction['debtId'] | undefined })[],
  currencyOf: (walletId: string) => CurrencyCode | undefined,
): CurrencyTotal[] | null {
  const by = new Map<CurrencyCode, CurrencyTotal>();
  try {
    for (const t of items) {
      if (t.kind === 'transfer' || t.debtId != null) continue;
      const currency = currencyOf(t.walletId);
      if (!currency) continue;
      const cur = by.get(currency) ?? { currency, incomeMinor: 0, expenseMinor: 0 };
      if (t.kind === 'income') cur.incomeMinor = addMinor(cur.incomeMinor, t.amountMinor);
      else cur.expenseMinor = addMinor(cur.expenseMinor, t.amountMinor);
      by.set(currency, cur);
    }
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  return [...by.values()];
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
