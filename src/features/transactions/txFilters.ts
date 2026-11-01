import { useEffect, useState } from 'react';
import type { TxFilter } from '@/db';
import { hasChildren, withDescendants, type TreeNode } from '@/features/categories/categoryTree';
import { exponentOf } from '@/domain/currency';
import { addMinor, minorToInputString, parseAmountToMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor, Transaction, TxKind } from '@/domain/types';
import { addDays, isValidIsoDate, monthKey } from '@/lib/dates';

/** Чистая логика фильтров списка операций и итога дня. */

/**
 * this/prev — этот и прошлый месяц; 7d/30d — последние 7 и 30 дней по сегодня включительно; all — всё время;
 * month — выбранный месяц; range — свои даты (поля from и to).
 */
export type PeriodKind = 'this' | 'prev' | '7d' | '30d' | 'all' | 'month' | 'range';

/** Особое значение фильтра по категории: операции без категории. */
export const NO_CATEGORY = '__none__';

/** Откуда операция: '' — любая; recurring — создана регулярным платежом; debt — движение денег по долгу. */
export type SourceFilter = '' | 'recurring' | 'debt';

export interface ListFilters {
  period: PeriodKind;
  /** 'ГГГГ-ММ' — для period = 'month'. */
  month: string;
  /** Свои даты для period = 'range' (включительно); в остальных периодах не используются. '' — не задано. */
  from: IsoDate | '';
  to: IsoDate | '';
  /** '' — любой. */
  walletId: string;
  /** '' — любая, NO_CATEGORY — без категории. */
  categoryId: string;
  /** '' — любой. */
  kind: '' | TxKind;
  /**
   * Сумма операции «от» и «до» включительно, текстом без пробелов и с точкой ('1500', '12.5'); '' — граница не задана.
   * Сумма — та, что видна в строке, в валюте кошелька операции (у перевода — списание).
   */
  amountFrom: string;
  amountTo: string;
  source: SourceFilter;
  search: string;
}

/** Часть фильтров, которая живёт в шите «Фильтры» (период и поиск видны на самом экране). */
export type SheetFilters = Pick<ListFilters, 'walletId' | 'kind' | 'categoryId' | 'amountFrom' | 'amountTo' | 'source'>;

export const EMPTY_SHEET_FILTERS: SheetFilters = { walletId: '', kind: '', categoryId: '', amountFrom: '', amountTo: '', source: '' };

/** Включена ли сумма «от/до» (одним фильтром считаются обе границы). */
const hasAmount = (f: Pick<SheetFilters, 'amountFrom' | 'amountTo'>): boolean => f.amountFrom !== '' || f.amountTo !== '';

/** Сколько фильтров из шита включено (0–5): это число показывает кнопка «Фильтры». */
export function activeFilterCount(f: SheetFilters): number {
  return (
    (f.walletId !== '' ? 1 : 0) + (f.kind !== '' ? 1 : 0) + (f.categoryId !== '' ? 1 : 0) + (hasAmount(f) ? 1 : 0) + (f.source !== '' ? 1 : 0)
  );
}

const SOURCE_NAMES: Record<Exclude<SourceFilter, ''>, string> = { recurring: 'Регулярные платежи', debt: 'По долгам' };

/** «Сумма от 100», «до 500», «100–500» — коротко для строки включённых фильтров. */
function amountLabel(f: Pick<SheetFilters, 'amountFrom' | 'amountTo'>): string {
  const show = (t: string) => t.replace('.', ',');
  if (f.amountFrom !== '' && f.amountTo !== '') return `Сумма ${show(f.amountFrom)}–${show(f.amountTo)}`;
  return f.amountFrom !== '' ? `Сумма от ${show(f.amountFrom)}` : `Сумма до ${show(f.amountTo)}`;
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
  if (hasAmount(f)) out.push(amountLabel(f));
  if (f.source !== '') out.push(SOURCE_NAMES[f.source]);
  return out;
}

/**
 * Граница суммы из того, что набрал человек: «1 500», «12,5», «.5» → '1500', '12.5', '0.5'; null — это не сумма.
 * Пусто → ''. Не больше 12 цифр до запятой и 4 после: дальше сумма всё равно не поместится в целое.
 */
export function normalizeAmountText(input: string): string | null {
  const t = input.replace(/[\s\u00a0\u202f']/g, '').replace(',', '.');
  if (t === '') return '';
  const m = /^(\d{0,12})(?:\.(\d{0,4}))?$/.exec(t);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  const int = (m[1] ?? '') === '' ? '0' : (m[1] as string).replace(/^0+(?=\d)/, '');
  return m[2] ? `${int}.${m[2].replace(/0+$/, '')}`.replace(/\.$/, '') : int;
}

/**
 * Граница суммы в минорных единицах валюты. Нижняя («от») округляется вверх, верхняя («до») — вниз: «от 12,345» в TJS (два знака)
 * — это от 12,35, «до 12,345» — до 12,34; граница всегда «вместе» с теми суммами, что действительно можно встретить.
 * null — не число или не помещается в целое.
 */
export function boundMinor(text: string, currency: CurrencyCode, round: 'up' | 'down'): Minor | null {
  const norm = normalizeAmountText(text);
  if (norm === null || norm === '') return null;
  const [int = '0', frac = ''] = norm.split('.');
  const exp = exponentOf(currency);
  let n = Number(int + frac.slice(0, exp).padEnd(exp, '0'));
  if (round === 'up' && /[1-9]/.test(frac.slice(exp))) n += 1;
  return Number.isSafeInteger(n) ? n : null;
}

export const MIN_MONTH = '2000-01';
export const MAX_MONTH = '2100-12';
/** Границы «своих дат»: те же годы, что у месяцев. */
export const MIN_DATE = `${MIN_MONTH}-01`;
export const MAX_DATE = `${MAX_MONTH}-31`;

/** Годится ли дата для «своих дат»: настоящая и в пределах MIN_DATE…MAX_DATE (в поле даты браузер пропустит и год 0001). */
export const isRangeDate = (s: unknown): s is IsoDate => isValidIsoDate(s) && s >= MIN_DATE && s <= MAX_DATE;

/** «Свои даты» годятся целиком: обе настоящие и начало не позже конца. */
const isRange = (from: string, to: string): boolean => isRangeDate(from) && isRangeDate(to) && from <= to;

export const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_PARAM = /^[0-9A-Za-z_-]{1,64}$/;
/** Сумма в адресе: уже «чистая» (см. normalizeAmountText), без запятой и пробелов. */
const AMOUNT_PARAM = /^\d{1,12}(?:\.\d{1,4})?$/;

/** Фильтры «по умолчанию»: этот месяц, всё остальное выключено. */
export const defaultFilters = (today: IsoDate): ListFilters => ({
  period: 'this',
  month: monthKey(today),
  from: '',
  to: '',
  walletId: '',
  categoryId: '',
  kind: '',
  amountFrom: '',
  amountTo: '',
  source: '',
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
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (period === 'this' || period === 'prev' || period === '7d' || period === '30d' || period === 'all') out.period = period;
  else if (period === 'range' && isRange(from, to)) {
    out.period = 'range';
    out.from = from as IsoDate;
    out.to = to as IsoDate;
  } else if (validMonth) out.period = period === 'month' || month !== monthKey(today) ? 'month' : 'this';
  const wallet = params.get('wallet');
  if (wallet !== null && ID_PARAM.test(wallet)) out.walletId = wallet;
  const category = params.get('category');
  if (category === 'none') out.categoryId = NO_CATEGORY;
  else if (category !== null && ID_PARAM.test(category)) out.categoryId = category;
  const kind = params.get('kind');
  if (kind === 'expense' || kind === 'income' || kind === 'transfer') out.kind = kind;
  const min = params.get('min');
  if (min !== null && AMOUNT_PARAM.test(min)) out.amountFrom = min;
  const max = params.get('max');
  if (max !== null && AMOUNT_PARAM.test(max)) out.amountTo = max;
  const src = params.get('src');
  if (src === 'recurring' || src === 'debt') out.source = src;
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
  // «свои даты» без годных дат — это обычный «Этот месяц»: так их и пишем (как раз их и прочтёт filtersFromParams)
  const period = f.period === 'range' && !isRange(f.from, f.to) ? 'this' : f.period;
  if (period === 'range') {
    q.set('period', 'range');
    q.set('from', f.from);
    q.set('to', f.to);
  } else if (period !== 'this' || rememberMonth) {
    q.set('period', period);
  }
  if (rememberMonth) q.set('month', f.month);
  if (f.walletId !== '') q.set('wallet', f.walletId);
  if (f.categoryId === NO_CATEGORY) q.set('category', 'none');
  else if (f.categoryId !== '') q.set('category', f.categoryId);
  if (f.kind !== '') q.set('kind', f.kind);
  if (f.amountFrom !== '') q.set('min', f.amountFrom);
  if (f.amountTo !== '') q.set('max', f.amountTo);
  if (f.source !== '') q.set('src', f.source);
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

/**
 * Даты периода (включительно). Весь месяц: с 1-го по «31-е» — сравнение строк, лишние числа ни на что не влияют.
 * 7 и 30 дней считаются вместе с сегодняшним: «7 дней» — это сегодня и шесть предыдущих.
 * range — те свои даты, что заданы (не заданная граница не ограничивает).
 */
export function periodRange(
  period: PeriodKind,
  month: string,
  today: IsoDate,
  range: { from?: IsoDate | ''; to?: IsoDate | '' } = {},
): { from?: IsoDate; to?: IsoDate } {
  if (period === 'all') return {};
  if (period === '7d') return { from: addDays(today, -6), to: today };
  if (period === '30d') return { from: addDays(today, -29), to: today };
  if (period === 'range') {
    const out: { from?: IsoDate; to?: IsoDate } = {};
    if (range.from) out.from = range.from;
    if (range.to) out.to = range.to;
    return out;
  }
  const key = period === 'this' ? monthKey(today) : period === 'prev' ? shiftMonth(monthKey(today), -1) : month;
  return { from: `${key}-01`, to: `${key}-31` };
}

/**
 * Правка фильтров при выборе периода. «Свои даты» впервые открываются не пустыми: с начала этого месяца по сегодня
 * (раньше выбранные даты запоминаются). Остальные периоды ничего, кроме себя, не меняют.
 */
export function withPeriod(f: Pick<ListFilters, 'from' | 'to'>, period: PeriodKind, today: IsoDate): Partial<ListFilters> {
  if (period !== 'range') return { period };
  return isRange(f.from, f.to) ? { period } : { period, from: `${monthKey(today)}-01`, to: today };
}

/**
 * Правка «С»/«По» своих дат. Начало позже конца (и конец раньше начала) не оставляем: вторая граница подтягивается к новой,
 * иначе список молча опустел бы. Дата не из диапазона MIN_DATE…MAX_DATE (в поле даты можно набрать и год 0001) — без правки (null).
 */
export function withRangeDate(f: Pick<ListFilters, 'from' | 'to'>, edge: 'from' | 'to', value: string): Partial<ListFilters> | null {
  if (!isRangeDate(value)) return null;
  if (edge === 'from') return f.to !== '' && value > f.to ? { from: value, to: value } : { from: value };
  return f.from !== '' && value < f.from ? { from: value, to: value } : { to: value };
}

/** Фильтры экрана → фильтр запроса к базе. search приходит уже «успокоенным» (после паузы в наборе). */
export function toTxFilter(f: ListFilters, search: string, today: IsoDate, categories: readonly TreeNode[] = []): TxFilter {
  const out: TxFilter = { ...periodRange(f.period, f.month, today, f) };
  if (f.walletId !== '') out.walletId = f.walletId;
  if (f.categoryId === NO_CATEGORY) out.categoryId = null;
  else if (f.categoryId !== '') {
    // родитель показывает и операции своих подкатегорий; у категории без подкатегорий — только её собственные
    if (hasChildren(f.categoryId, categories)) out.categoryIds = [...withDescendants(f.categoryId, categories)];
    else out.categoryId = f.categoryId;
  }
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

/** Подходит ли операция под «Сумма от/до»: сравнение в валюте её кошелька, границы включительно. Без границ подходит всё. */
export function matchesAmountRange(
  tx: Pick<Transaction, 'walletId' | 'amountMinor'>,
  from: string,
  to: string,
  currencyOf: (walletId: string) => CurrencyCode | undefined,
): boolean {
  if (from === '' && to === '') return true;
  const currency = currencyOf(tx.walletId);
  if (!currency) return false;
  const lo = from === '' ? null : boundMinor(from, currency, 'up');
  const hi = to === '' ? null : boundMinor(to, currency, 'down');
  return (lo === null || tx.amountMinor >= lo) && (hi === null || tx.amountMinor <= hi);
}

/** Подходит ли операция под «Откуда»: регулярный платёж — рождена правилом, долг — движение денег по долгу. */
export function matchesSource(tx: { debtId?: Transaction['debtId'] | undefined; recurringRuleId?: Transaction['recurringRuleId'] | undefined }, source: SourceFilter): boolean {
  if (source === 'recurring') return (tx.recurringRuleId ?? null) !== null;
  if (source === 'debt') return (tx.debtId ?? null) !== null;
  return true;
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
