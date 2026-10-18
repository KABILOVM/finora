import { addDays } from '@/lib/dates';
import { addMinor, isMinor } from './money';
import { isScheduleDate, occurrencesBetween, SCHEDULE_MAX_DATE, type ScheduleRule } from './schedule';
import { totalInBase } from './totals';
import type { CurrencyCode, DebtDirection, IsoDate, IsoDateTime, Minor, TxKind, UUID, WalletKind } from './types';

/**
 * «Сколько можно тратить в день» — ЧИСТАЯ функция с явными входами (без базы, без часов, без часовых поясов).
 * Сегодняшнюю дату вызывающий передаёт сам (todayLocal()).
 *
 *  1. «Деньги на руках» = остатки кошельков cash / card / bank / other (БЕЗ накопления), в основной валюте.
 *     Всё остальное считается ТОЛЬКО по этим же деньгам: правило на кошельке-накоплении (доход туда, расход оттуда)
 *     на «деньги на руках» не влияет.
 *  2. Ожидаемые доходы — регулярные доходы на обычный неархивный кошелёк, ещё не проведённые и не пропущенные, строго после
 *     сегодня и не дальше FORECAST_LOOKAHEAD_DAYS дней. Возврат долга «мне должны» по расписанию — только ожидание, его не берём.
 *  3. Обязательное к дню t: расходные правила и регулярные переводы с обычного кошелька на накопления по расписанию с сегодня
 *     по t (проведённые и пропущенные даты не считаются), их просроченные даты (не раньше overdueFrom правила; ставятся на
 *     сегодня) и остаток по долгам «я должен» со сроком не позже t (просроченные — тоже: их уже пора отдать).
 *     Платёж по долгу, который уже учтён остатком долга, второй раз не вычитается.
 *  4. Контрольные дни t: «конец без дохода» — конец месяца, но не меньше MIN_HORIZON_DAYS дней, — и день перед каждым
 *     ожидаемым доходом до него; если первый доход позже, ещё и день перед ним (до зарплаты 5-го учтём аренду 1-го).
 *     Запас к дню t = деньги + доходы до t − обязательное до t.
 *     perDay = max(0, наименьшее floor(запас(t) / дней до t включительно)). Так копеечный доход не превращает
 *     «до конца месяца» в «до завтра», аренда сразу после него не забывается, а 31-го число не становится «тратьте всё».
 *     Через крупную зарплату дальше не смотрим: следующий месяц живёт на неё.
 *     Горизонт — контрольный день, на котором минимум достигнут (самый ранний из равных); не хватает денег — день самого
 *     глубокого минуса.
 *  5. Все деления целочисленные, округление вниз: никогда не обещаем больше, чем есть. Деньги, доходы, платежи и долги
 *     в валюте без курса в расчёт не входят — это возвращается в skipped.
 *  6. Общий лимит месяца считается отдельно (budget); effective — меньшая из двух цифр «в день» (по деньгам и по лимиту):
 *     её показывают крупно и на «Главной», и в «Бюджетах».
 */

/** Виды кошельков, чьи деньги можно тратить. Накопления — нет. */
export const SPENDABLE_KINDS: readonly WalletKind[] = ['cash', 'card', 'bank', 'other'];
const isSpendableKind = (kind: WalletKind | undefined): boolean => kind !== undefined && SPENDABLE_KINDS.includes(kind);

/** Деньги этого кошелька входят в «деньги на руках»: он не в архиве и не накопление. */
export function isSpendableWallet(w: Pick<ForecastWallet, 'kind' | 'archivedAt'>): boolean {
  return w.archivedAt === null && isSpendableKind(w.kind);
}
/** За сколько последних дней считается «обычно вы тратите в день». */
export const USUAL_WINDOW_DAYS = 30;
/** Насколько вперёд ищем ожидаемые доходы: ежемесячная зарплата в такое окно попадает всегда. */
export const FORECAST_LOOKAHEAD_DAYS = 45;
/** Без дохода считаем до конца месяца, но не меньше стольких дней (с сегодняшним). */
export const MIN_HORIZON_DAYS = 7;

/**
 * Самая дальняя дата, на которую смотрит прогноз (дата ожидаемого дохода). Проведённые и пропущенные даты правил загрузчик
 * собирает до неё — иначе заранее проведённая аренда вычлась бы второй раз.
 */
export function forecastLookaheadEnd(today: IsoDate): IsoDate {
  const end = addDays(today, FORECAST_LOOKAHEAD_DAYS);
  return end > SCHEDULE_MAX_DATE ? SCHEDULE_MAX_DATE : end;
}

export interface ForecastWallet {
  id: UUID;
  currency: CurrencyCode;
  kind: WalletKind;
  archivedAt: IsoDateTime | null;
}

export interface ForecastRule extends ScheduleRule {
  id: UUID;
  kind: TxKind;
  walletId: UUID;
  /** Только у переводов: кошелёк-получатель. */
  toWalletId?: UUID | null;
  /** В валюте кошелька правила (у перевода — списывается с walletId). */
  amountMinor: Minor;
  debtId: UUID | null;
  archivedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
  /**
   * С какой даты не проведённые и не пропущенные прошлые даты считаются просроченными (местная дата: recurring/plan.ts
   * historyFrom). Нет или null — прошлые даты не считаются.
   */
  overdueFrom?: IsoDate | null;
}

export interface ForecastDebt {
  id: UUID;
  direction: DebtDirection;
  currency: CurrencyCode;
  dueOn: IsoDate | null;
  /** Остаток долга (domain/debts.ts computeDebtState), в валюте долга. */
  remainingMinor: Minor;
  closedAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
}

/** Общий лимит месяца и сколько в этом месяце уже потрачено (в основной валюте). */
export interface ForecastTotalBudget {
  limitMinor: Minor;
  currency: CurrencyCode;
  spentMonthMinor: Minor;
  /** Сколько потрачено сегодня — по тем же правилам, что и spentMonthMinor (все кошельки, регулярные платежи тоже). */
  spentTodayMinor: Minor;
  /** Сколько операций месяца не попало в «потрачено» (другая прежняя основная валюта): цифра может быть заниженной. */
  excludedCount: number;
}

export interface ForecastInput {
  /** Сегодня, 'ГГГГ-ММ-ДД' (дата устройства). */
  today: IsoDate;
  base: CurrencyCode;
  /** Все живые кошельки, в том числе архивные (по ним определяется валюта правил); деньги считаются только по неархивным. */
  wallets: readonly ForecastWallet[];
  balances: ReadonlyMap<UUID, Minor>;
  /** Живые правила. Архивные функция отбрасывает сама. */
  rules: readonly ForecastRule[];
  /** Какие даты правил уже проведены или пропущены: ключи occurrenceKey(ruleId, date). */
  doneOccurrences: ReadonlySet<string>;
  debts: readonly ForecastDebt[];
  /** Единиц `to` за 1 единицу `from`; null — курса нет. */
  getRate: (from: CurrencyCode, to: CurrencyCode) => number | null;
  /**
   * Расходы сегодня (без долгов, с комиссиями), в основной валюте, ТОЛЬКО из кошельков, чьи деньги входят в «деньги на руках»,
   * и без операций по регулярным платежам — те до проведения уже вычитались как обязательные.
   */
  spentTodayMinor: Minor;
  /** Средний расход в день на повседневные траты (без регулярных платежей и трат с накоплений); null — истории ещё нет. */
  usualPerDayMinor: Minor | null;
  totalBudget: ForecastTotalBudget | null;
}

export interface ForecastSkipped {
  source: 'money' | 'income' | 'payment' | 'debt';
  currency: CurrencyCode;
  /** В валюте `currency`. */
  amountMinor: Minor;
}

export interface ForecastBudgetPart {
  limitMinor: Minor;
  spentMinor: Minor;
  /** Осталось в лимите (0, если исчерпан). */
  leftMinor: Minor;
  /** Превышение лимита (0, если не превышен). */
  overMinor: Minor;
  /** Дней до конца МЕСЯЦА, включая сегодня (≥ 1). */
  daysLeft: number;
  /** floor(осталось в лимите / дней до конца месяца). */
  perDayMinor: Minor;
  /** Часть операций месяца не учтена: цифра может быть выше настоящей. */
  partial: boolean;
}

/** Цифра, которую показывают крупно: меньшая из «по деньгам на руках» и «по общему лимиту месяца». */
export interface ForecastEffective {
  /** Что её ограничивает. При равенстве — деньги. */
  by: 'money' | 'budget';
  perDayMinor: Minor;
  /** Сколько можно было потратить за сегодня с утра (по тому же ограничению). */
  todayLimitMinor: Minor;
  /** Сколько сегодня потрачено (по тем же правилам, что и ограничение). */
  spentTodayMinor: Minor;
  daysLeft: number;
  horizonEnd: IsoDate;
  /** Общий лимит месяца: 'ok' — есть остаток, 'exhausted' — потрачен ровно, 'over' — превышен; null — лимита нет или он в другой валюте. */
  budgetState: 'ok' | 'exhausted' | 'over' | null;
}

export interface DailyForecastOk {
  status: 'ok';
  base: CurrencyCode;
  today: IsoDate;
  monthEnd: IsoDate;
  /** Последний день, на который делим деньги. */
  horizonEnd: IsoDate;
  /** Ожидаемый доход, перед которым кончается горизонт (горизонт — день перед ним); null — горизонт кончился не из-за дохода. */
  incomeDate: IsoDate | null;
  /** Дней от сегодня до конца горизонта включительно (≥ 1). */
  daysLeft: number;
  moneyMinor: Minor;
  /** Ожидаемые доходы с завтра до конца горизонта. */
  incomeMinor: Minor;
  paymentsMinor: Minor;
  paymentsCount: number;
  /** Сколько из платежей — просроченные (не проведённые и не пропущенные прошлые даты). */
  overduePaymentsMinor: Minor;
  overdueCount: number;
  debtsMinor: Minor;
  debtsCount: number;
  obligationsMinor: Minor;
  /** Деньги + доходы − обязательное до конца горизонта (может быть отрицательным). */
  availableMinor: Minor;
  /** max(0, наименьшее по контрольным дням floor(запас / дней)) — по деньгам на руках. */
  perDayMinor: Minor;
  /** Денег не хватит к какому-то из контрольных дней. */
  notEnough: boolean;
  /** Сколько не хватает в худший день (0, если хватает). */
  shortfallMinor: Minor;
  /** Сколько можно было потратить за сегодня с утра: то же, что perDay, но вместе с потраченным сегодня. */
  todayLimitMinor: Minor;
  spentTodayMinor: Minor;
  usualPerDayMinor: Minor | null;
  budget: ForecastBudgetPart | null;
  effective: ForecastEffective;
  /** Что не вошло в расчёт из-за отсутствия курса. */
  skipped: ForecastSkipped[];
  /** Платежи, у которых кошелёк не найден (в расчёт не вошли). */
  unknownWalletPayments: number;
  /** Число приблизительное: часть пересчитана по курсу или что-то не вошло в расчёт. */
  approximate: boolean;
}

export type DailyForecast =
  | DailyForecastOk
  | { status: 'no-wallets' }
  /** Кошельки есть, но все — накопления: тратить нечего. */
  | { status: 'only-savings' }
  | { status: 'overflow' }
  | { status: 'bad-date' };

// ───────────────────────── даты и целочисленные помощники ─────────────────────────

const DAY_MS = 86_400_000;

function dayNum(date: IsoDate): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Сколько дней от `from` до `to` (to − from; отрицательное, если to раньше). Даты 'ГГГГ-ММ-ДД'. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNum(to) - dayNum(from);
}

/** Последний день месяца той же даты: '2028-02-10' → '2028-02-29' (високосный год учтён). */
export function endOfMonth(date: IsoDate): IsoDate {
  const [y = 0, m = 1] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** Целое деление с округлением ВНИЗ без потери точности (BigInt): a — любое безопасное целое, b — целое > 0. */
export function floorDiv(a: Minor, b: number): Minor {
  if (!isMinor(a) || !Number.isSafeInteger(b) || b <= 0) throw new RangeError(`Деление ${String(a)} на ${String(b)} невозможно`);
  const q = BigInt(a) / BigInt(b); // к нулю
  return Number(a < 0 && BigInt(a) % BigInt(b) !== 0n ? q - 1n : q);
}

/** Ключ «правило + дата» для множества уже проведённых или пропущенных платежей. */
export const occurrenceKey = (ruleId: UUID, date: IsoDate): string => `${ruleId}|${date}`;

/**
 * Окно «обычных трат»: последние `windowDays` дней до сегодня, но не раньше первой операции (иначе у нового пользователя
 * среднее занизилось бы в разы). null — до сегодняшнего дня операций ещё не было. days ≥ 1.
 */
export function usualSpendWindow(
  firstOpDate: IsoDate | null,
  today: IsoDate,
  windowDays: number = USUAL_WINDOW_DAYS,
): { from: IsoDate; to: IsoDate; days: number } | null {
  if (firstOpDate === null || !isScheduleDate(firstOpDate) || !isScheduleDate(today) || firstOpDate >= today) return null;
  const lowest = addDays(today, -windowDays);
  const from = firstOpDate > lowest ? firstOpDate : lowest;
  return { from, to: addDays(today, -1), days: daysBetween(from, today) };
}

// ───────────────────────── расчёт ─────────────────────────

interface Sums {
  totalMinor: Minor;
  missing: CurrencyCode[];
  converted: boolean;
}

/** Суммы по валютам → одна сумма в основной (каждая валюта пересчитывается один раз). Нулевые суммы ничего не добавляют. */
function toBase(
  perCurrency: ReadonlyMap<CurrencyCode, Minor>,
  base: CurrencyCode,
  getRate: ForecastInput['getRate'],
): Sums {
  const items = [...perCurrency]
    .filter(([currency, sum]) => currency === base || sum !== 0)
    .map(([currency, balanceMinor]) => ({ currency, balanceMinor }));
  const { totalMinor, missing } = totalInBase(items, base, getRate);
  const converted = items.some((i) => i.currency !== base && !missing.includes(i.currency));
  return { totalMinor, missing, converted };
}

function addTo(map: Map<CurrencyCode, Minor>, currency: CurrencyCode, amount: Minor): void {
  map.set(currency, addMinor(map.get(currency) ?? 0, amount));
}

function countTo(map: Map<CurrencyCode, number>, currency: CurrencyCode): void {
  map.set(currency, (map.get(currency) ?? 0) + 1);
}

const laterOf = (a: IsoDate, b: IsoDate): IsoDate => (a >= b ? a : b);

/** Лимит месяца → «в день»: часть прогноза «по бюджету». null — общего лимита нет или он в другой валюте. */
function budgetPart(b: ForecastTotalBudget | null, base: CurrencyCode, today: IsoDate, monthEnd: IsoDate): ForecastBudgetPart | null {
  if (b === null || b.currency !== base || !isMinor(b.limitMinor) || b.limitMinor <= 0) return null;
  const left = addMinor(b.limitMinor, -b.spentMonthMinor);
  const daysLeft = daysBetween(today, monthEnd) + 1;
  return {
    limitMinor: b.limitMinor,
    spentMinor: b.spentMonthMinor,
    leftMinor: left > 0 ? left : 0,
    overMinor: left < 0 ? -left : 0,
    daysLeft,
    perDayMinor: left > 0 ? floorDiv(left, daysLeft) : 0,
    partial: b.excludedCount > 0,
  };
}

/** Меньшая из цифр «по деньгам» и «по лимиту» — вместе с днями, горизонтом и «потрачено сегодня» именно этой цифры. */
function effectiveOf(
  money: Omit<ForecastEffective, 'by' | 'budgetState'>,
  budget: ForecastBudgetPart | null,
  total: ForecastTotalBudget | null,
  monthEnd: IsoDate,
): ForecastEffective {
  if (budget === null || total === null) return { by: 'money', ...money, budgetState: null };
  const budgetState = budget.overMinor > 0 ? 'over' : budget.leftMinor === 0 ? 'exhausted' : 'ok';
  if (budget.perDayMinor >= money.perDayMinor) return { by: 'money', ...money, budgetState };
  // с утра в лимите было: осталось сейчас + потрачено сегодня
  const morning = addMinor(addMinor(budget.limitMinor, -budget.spentMinor), total.spentTodayMinor);
  return {
    by: 'budget',
    perDayMinor: budget.perDayMinor,
    todayLimitMinor: morning > 0 ? floorDiv(morning, budget.daysLeft) : 0,
    spentTodayMinor: total.spentTodayMinor,
    daysLeft: budget.daysLeft,
    horizonEnd: monthEnd,
    budgetState,
  };
}

/**
 * Уходят ли деньги правила из «денег на руках»: 'pays' — да (расход с обычного кошелька или перевод с него на накопления),
 * 'none' — нет (расход с накопления, перевод между обычными кошельками, доход), 'unknown' — кошелёк не найден, понять нельзя.
 */
function leavesSpendable(r: ForecastRule, kindOfWallet: ReadonlyMap<UUID, WalletKind>): 'pays' | 'none' | 'unknown' {
  const from = kindOfWallet.get(r.walletId);
  if (r.kind === 'expense') return from === undefined ? 'unknown' : isSpendableKind(from) ? 'pays' : 'none';
  if (r.kind === 'transfer') {
    if (!r.toWalletId) return 'none'; // перевод без получателя: вычитать нечего
    const to = kindOfWallet.get(r.toWalletId);
    if (from === undefined || to === undefined) return 'unknown';
    return isSpendableKind(from) && !isSpendableKind(to) ? 'pays' : 'none';
  }
  return 'none';
}

/** Ожидаемый приход денег на руки. */
interface IncomeFlow {
  date: IsoDate;
  currency: CurrencyCode;
  amountMinor: Minor;
}

/** Обязательный платёж; у просроченного date — сегодня. currency === null — кошелёк не найден, в сумму не входит. */
interface PaymentFlow {
  date: IsoDate;
  currency: CurrencyCode | null;
  amountMinor: Minor;
  debtId: UUID | null;
  overdue: boolean;
}

/**
 * Ожидаемые доходы с завтра по `until`: на обычный неархивный кошелёк (на накопления, в архив или неизвестно куда — деньги на
 * руках не пополнят), не проведённые и не пропущенные. Возврат долга «мне должны» по расписанию — только ожидание: не берём.
 */
function pendingIncomes(input: ForecastInput, until: IsoDate): IncomeFlow[] {
  const { today, rules, doneOccurrences } = input;
  const walletById = new Map(input.wallets.map((w) => [w.id, w] as const));
  const debtDirection = new Map(input.debts.map((d) => [d.id, d.direction] as const));
  const out: IncomeFlow[] = [];
  for (const r of rules) {
    if (r.kind !== 'income' || r.deletedAt !== null || r.archivedAt !== null) continue;
    const w = walletById.get(r.walletId);
    if (!w || !isSpendableWallet(w)) continue;
    if (r.debtId !== null && debtDirection.get(r.debtId) !== 'borrowed') continue;
    for (const date of occurrencesBetween(r, addDays(today, 1), until)) {
      if (!doneOccurrences.has(occurrenceKey(r.id, date))) out.push({ date, currency: w.currency, amountMinor: r.amountMinor });
    }
  }
  return out;
}

/** Обязательные платежи с сегодня по `until` и просроченные (на сегодня). */
function pendingPayments(input: ForecastInput, until: IsoDate): PaymentFlow[] {
  const { today, doneOccurrences } = input;
  const kindOfWallet = new Map(input.wallets.map((w) => [w.id, w.kind] as const));
  const currencyOfWallet = new Map(input.wallets.map((w) => [w.id, w.currency] as const));
  const yesterday = addDays(today, -1);
  const out: PaymentFlow[] = [];
  for (const r of input.rules) {
    if (r.deletedAt !== null || r.archivedAt !== null) continue;
    const leaves = leavesSpendable(r, kindOfWallet);
    if (leaves === 'none') continue;
    const currency = leaves === 'unknown' ? null : (currencyOfWallet.get(r.walletId) ?? null);
    const flow = (date: IsoDate, overdue: boolean): PaymentFlow => ({ date, currency, amountMinor: r.amountMinor, debtId: r.debtId, overdue });
    for (const date of occurrencesBetween(r, today, until)) {
      if (!doneOccurrences.has(occurrenceKey(r.id, date))) out.push(flow(date, false));
    }
    const from = r.overdueFrom;
    if (from === undefined || from === null || !isScheduleDate(from) || from > yesterday) continue;
    for (const date of occurrencesBetween(r, from, yesterday)) {
      if (!doneOccurrences.has(occurrenceKey(r.id, date))) out.push(flow(today, true));
    }
  }
  return out;
}

/** Запас денег к контрольному дню и из чего он сложился. */
interface Checkpoint {
  date: IsoDate;
  days: number;
  /** Деньги + доходы − обязательное к этому дню. */
  capMinor: Minor;
  income: Sums;
  payments: Sums;
  overdue: Sums;
  debts: Sums;
  paymentsCount: number;
  overdueCount: number;
  debtsCount: number;
  unknownWalletPayments: number;
  incomeByCurrency: ReadonlyMap<CurrencyCode, Minor>;
  paymentByCurrency: ReadonlyMap<CurrencyCode, Minor>;
  debtByCurrency: ReadonlyMap<CurrencyCode, Minor>;
}

/**
 * Прогноз «сколько можно тратить в день». Не бросает: переполнение сумм возвращается признаком status: 'overflow'.
 * Вызывающий отвечает за то, чтобы входы были согласованы: остатки — из computeBalances, остаток долга — из computeDebtState,
 * проведённые даты правил — от их overdueFrom до forecastLookaheadEnd(today).
 */
export function computeDailyForecast(input: ForecastInput): DailyForecast {
  const { today, base, getRate } = input;
  if (!isScheduleDate(today)) return { status: 'bad-date' };
  const wallets = input.wallets.filter((w) => w.archivedAt === null);
  if (wallets.length === 0) return { status: 'no-wallets' };
  const spendable = wallets.filter((w) => SPENDABLE_KINDS.includes(w.kind));
  if (spendable.length === 0) return { status: 'only-savings' };

  try {
    // 1. деньги на руках
    const moneyByCurrency = new Map<CurrencyCode, Minor>();
    for (const w of spendable) addTo(moneyByCurrency, w.currency, input.balances.get(w.id) ?? 0);
    const money = toBase(moneyByCurrency, base, getRate);

    // 2. ожидаемые доходы и контрольные дни
    const monthEnd = endOfMonth(today);
    const incomes = pendingIncomes(input, forecastLookaheadEnd(today));
    const incomeDates = new Set(incomes.map((i) => i.date));
    const noIncomeEnd = laterOf(monthEnd, addDays(today, MIN_HORIZON_DAYS - 1));
    const firstIncome = [...incomeDates].sort()[0];
    const lastDate = firstIncome === undefined ? noIncomeEnd : laterOf(noIncomeEnd, addDays(firstIncome, -1));
    const dates = [...new Set([noIncomeEnd, lastDate, ...[...incomeDates].map((d) => addDays(d, -1)).filter((d) => d <= lastDate)])].sort();

    // 3. обязательное: платежи по расписанию (с просроченными) и долги «я должен» со сроком
    const payments = pendingPayments(input, lastDate > SCHEDULE_MAX_DATE ? SCHEDULE_MAX_DATE : lastDate);
    const debtsOpen = input.debts.filter(
      (d) =>
        d.direction === 'borrowed' &&
        d.closedAt === null &&
        d.archivedAt === null &&
        d.dueOn !== null &&
        isMinor(d.remainingMinor) &&
        d.remainingMinor > 0,
    );

    const checkpoint = (date: IsoDate): Checkpoint => {
      const incomeByCurrency = new Map<CurrencyCode, Minor>();
      for (const i of incomes) if (i.date <= date) addTo(incomeByCurrency, i.currency, i.amountMinor);

      // долг со сроком к этому дню учитывается остатком — его платежи по расписанию второй раз не берём
      const debtsDue = debtsOpen.filter((d) => d.dueOn !== null && d.dueOn <= date);
      const debtIdsDue = new Set(debtsDue.map((d) => d.id));
      const debtByCurrency = new Map<CurrencyCode, Minor>();
      for (const d of debtsDue) addTo(debtByCurrency, d.currency, d.remainingMinor);

      const paymentByCurrency = new Map<CurrencyCode, Minor>();
      const paymentCount = new Map<CurrencyCode, number>();
      const overdueByCurrency = new Map<CurrencyCode, Minor>();
      const overdueCount = new Map<CurrencyCode, number>();
      let unknownWalletPayments = 0;
      for (const p of payments) {
        if (p.date > date || (p.debtId !== null && debtIdsDue.has(p.debtId))) continue;
        if (p.currency === null) {
          unknownWalletPayments++;
          continue;
        }
        addTo(paymentByCurrency, p.currency, p.amountMinor);
        countTo(paymentCount, p.currency);
        if (p.overdue) {
          addTo(overdueByCurrency, p.currency, p.amountMinor);
          countTo(overdueCount, p.currency);
        }
      }

      const income = toBase(incomeByCurrency, base, getRate);
      const paid = toBase(paymentByCurrency, base, getRate);
      const debts = toBase(debtByCurrency, base, getRate);
      const counted = (counts: ReadonlyMap<CurrencyCode, number>): number => {
        let n = 0;
        for (const [currency, k] of counts) if (!paid.missing.includes(currency)) n += k;
        return n;
      };
      return {
        date,
        days: daysBetween(today, date) + 1,
        capMinor: addMinor(addMinor(money.totalMinor, income.totalMinor), -addMinor(paid.totalMinor, debts.totalMinor)),
        income,
        payments: paid,
        overdue: toBase(overdueByCurrency, base, getRate),
        debts,
        paymentsCount: counted(paymentCount),
        overdueCount: counted(overdueCount),
        debtsCount: debtsDue.filter((d) => !debts.missing.includes(d.currency)).length,
        unknownWalletPayments,
        incomeByCurrency,
        paymentByCurrency,
        debtByCurrency,
      };
    };

    // 4. самый тесный контрольный день (из равных — самый ранний) и самый глубокий минус
    const points = dates.map(checkpoint);
    let tightest = points[0] as Checkpoint;
    let deepest = tightest;
    let perDay = floorDiv(tightest.capMinor, tightest.days);
    let todayLimit = floorDiv(addMinor(tightest.capMinor, input.spentTodayMinor), tightest.days);
    for (const p of points) {
      const v = floorDiv(p.capMinor, p.days);
      if (v < perDay) {
        perDay = v;
        tightest = p;
      }
      if (p.capMinor < deepest.capMinor) deepest = p;
      const withToday = floorDiv(addMinor(p.capMinor, input.spentTodayMinor), p.days);
      if (withToday < todayLimit) todayLimit = withToday;
    }
    const notEnough = deepest.capMinor < 0;
    const c = notEnough ? deepest : tightest;
    const nextDay = addDays(c.date, 1);

    const skipped: ForecastSkipped[] = [];
    const skip = (source: ForecastSkipped['source'], missing: readonly CurrencyCode[], sums: ReadonlyMap<CurrencyCode, Minor>) => {
      for (const currency of missing) skipped.push({ source, currency, amountMinor: sums.get(currency) ?? 0 });
    };
    skip('money', money.missing, moneyByCurrency);
    skip('income', c.income.missing, c.incomeByCurrency);
    skip('payment', c.payments.missing, c.paymentByCurrency);
    skip('debt', c.debts.missing, c.debtByCurrency);

    const perDayMinor = perDay > 0 ? perDay : 0;
    const todayLimitMinor = todayLimit > 0 ? todayLimit : 0;
    const budget = budgetPart(input.totalBudget, base, today, monthEnd);
    const effective = effectiveOf(
      { perDayMinor, todayLimitMinor, spentTodayMinor: input.spentTodayMinor, daysLeft: c.days, horizonEnd: c.date },
      budget,
      input.totalBudget,
      monthEnd,
    );
    return {
      status: 'ok',
      base,
      today,
      monthEnd,
      horizonEnd: c.date,
      incomeDate: incomeDates.has(nextDay) ? nextDay : null,
      daysLeft: c.days,
      moneyMinor: money.totalMinor,
      incomeMinor: c.income.totalMinor,
      paymentsMinor: c.payments.totalMinor,
      paymentsCount: c.paymentsCount,
      overduePaymentsMinor: c.overdue.totalMinor,
      overdueCount: c.overdueCount,
      debtsMinor: c.debts.totalMinor,
      debtsCount: c.debtsCount,
      obligationsMinor: addMinor(c.payments.totalMinor, c.debts.totalMinor),
      availableMinor: c.capMinor,
      perDayMinor,
      notEnough,
      shortfallMinor: notEnough ? -c.capMinor : 0,
      todayLimitMinor,
      spentTodayMinor: input.spentTodayMinor,
      usualPerDayMinor: input.usualPerDayMinor,
      budget,
      effective,
      skipped,
      unknownWalletPayments: c.unknownWalletPayments,
      approximate:
        skipped.length > 0 ||
        c.unknownWalletPayments > 0 ||
        money.converted ||
        c.income.converted ||
        c.payments.converted ||
        c.debts.converted ||
        (effective.by === 'budget' && budget !== null && budget.partial),
    };
  } catch (e) {
    if (e instanceof RangeError) return { status: 'overflow' };
    throw e;
  }
}
