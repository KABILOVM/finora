import { addDays } from '@/lib/dates';
import { addMinor, convertMinor, isMinor } from './money';
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
 *  2. Ожидаемые доходы — регулярные доходы на обычный неархивный кошелёк, ещё не проведённые и не пропущенные, с сегодня
 *     и не дальше FORECAST_LOOKAHEAD_DAYS дней. Возврат долга «мне должны» по расписанию — только ожидание, его не берём.
 *     Сегодняшний доход горизонт не обрывает, а пока он не проведён, на сегодня можно не больше того, что на руках.
 *  3. Обязательное к дню t: расходные правила и регулярные переводы с обычного кошелька на накопления (или комиссия перевода
 *     между обычными кошельками) по расписанию с сегодня по t (проведённые и пропущенные даты не считаются), их просроченные даты (не раньше overdueFrom правила; ставятся на
 *     сегодня) и остаток по долгам «я должен» со сроком не позже t (просроченные — тоже: их уже пора отдать).
 *     Платёж по долгу, который уже учтён остатком долга, второй раз не вычитается.
 *  4. Контрольные дни t: «конец без дохода» — конец месяца, но не меньше MIN_HORIZON_DAYS дней, — и день перед каждым
 *     ожидаемым доходом до последнего дня, на который смотрим (horizonLimit: день перед ближайшей датой «зарплаты» — самого
 *     крупного регулярного дохода, — но не раньше «конца без дохода»; до зарплаты 5-го учтём аренду 1-го).
 *     Запас к дню t = деньги + доходы до t − обязательное до t.
 *     perDay = max(0, наименьшее floor(запас(t) / дней до t включительно)). Так копеечный доход не превращает
 *     «до конца месяца» в «до завтра», аренда сразу после него не забывается, а 31-го число не становится «тратьте всё».
 *     Через крупную зарплату дальше не смотрим: следующий месяц живёт на неё.
 *     Горизонт — контрольный день, на котором минимум достигнут (самый ранний из равных); не хватает денег — день самого
 *     глубокого минуса.
 *  5. Все деления целочисленные, округление вниз: никогда не обещаем больше, чем есть. Деньги, доходы, платежи и долги
 *     в валюте без курса в расчёт не входят — это возвращается в skipped.
 *  6. Общий лимит месяца считается отдельно (budget): (лимит − потрачено − ещё не проведённые регулярные расходы месяца) / дней
 *     до конца месяца. effective — меньшая из двух цифр «в день» (по деньгам и по лимиту): её показывают крупно и на «Главной»,
 *     и в «Бюджетах».
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
  /** Только у переводов: сколько придёт на toWalletId (в его валюте); меньше списанного в той же валюте — разница это комиссия. */
  toAmountMinor?: Minor | null;
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
  /**
   * Сколько потрачено сегодня, как в spentMonthMinor (все кошельки), но без проведённых регулярных расходов: до проведения они
   * уже были отложены из лимита (ForecastBudgetPart.scheduledMinor).
   */
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
  /** Регулярные расходы этого месяца, ещё не проведённые: из остатка они отложены. */
  scheduledMinor: Minor;
  /** Дней до конца МЕСЯЦА, включая сегодня (≥ 1). */
  daysLeft: number;
  /** floor((осталось в лимите − регулярные расходы этого месяца) / дней до конца месяца). */
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
  /**
   * Общий лимит месяца: 'ok' — есть свободный остаток, 'scheduled' — остаток уйдёт на регулярные платежи, 'exhausted' — потрачен
   * ровно, 'over' — превышен; null — лимита нет или он в другой валюте.
   */
  budgetState: 'ok' | 'scheduled' | 'exhausted' | 'over' | null;
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
  /**
   * Цифру ограничивают деньги на руках до сегодняшнего дохода (он ещё не проведён): горизонт — сегодня, а «платежи и долги» —
   * только просроченные (сегодняшние отдадут из дохода).
   */
  untilTodayIncome: boolean;
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

/**
 * Лимит месяца → «в день»: часть прогноза «по бюджету». null — общего лимита нет или он в другой валюте.
 * Из остатка лимита сначала откладываются регулярные расходы этого месяца, ещё не проведённые (`scheduled`): они тоже лягут в лимит.
 */
function budgetPart(
  b: ForecastTotalBudget | null,
  base: CurrencyCode,
  today: IsoDate,
  monthEnd: IsoDate,
  scheduled: { totalMinor: Minor; uncertain: boolean; converted: boolean },
): ForecastBudgetPart | null {
  if (b === null || b.currency !== base || !isMinor(b.limitMinor) || b.limitMinor <= 0) return null;
  const left = addMinor(b.limitMinor, -b.spentMonthMinor);
  const free = addMinor(left, -scheduled.totalMinor);
  const daysLeft = daysBetween(today, monthEnd) + 1;
  return {
    limitMinor: b.limitMinor,
    spentMinor: b.spentMonthMinor,
    leftMinor: left > 0 ? left : 0,
    overMinor: left < 0 ? -left : 0,
    scheduledMinor: scheduled.totalMinor,
    daysLeft,
    perDayMinor: free > 0 ? floorDiv(free, daysLeft) : 0,
    partial: b.excludedCount > 0 || scheduled.uncertain,
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
  const free = addMinor(addMinor(budget.limitMinor, -budget.spentMinor), -budget.scheduledMinor);
  const budgetState = budget.overMinor > 0 ? 'over' : budget.leftMinor === 0 ? 'exhausted' : free <= 0 ? 'scheduled' : 'ok';
  if (budget.perDayMinor >= money.perDayMinor) return { by: 'money', ...money, budgetState };
  // с утра в лимите было: свободный остаток сейчас + потрачено сегодня (без проведённых регулярных: они и утром были отложены)
  const morning = addMinor(free, total.spentTodayMinor);
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

/** Комиссия перевода по правилу: списано − зачислено, если обе стороны в одной валюте и зачислено меньше; иначе 0. */
export function transferFeeMinor(r: Pick<ForecastRule, 'kind' | 'amountMinor' | 'toAmountMinor'>, from: ForecastWallet | undefined, to: ForecastWallet | undefined): Minor {
  if (r.kind !== 'transfer' || from === undefined || to === undefined || from.currency !== to.currency) return 0;
  const received = r.toAmountMinor;
  return received !== null && received !== undefined && isMinor(received) && received >= 0 && received < r.amountMinor ? r.amountMinor - received : 0;
}

/**
 * Сколько денег правила уходит из «денег на руках» за одну дату (в валюте кошелька правила): расход с обычного кошелька —
 * вся сумма; перевод с обычного на накопления — вся сумма; между обычными кошельками — только комиссия.
 * 0 — не уходит (расход с накопления, доход, перевод без комиссии) или не случится: с архивным кошельком операцию не провести.
 * 'unknown' — кошелёк не найден, понять нельзя.
 */
function outflowOf(r: ForecastRule, walletOf: ReadonlyMap<UUID, ForecastWallet>): Minor | 'unknown' {
  const from = walletOf.get(r.walletId);
  if (r.kind === 'expense') return from === undefined ? 'unknown' : isSpendableWallet(from) ? r.amountMinor : 0;
  if (r.kind === 'transfer') {
    if (!r.toWalletId) return 0; // перевод без получателя: вычитать нечего
    const to = walletOf.get(r.toWalletId);
    if (from === undefined || to === undefined) return 'unknown';
    if (from.archivedAt !== null || to.archivedAt !== null || !isSpendableKind(from.kind)) return 0;
    return isSpendableKind(to.kind) ? transferFeeMinor(r, from, to) : r.amountMinor;
  }
  return 0;
}

/** Регулярный перевод с накоплений (неархивных) на обычный неархивный кошелёк: деньги придут на руки. */
export function isSavingsInflowRule(r: ForecastRule, walletOf: ReadonlyMap<UUID, ForecastWallet>): boolean {
  if (r.kind !== 'transfer' || !r.toWalletId) return false;
  const from = walletOf.get(r.walletId);
  const to = walletOf.get(r.toWalletId);
  return from !== undefined && to !== undefined && from.archivedAt === null && !isSpendableKind(from.kind) && isSpendableWallet(to);
}

/** Плановый приход на руки с накоплений: по какому правилу, когда, сколько (в валюте получателя). */
export interface SavingsInflow {
  ruleId: UUID;
  date: IsoDate;
  amountMinor: Minor;
  currency: CurrencyCode;
}

/**
 * Регулярные переводы с накоплений на руки с `from` по `until`, ещё не проведённые и не пропущенные, — по датам и не больше,
 * чем лежит на кошельке-накоплении (с пустой копилки переводить нечего). Если списывается меньше плана, зачисленное уменьшается
 * в той же доле. Общая для прогноза «в день» и денежного календаря.
 */
export function savingsInflows(
  input: Pick<ForecastInput, 'rules' | 'wallets' | 'balances' | 'doneOccurrences'>,
  from: IsoDate,
  until: IsoDate,
): SavingsInflow[] {
  const walletOf = new Map(input.wallets.map((w) => [w.id, w] as const));
  const planned: { r: ForecastRule; date: IsoDate }[] = [];
  for (const r of input.rules) {
    if (r.deletedAt !== null || r.archivedAt !== null || !isSavingsInflowRule(r, walletOf)) continue;
    for (const date of occurrencesBetween(r, from, until)) if (!input.doneOccurrences.has(occurrenceKey(r.id, date))) planned.push({ r, date });
  }
  planned.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.r.id < b.r.id ? -1 : 1));
  const left = new Map<UUID, Minor>();
  const out: SavingsInflow[] = [];
  for (const { r, date } of planned) {
    const src = walletOf.get(r.walletId) as ForecastWallet;
    const to = walletOf.get(r.toWalletId as UUID) as ForecastWallet;
    const have = left.get(src.id) ?? Math.max(0, input.balances.get(src.id) ?? 0);
    const debit = r.amountMinor <= have ? r.amountMinor : have;
    left.set(src.id, have - debit);
    if (debit <= 0) continue;
    const planIn = r.toAmountMinor !== null && r.toAmountMinor !== undefined && isMinor(r.toAmountMinor) ? r.toAmountMinor : src.currency === to.currency ? r.amountMinor : null;
    if (planIn === null) continue;
    const received = debit === r.amountMinor ? planIn : Number((BigInt(planIn) * BigInt(debit)) / BigInt(r.amountMinor));
    if (received > 0) out.push({ ruleId: r.id, date, amountMinor: received, currency: to.currency });
  }
  return out;
}

/** Ожидаемый приход денег на руки. */
interface IncomeFlow {
  ruleId: UUID;
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
 * Ожидаемые доходы с сегодня по `until`: на обычный неархивный кошелёк (на накопления, в архив или неизвестно куда — деньги на
 * руках не пополнят), не проведённые и не пропущенные, и регулярные переводы с накоплений на руки (зачисленная сумма).
 * Возврат долга «мне должны» по расписанию — только ожидание: не берём.
 * Сегодняшний ещё не проведённый доход тоже ожидается (зарплату обычно проводят днём), но горизонт он не обрывает.
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
    for (const date of occurrencesBetween(r, today, until)) {
      if (!doneOccurrences.has(occurrenceKey(r.id, date))) out.push({ ruleId: r.id, date, currency: w.currency, amountMinor: r.amountMinor });
    }
  }
  // своё же с накоплений — придёт, если там есть столько (зарплатой не считается: в horizonLimit только доходы)
  for (const i of savingsInflows(input, today, until)) out.push(i);
  return out;
}

/** Обязательные платежи с сегодня по `until` и просроченные (на сегодня). */
function pendingPayments(input: ForecastInput, until: IsoDate): PaymentFlow[] {
  const { today, doneOccurrences } = input;
  const walletOf = new Map(input.wallets.map((w) => [w.id, w] as const));
  const debtOf = new Map(input.debts.map((d) => [d.id, d] as const));
  const yesterday = addDays(today, -1);
  const out: PaymentFlow[] = [];
  for (const r of input.rules) {
    if (r.deletedAt !== null || r.archivedAt !== null) continue;
    const debt = r.debtId === null ? undefined : debtOf.get(r.debtId);
    if (debt?.direction === 'borrowed' && !isOpenDebt(debt)) continue; // долг закрыт или отдан — платить по нему нечего
    const amount = outflowOf(r, walletOf);
    if (amount === 0) continue;
    const currency = amount === 'unknown' ? null : (walletOf.get(r.walletId)?.currency ?? null);
    const flow = (date: IsoDate, overdue: boolean): PaymentFlow => ({ date, currency, amountMinor: amount === 'unknown' ? r.amountMinor : amount, debtId: r.debtId, overdue });
    for (const date of occurrencesBetween(r, today, until)) {
      if (!doneOccurrences.has(occurrenceKey(r.id, date))) out.push(flow(date, false));
    }
    const from = r.overdueFrom;
    if (from === undefined || from === null || !isScheduleDate(from) || from > yesterday) continue;
    for (const date of occurrencesBetween(r, from, yesterday)) {
      if (!doneOccurrences.has(occurrenceKey(r.id, date))) out.push(flow(today, true));
    }
  }
  return capToDebts(out, debtOf);
}

/** Долг ещё открыт: не закрыт, не в архиве и остаток больше нуля. */
const isOpenDebt = (d: ForecastDebt): boolean => d.closedAt === null && d.archivedAt === null && isMinor(d.remainingMinor) && d.remainingMinor > 0;

/**
 * Плановые платежи по долгу «я должен» не больше его остатка: по порядку (просроченные, затем по датам) — что сверх остатка,
 * платить не придётся. Суммы в другой валюте, чем долг, сравнить нельзя — их оставляем как есть.
 */
function capToDebts(flows: PaymentFlow[], debtOf: ReadonlyMap<UUID, ForecastDebt>): PaymentFlow[] {
  const order = [...flows.keys()].sort((a, b) => {
    const x = flows[a] as PaymentFlow;
    const y = flows[b] as PaymentFlow;
    if (x.overdue !== y.overdue) return x.overdue ? -1 : 1;
    return x.date < y.date ? -1 : x.date > y.date ? 1 : a - b;
  });
  const used = new Map<UUID, Minor>();
  const capped = flows.map((f) => ({ ...f }));
  for (const k of order) {
    const f = capped[k] as PaymentFlow;
    const debt = f.debtId === null ? undefined : debtOf.get(f.debtId);
    if (debt === undefined || debt.direction !== 'borrowed' || f.currency !== debt.currency) continue;
    const left = addMinor(debt.remainingMinor, -(used.get(debt.id) ?? 0));
    f.amountMinor = left <= 0 ? 0 : f.amountMinor > left ? left : f.amountMinor;
    used.set(debt.id, addMinor(used.get(debt.id) ?? 0, f.amountMinor));
  }
  return capped.filter((f) => f.amountMinor > 0);
}

/**
 * До какого дня смотрим: до дня перед ближайшей ещё не проведённой датой «зарплаты», но не раньше «конца без дохода».
 * «Зарплата» — регулярный доход, приходящий не реже раза в месяц (не разовый, не последний платёж, не раз в квартал или в год),
 * с самой крупной суммой за раз в основной валюте; из равных — тот, что придёт раньше. Мелкие, редкие и разовые доходы горизонт
 * не двигают: аренда 1-го перед зарплатой 5-го видна, а дальше следующей копии зарплаты не смотрим — следующий месяц живёт на неё.
 * Доход в валюте без курса сравнить нельзя, а последняя выплата зарплаты «зарплатой» уже не считается — до дня перед ними
 * смотрим тоже (так только осторожнее). Сегодняшний доход сюда не
 * входит (ahead — строго после сегодня), поэтому «Провести» утром горизонт не меняет; проведённая заранее дата уже лежит
 * в остатке — ждём следующую.
 */
function horizonLimit(input: ForecastInput, ahead: readonly IncomeFlow[], noIncomeEnd: IsoDate): IsoDate {
  const { base, getRate } = input;
  const ruleOf = new Map(input.rules.map((r) => [r.id, r] as const));
  const value = (i: IncomeFlow): Minor | null => {
    if (i.currency === base) return i.amountMinor;
    const rate = getRate(i.currency, base);
    return rate !== null && Number.isFinite(rate) && rate > 0 ? convertMinor(i.amountMinor, i.currency, base, rate) : null;
  };
  /** Приходит не реже раза в месяц: после ближайшей даты будет ещё одна не позже чем через 31 день (раз в квартал, в год,
   *  последний платёж и разовый доход — нет). */
  const regular = (r: ForecastRule, next: IsoDate): boolean => occurrencesBetween(r, addDays(next, 1), addDays(next, 31)).length > 0;
  const nextOf = new Map<UUID, IncomeFlow>();
  for (const i of ahead) {
    const first = nextOf.get(i.ruleId);
    if (first === undefined || i.date < first.date) nextOf.set(i.ruleId, i);
  }
  const candidates: { value: Minor | null; next: IsoDate }[] = [];
  /** Последняя выплата регулярного дохода (зарплата до конца контракта): «зарплатой» не считаем, но до неё смотрим. */
  const lastPayments: IsoDate[] = [];
  for (const [ruleId, i] of nextOf) {
    const r = ruleOf.get(ruleId);
    if (r === undefined || r.kind !== 'income') continue;
    if (regular(r, i.date)) candidates.push({ value: value(i), next: i.date });
    else if (r.startOn < i.date && occurrencesBetween(r, addDays(i.date, -31), addDays(i.date, -1)).length > 0) lastPayments.push(i.date);
  }
  let max: Minor | null = null;
  for (const c of candidates) if (c.value !== null && (max === null || c.value > max)) max = c.value;
  let salaryNext: IsoDate | null = null;
  for (const c of candidates) if (c.value === max && (salaryNext === null || c.next < salaryNext)) salaryNext = c.next;
  let end = salaryNext === null ? noIncomeEnd : laterOf(noIncomeEnd, addDays(salaryNext, -1));
  // сравнить нельзя (нет курса) или это последняя выплата — до неё смотрим тоже: горизонт от этого только длиннее, цифра осторожнее
  for (const c of candidates) if (c.value === null) end = laterOf(end, addDays(c.next, -1));
  for (const d of lastPayments) end = laterOf(end, addDays(d, -1));
  return end;
}

/**
 * Регулярные расходы, которые ещё лягут в общий лимит ЭТОГО месяца: не проведённые и не пропущенные даты с сегодня до конца
 * месяца и просроченные даты этого же месяца (проведённая операция получает дату по расписанию — прошлый месяц сюда не попадёт).
 * С любого кошелька, накопления тоже (лимит считает все траты); без долговых — их лимит не считает. У регулярного перевода в лимит
 * ляжет только комиссия. uncertain — что-то не вошло (кошелёк не найден, нет курса); converted — что-то пересчитано по курсу.
 */
function scheduledForBudget(input: ForecastInput, monthEnd: IsoDate): { totalMinor: Minor; uncertain: boolean; converted: boolean } {
  const { today, doneOccurrences, base, getRate } = input;
  const walletOf = new Map(input.wallets.map((w) => [w.id, w] as const));
  const monthStart = `${today.slice(0, 8)}01`;
  const byCurrency = new Map<CurrencyCode, Minor>();
  let unknown = false;
  for (const r of input.rules) {
    if (r.debtId !== null || r.deletedAt !== null || r.archivedAt !== null) continue;
    const fee = r.kind === 'transfer' ? transferFeeMinor(r, walletOf.get(r.walletId), r.toWalletId ? walletOf.get(r.toWalletId) : undefined) : 0;
    if (r.kind !== 'expense' && fee === 0) continue;
    // с архивным кошельком операцию не провести — в лимит она не ляжет
    if (walletOf.get(r.walletId)?.archivedAt != null || (r.toWalletId ? walletOf.get(r.toWalletId)?.archivedAt != null : false)) continue;
    const from = r.overdueFrom !== undefined && r.overdueFrom !== null && isScheduleDate(r.overdueFrom) ? laterOf(r.overdueFrom, monthStart) : today;
    const dates = occurrencesBetween(r, from < today ? from : today, monthEnd).filter((d) => !doneOccurrences.has(occurrenceKey(r.id, d)));
    if (dates.length === 0) continue;
    const currency = walletOf.get(r.walletId)?.currency;
    if (currency === undefined) {
      unknown = true;
      continue;
    }
    for (let k = 0; k < dates.length; k++) addTo(byCurrency, currency, r.kind === 'expense' ? r.amountMinor : fee);
  }
  const sums = toBase(byCurrency, base, getRate);
  return { totalMinor: sums.totalMinor, uncertain: unknown || sums.missing.length > 0, converted: sums.converted };
}

/** Запас денег к контрольному дню и из чего он сложился. */
interface Checkpoint {
  date: IsoDate;
  days: number;
  /** Запас на сегодня, пока сегодняшний доход ещё не проведён (горизонт — «до сегодняшнего дохода»). */
  beforeTodayIncome: boolean;
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
    const ahead = incomes.filter((i) => i.date > today);
    const dueToday = incomes.length > ahead.length;
    const incomeDates = new Set(ahead.map((i) => i.date));
    const noIncomeEnd = laterOf(monthEnd, addDays(today, MIN_HORIZON_DAYS - 1));
    const lastDate = horizonLimit(input, ahead, noIncomeEnd);
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

    /** withTodayIncome = false — запас на сегодня, пока сегодняшний доход ещё не проведён: только то, что на руках. */
    const checkpoint = (date: IsoDate, withTodayIncome = true): Checkpoint => {
      const incomeByCurrency = new Map<CurrencyCode, Minor>();
      for (const i of incomes) if (i.date <= date && (withTodayIncome || i.date > today)) addTo(incomeByCurrency, i.currency, i.amountMinor);

      // долг со сроком к этому дню учитывается остатком — его платежи по расписанию второй раз не берём.
      // Утром дня дохода (withTodayIncome = false) сегодняшние платежи и сроки не берём: их отдают из сегодняшнего дохода —
      // накануне вечером они так же считались вместе с ним. Просроченное — берём: его уже пора было отдать из того, что есть.
      const debtsDue = debtsOpen.filter((d) => d.dueOn !== null && (withTodayIncome ? d.dueOn <= date : d.dueOn < today));
      const debtIdsDue = new Set(debtsDue.map((d) => d.id));
      const debtByCurrency = new Map<CurrencyCode, Minor>();
      for (const d of debtsDue) addTo(debtByCurrency, d.currency, d.remainingMinor);

      const paymentByCurrency = new Map<CurrencyCode, Minor>();
      const paymentCount = new Map<CurrencyCode, number>();
      const overdueByCurrency = new Map<CurrencyCode, Minor>();
      const overdueCount = new Map<CurrencyCode, number>();
      let unknownWalletPayments = 0;
      for (const p of payments) {
        if (p.date > date || (!withTodayIncome && !p.overdue) || (p.debtId !== null && debtIdsDue.has(p.debtId))) continue;
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
        beforeTodayIncome: !withTodayIncome,
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
    const points = [...(dueToday ? [checkpoint(today, false)] : []), ...dates.map((d) => checkpoint(d))];
    let tightest = points[0] as Checkpoint;
    // «Денег не хватает» — только по обычным контрольным дням: утром дня дохода тот ещё не проведён, но придёт сегодня
    // (утренняя точка лишь не даёт обещать на сегодня больше, чем на руках)
    let deepest = points.find((p) => !p.beforeTodayIncome) as Checkpoint;
    let perDay = floorDiv(tightest.capMinor, tightest.days);
    let todayLimit = floorDiv(addMinor(tightest.capMinor, input.spentTodayMinor), tightest.days);
    for (const p of points) {
      const v = floorDiv(p.capMinor, p.days);
      if (v < perDay) {
        perDay = v;
        tightest = p;
      }
      if (!p.beforeTodayIncome && p.capMinor < deepest.capMinor) deepest = p;
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
    // Платёж или долг без курса, выпавший на ЛЮБОМ контрольном дне, мог сделать тот день самым тесным — говорим о каждой валюте.
    // Сумма — с того контрольного дня, где платежей и долгов в ней набралось больше всего (на одном дне платёж по долгу и его
    // остаток вместе не встречаются — второй раз один долг не назовём).
    const worst = new Map<CurrencyCode, { total: Minor; payment: Minor; debt: Minor }>();
    for (const p of points) {
      for (const currency of new Set([...p.payments.missing, ...p.debts.missing])) {
        const payment = p.payments.missing.includes(currency) ? (p.paymentByCurrency.get(currency) ?? 0) : 0;
        const debt = p.debts.missing.includes(currency) ? (p.debtByCurrency.get(currency) ?? 0) : 0;
        const total = addMinor(payment, debt);
        if (total > (worst.get(currency)?.total ?? -1)) worst.set(currency, { total, payment, debt });
      }
    }
    for (const [currency, w] of worst) if (w.payment > 0) skipped.push({ source: 'payment', currency, amountMinor: w.payment });
    for (const [currency, w] of worst) if (w.debt > 0) skipped.push({ source: 'debt', currency, amountMinor: w.debt });
    const unknownWalletPayments = Math.max(...points.map((p) => p.unknownWalletPayments));
    const converted = money.converted || points.some((p) => p.income.converted || p.payments.converted || p.debts.converted);

    const perDayMinor = perDay > 0 ? perDay : 0;
    const todayLimitMinor = todayLimit > 0 ? todayLimit : 0;
    const scheduled = scheduledForBudget(input, monthEnd);
    const budget = budgetPart(input.totalBudget, base, today, monthEnd, scheduled);
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
      incomeDate: c.beforeTodayIncome ? today : incomeDates.has(nextDay) ? nextDay : null,
      untilTodayIncome: c.beforeTodayIncome,
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
      unknownWalletPayments,
      approximate:
        skipped.length > 0 ||
        unknownWalletPayments > 0 ||
        converted ||
        // лимит посчитан не по всем операциям: настоящая цифра по лимиту может быть ниже и стать меньшей (0 ниже не бывает)
        (budget !== null && budget.partial && effective.perDayMinor > 0) ||
        (effective.by === 'budget' && scheduled.converted),
    };
  } catch (e) {
    if (e instanceof RangeError) return { status: 'overflow' };
    throw e;
  }
}
