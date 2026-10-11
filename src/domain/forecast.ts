import { addDays } from '@/lib/dates';
import { addMinor, isMinor } from './money';
import { isScheduleDate, occurrencesBetween, type ScheduleRule } from './schedule';
import { totalInBase } from './totals';
import type { CurrencyCode, DebtDirection, IsoDate, IsoDateTime, Minor, TxKind, UUID, WalletKind } from './types';

/**
 * «Сколько можно тратить в день» — ЧИСТАЯ функция с явными входами (без базы, без часов, без часовых поясов).
 * Сегодняшнюю дату вызывающий передаёт сам (todayLocal()).
 *
 *  1. «Деньги на руках» = остатки кошельков cash / card / bank / other (БЕЗ накопления), в основной валюте.
 *  2. Горизонт: от сегодня (включительно) до конца месяца; если раньше будет ожидаемый ДОХОД по регулярному правилу
 *     (ещё не проведённый и не пропущенный, строго после сегодня) — до дня ПЕРЕД ним. Дней осталось ≥ 1.
 *  3. Обязательное до конца горизонта вычитается: расходные правила по расписанию (проведённые и пропущенные за дату не считаются)
 *     и остаток по долгам «я должен» со сроком возврата не позже конца горизонта (просроченные — тоже: они уже должны быть отданы).
 *     Платёж по долгу, который уже учтён остатком долга, второй раз не вычитается.
 *  4. perDay = max(0, floor((деньги − обязательное) / днейОсталось)). Все деления целочисленные, округление вниз:
 *     никогда не обещаем больше, чем есть. Деньги, платежи и долги в валюте без курса в расчёт не входят — это возвращается в skipped.
 */

/** Виды кошельков, чьи деньги можно тратить. Накопления — нет. */
export const SPENDABLE_KINDS: readonly WalletKind[] = ['cash', 'card', 'bank', 'other'];
/** За сколько последних дней считается «обычно вы тратите в день». */
export const USUAL_WINDOW_DAYS = 30;

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
  /** В валюте кошелька правила. */
  amountMinor: Minor;
  debtId: UUID | null;
  archivedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
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
  /** Расходы сегодня (без долгов, с комиссиями), в основной валюте. */
  spentTodayMinor: Minor;
  /** Средний расход в день за последние дни (usualPerDay); null — истории ещё нет. */
  usualPerDayMinor: Minor | null;
  totalBudget: ForecastTotalBudget | null;
}

export interface ForecastSkipped {
  source: 'money' | 'payment' | 'debt';
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

export interface DailyForecastOk {
  status: 'ok';
  base: CurrencyCode;
  today: IsoDate;
  monthEnd: IsoDate;
  /** Последний день, на который делим деньги. */
  horizonEnd: IsoDate;
  /** Дата ожидаемого дохода, сократившего горизонт; null — считаем до конца месяца. */
  incomeDate: IsoDate | null;
  /** Дней от сегодня до конца горизонта включительно (≥ 1). */
  daysLeft: number;
  moneyMinor: Minor;
  paymentsMinor: Minor;
  paymentsCount: number;
  debtsMinor: Minor;
  debtsCount: number;
  obligationsMinor: Minor;
  /** Деньги − обязательное (может быть отрицательным). */
  availableMinor: Minor;
  /** max(0, floor(available / daysLeft)). */
  perDayMinor: Minor;
  /** Денег не хватает до конца горизонта. */
  notEnough: boolean;
  /** Сколько не хватает (0, если хватает). */
  shortfallMinor: Minor;
  /** Сколько можно было потратить за сегодня с утра: floor((available + потрачено сегодня) / daysLeft). */
  todayLimitMinor: Minor;
  spentTodayMinor: Minor;
  usualPerDayMinor: Minor | null;
  budget: ForecastBudgetPart | null;
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

/** Ближайший ещё не проведённый доход строго после сегодня и не позже конца месяца. */
function nextIncomeDate(input: ForecastInput, monthEnd: IsoDate): IsoDate | null {
  const { today, rules, doneOccurrences } = input;
  if (today >= monthEnd) return null;
  const from = addDays(today, 1);
  let best: IsoDate | null = null;
  for (const r of rules) {
    if (r.kind !== 'income' || r.deletedAt !== null || r.archivedAt !== null) continue;
    for (const date of occurrencesBetween(r, from, monthEnd)) {
      if (doneOccurrences.has(occurrenceKey(r.id, date))) continue;
      if (best === null || date < best) best = date;
      break; // даты по возрастанию: дальше только позже
    }
  }
  return best;
}

/**
 * Прогноз «сколько можно тратить в день». Не бросает: переполнение сумм возвращается признаком status: 'overflow'.
 * Вызывающий отвечает за то, чтобы входы были согласованы (остатки — из computeBalances, остаток долга — из computeDebtState).
 */
export function computeDailyForecast(input: ForecastInput): DailyForecast {
  const { today, base, getRate } = input;
  if (!isScheduleDate(today)) return { status: 'bad-date' };
  const wallets = input.wallets.filter((w) => w.archivedAt === null);
  if (wallets.length === 0) return { status: 'no-wallets' };
  const spendable = wallets.filter((w) => SPENDABLE_KINDS.includes(w.kind));
  if (spendable.length === 0) return { status: 'only-savings' };

  try {
    const skipped: ForecastSkipped[] = [];
    const skip = (source: ForecastSkipped['source'], missing: readonly CurrencyCode[], sums: ReadonlyMap<CurrencyCode, Minor>) => {
      for (const currency of missing) skipped.push({ source, currency, amountMinor: sums.get(currency) ?? 0 });
    };

    // 1. деньги на руках
    const moneyByCurrency = new Map<CurrencyCode, Minor>();
    for (const w of spendable) addTo(moneyByCurrency, w.currency, input.balances.get(w.id) ?? 0);
    const money = toBase(moneyByCurrency, base, getRate);
    skip('money', money.missing, moneyByCurrency);

    // 2. горизонт
    const monthEnd = endOfMonth(today);
    const incomeDate = nextIncomeDate(input, monthEnd);
    const horizonEnd = incomeDate === null ? monthEnd : addDays(incomeDate, -1);
    const daysLeft = daysBetween(today, horizonEnd) + 1;

    // 3. обязательное: долги «я должен» к сроку и расходные правила по расписанию
    const debtsDue = input.debts.filter(
      (d) =>
        d.direction === 'borrowed' &&
        d.closedAt === null &&
        d.archivedAt === null &&
        d.dueOn !== null &&
        d.dueOn <= horizonEnd &&
        isMinor(d.remainingMinor) &&
        d.remainingMinor > 0,
    );
    const debtIdsDue = new Set(debtsDue.map((d) => d.id));
    const debtByCurrency = new Map<CurrencyCode, Minor>();
    for (const d of debtsDue) addTo(debtByCurrency, d.currency, d.remainingMinor);

    const currencyOfWallet = new Map(input.wallets.map((w) => [w.id, w.currency] as const));
    const paymentByCurrency = new Map<CurrencyCode, Minor>();
    const paymentCountByCurrency = new Map<CurrencyCode, number>();
    let unknownWalletPayments = 0;
    for (const r of input.rules) {
      if (r.kind !== 'expense' || r.deletedAt !== null || r.archivedAt !== null) continue;
      if (r.debtId !== null && debtIdsDue.has(r.debtId)) continue; // уже учтено остатком долга
      for (const date of occurrencesBetween(r, today, horizonEnd)) {
        if (input.doneOccurrences.has(occurrenceKey(r.id, date))) continue;
        const currency = currencyOfWallet.get(r.walletId);
        if (currency === undefined) {
          unknownWalletPayments++;
          continue;
        }
        addTo(paymentByCurrency, currency, r.amountMinor);
        paymentCountByCurrency.set(currency, (paymentCountByCurrency.get(currency) ?? 0) + 1);
      }
    }

    const payments = toBase(paymentByCurrency, base, getRate);
    const debts = toBase(debtByCurrency, base, getRate);
    skip('payment', payments.missing, paymentByCurrency);
    skip('debt', debts.missing, debtByCurrency);

    let paymentsCount = 0;
    for (const [currency, n] of paymentCountByCurrency) if (!payments.missing.includes(currency)) paymentsCount += n;

    const obligationsMinor = addMinor(payments.totalMinor, debts.totalMinor);
    const availableMinor = addMinor(money.totalMinor, -obligationsMinor);

    // 4. результат
    const notEnough = availableMinor < 0;
    const withToday = addMinor(availableMinor, input.spentTodayMinor);
    return {
      status: 'ok',
      base,
      today,
      monthEnd,
      horizonEnd,
      incomeDate,
      daysLeft,
      moneyMinor: money.totalMinor,
      paymentsMinor: payments.totalMinor,
      paymentsCount,
      debtsMinor: debts.totalMinor,
      debtsCount: debtsDue.filter((d) => !debts.missing.includes(d.currency)).length,
      obligationsMinor,
      availableMinor,
      perDayMinor: availableMinor > 0 ? floorDiv(availableMinor, daysLeft) : 0,
      notEnough,
      shortfallMinor: notEnough ? -availableMinor : 0,
      todayLimitMinor: withToday > 0 ? floorDiv(withToday, daysLeft) : 0,
      spentTodayMinor: input.spentTodayMinor,
      usualPerDayMinor: input.usualPerDayMinor,
      budget: budgetPart(input.totalBudget, base, today, monthEnd),
      skipped,
      unknownWalletPayments,
      approximate: skipped.length > 0 || unknownWalletPayments > 0 || money.converted || payments.converted || debts.converted,
    };
  } catch (e) {
    if (e instanceof RangeError) return { status: 'overflow' };
    throw e;
  }
}
