import { useEffect, useState } from 'react';
import type { TxFilter } from '@/db';
import { addMinor, minorToInputString, parseAmountToMinor } from '@/domain/money';
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

/** Фильтры «по умолчанию»: этот месяц, всё остальное выключено. */
export const defaultFilters = (today: IsoDate): ListFilters => ({
  period: 'this',
  month: monthKey(today),
  walletId: '',
  categoryId: '',
  kind: '',
  search: '',
});

/**
 * Фильтры из адреса: `?period=this|prev|all|month&month=ГГГГ-ММ&wallet=<id>&category=<id>|none&kind=expense`. Так ссылки с других
 * экранов (аналитика, чипы кошельков) открывают готовый список, а возврат на страницу «Назад» не теряет выбор. Только `month`
 * без `period` — прежняя ссылка из аналитики: текущий месяц это «Этот месяц», другой — «Другой месяц». Всё, что не похоже на
 * правду (чужой месяц, мусор вместо id), молча пропускается: страница откроется с обычными фильтрами. Поиск в адрес не входит.
 */
export function filtersFromParams(params: URLSearchParams, today: IsoDate): Partial<ListFilters> {
  const out: Partial<ListFilters> = {};
  const month = params.get('month');
  const validMonth = month !== null && MONTH_PARAM.test(month) && month >= MIN_MONTH && month <= MAX_MONTH;
  if (validMonth) out.month = month;
  const period = params.get('period');
  if (period === 'this' || period === 'prev' || period === 'all') out.period = period;
  else if (validMonth) out.period = period === 'month' || month !== monthKey(today) ? 'month' : 'this';
  const wallet = params.get('wallet');
  if (wallet !== null && ID_PARAM.test(wallet)) out.walletId = wallet;
  const category = params.get('category');
  if (category === 'none') out.categoryId = NO_CATEGORY;
  else if (category !== null && ID_PARAM.test(category)) out.categoryId = category;
  const kind = params.get('kind');
  if (kind === 'expense' || kind === 'income' || kind === 'transfer') out.kind = kind;
  return out;
}

/**
 * Обратное к filtersFromParams: только то, что отличается от «по умолчанию» (пустой адрес = обычный список). Выбранный не текущий
 * месяц пишется всегда, даже при другом периоде: вернёмся на «Другой месяц» — он на месте; период тогда пишется явно, иначе
 * `month` без `period` прочлось бы как «Другой месяц».
 */
export function filtersToParams(f: ListFilters, today: IsoDate): URLSearchParams {
  const q = new URLSearchParams();
  const rememberMonth = f.period === 'month' || f.month !== monthKey(today);
  if (f.period !== 'this' || rememberMonth) q.set('period', f.period);
  if (rememberMonth) q.set('month', f.month);
  if (f.walletId !== '') q.set('wallet', f.walletId);
  if (f.categoryId === NO_CATEGORY) q.set('category', 'none');
  else if (f.categoryId !== '') q.set('category', f.categoryId);
  if (f.kind !== '') q.set('kind', f.kind);
  return q;
}

/** Ссылка на операции кошелька (чип на «Главной»): весь срок, так остаток кошелька сходится со списком. Начало адреса — в самой ссылке. */
export const walletOpsQuery = (walletId: string): string => new URLSearchParams({ wallet: walletId, period: 'all' }).toString();

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

/**
 * null — сумма не помещается в безопасное целое (экран должен показать прочерк, а не упасть).
 * walletId — список открыт по кошельку: перевод НА этот кошелёк в списке есть, но комиссию за него платил другой кошелёк,
 * поэтому в расходы дня она не входит.
 */
export function dayTotal(
  items: readonly (Pick<Transaction, 'kind' | 'baseCurrency' | 'baseAmountMinor'> & {
    debtId?: Transaction['debtId'] | undefined;
    walletId?: Transaction['walletId'];
  })[],
  base: CurrencyCode,
  walletId = '',
): DayTotal | null {
  let net: Minor = 0;
  let excluded = 0;
  try {
    for (const t of items) {
      // у перевода baseAmountMinor — комиссия (расход дня); 0 — комиссии нет, считать нечего
      if (t.kind === 'transfer' && t.baseAmountMinor === 0) continue;
      if (t.kind === 'transfer' && walletId !== '' && t.walletId !== walletId) continue;
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
  /** Расходы вместе с комиссиями переводов. */
  expenseMinor: Minor;
  /** Из расходов — комиссии переводов (0, если их не было). */
  feeMinor: Minor;
}

type TotalsItem = Pick<Transaction, 'kind' | 'walletId' | 'amountMinor'> & {
  debtId?: Transaction['debtId'] | undefined;
  toWalletId?: Transaction['toWalletId'] | undefined;
  toAmountMinor?: Transaction['toAmountMinor'] | undefined;
};

/**
 * Комиссия перевода в валюте кошельков: списали больше, чем зачислили, и валюта у кошельков одна (обмен валют комиссии не
 * имеет по определению, см. Transaction.baseAmountMinor). 0 — комиссии нет.
 */
export function transferFeeMinor(
  t: Pick<TotalsItem, 'kind' | 'walletId' | 'amountMinor' | 'toWalletId' | 'toAmountMinor'>,
  currencyOf: (walletId: string) => CurrencyCode | undefined,
): Minor {
  if (t.kind !== 'transfer' || !t.toWalletId || t.toAmountMinor == null || t.amountMinor <= t.toAmountMinor) return 0;
  const from = currencyOf(t.walletId);
  return from !== undefined && from === currencyOf(t.toWalletId) ? t.amountMinor - t.toAmountMinor : 0;
}

/**
 * Доходы и расходы за период по валютам СЧЕТОВ (в родных суммах, без пересчёта). Операции по долгам и сами переводы не входят,
 * а комиссия перевода — расход (как в «Доходах/Расходах» месяца и в итоге дня). Валюты идут в порядке первого появления;
 * слишком большая сумма (RangeError) — null, экран покажет прочерк.
 * walletId — список открыт по кошельку: комиссию за перевод НА него платил другой кошелёк, её здесь нет.
 */
export function totalsByCurrency(
  items: readonly TotalsItem[],
  currencyOf: (walletId: string) => CurrencyCode | undefined,
  walletId = '',
): CurrencyTotal[] | null {
  const by = new Map<CurrencyCode, CurrencyTotal>();
  const bucket = (currency: CurrencyCode): CurrencyTotal => {
    const cur = by.get(currency) ?? { currency, incomeMinor: 0, expenseMinor: 0, feeMinor: 0 };
    by.set(currency, cur);
    return cur;
  };
  try {
    for (const t of items) {
      if (t.kind === 'transfer') {
        if (walletId !== '' && t.walletId !== walletId) continue;
        const fee = transferFeeMinor(t, currencyOf);
        const currency = currencyOf(t.walletId);
        if (fee > 0 && currency) {
          const cur = bucket(currency);
          cur.expenseMinor = addMinor(cur.expenseMinor, fee);
          cur.feeMinor = addMinor(cur.feeMinor, fee);
        }
        continue;
      }
      if (t.debtId != null) continue;
      const currency = currencyOf(t.walletId);
      if (!currency) continue;
      const cur = bucket(currency);
      if (t.kind === 'income') cur.incomeMinor = addMinor(cur.incomeMinor, t.amountMinor);
      else cur.expenseMinor = addMinor(cur.expenseMinor, t.amountMinor);
    }
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  return [...by.values()];
}

/** Что нужно знать о справочниках, чтобы искать операцию по названию категории и кошелька. */
export interface SearchLookups {
  walletName: (id: string) => string | undefined;
  categoryName: (id: string) => string | undefined;
  currencyOf: (walletId: string) => CurrencyCode | undefined;
}

type SearchItem = Pick<Transaction, 'kind' | 'walletId' | 'toWalletId' | 'categoryId' | 'amountMinor' | 'toAmountMinor' | 'note'> & {
  debtId?: Transaction['debtId'] | undefined;
  recurringRuleId?: Transaction['recurringRuleId'] | undefined;
};

const NO_SPACES = /[\s\u00a0\u202f]/g;
const AMOUNT_QUERY = /^\d+(?:[.,]\d*)?$/;

/**
 * Поиск по операции: заметка, название категории («Без категории» тоже ищется), кошелька (и кошелька зачисления) и сумма.
 * Сумма — начало числа: «15» находит 15, 150 и 15,50 (а не 215); «1 500,50» и «1500.5» — одно и то же. Регистр не важен.
 * Пустой запрос подходит всему.
 */
export function matchesSearch(tx: SearchItem, query: string, look: SearchLookups): boolean {
  const needle = query.trim().toLocaleLowerCase('ru');
  if (needle === '') return true;
  const texts = [tx.note, look.walletName(tx.walletId)];
  if (tx.toWalletId) texts.push(look.walletName(tx.toWalletId));
  if (tx.kind !== 'transfer') {
    if (tx.categoryId !== null) texts.push(look.categoryName(tx.categoryId));
    else texts.push(tx.debtId ? 'долг' : 'без категории'); // как подписана строка на экране
  }
  if (tx.debtId) texts.push('долг');
  if (tx.recurringRuleId) texts.push('регулярный платёж');
  if (transferFeeMinor(tx, look.currencyOf) > 0) texts.push('комиссия');
  if (texts.some((t) => t !== undefined && t.toLocaleLowerCase('ru').includes(needle))) return true;

  const digits = needle.replace(NO_SPACES, '');
  if (!AMOUNT_QUERY.test(digits)) return false;
  const amounts: [Minor, CurrencyCode | undefined][] = [[tx.amountMinor, look.currencyOf(tx.walletId)]];
  if (tx.toWalletId && tx.toAmountMinor != null) amounts.push([tx.toAmountMinor, look.currencyOf(tx.toWalletId)]);
  const plain = digits.replace(',', '.').replace(/\.$/, '');
  return amounts.some(([minor, currency]) => {
    if (!currency) return false;
    const shown = minorToInputString(minor, currency).replace(',', '.');
    return shown.startsWith(plain) || parseAmountToMinor(plain, currency) === minor;
  });
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
