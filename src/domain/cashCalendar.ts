import { addDays } from '@/lib/dates';
import { SPENDABLE_KINDS, type ForecastDebt, type ForecastRule, type ForecastSkipped, type ForecastWallet, occurrenceKey } from './forecast';
import { addMinor, convertMinor, isMinor } from './money';
import { isScheduleDate, occurrencesBetween } from './schedule';
import { totalInBase } from './totals';
import type { CurrencyCode, IsoDate, Minor, UUID, WalletKind } from './types';

/**
 * Денежный календарь — ЧИСТАЯ функция (без базы, без часов): как будут меняться «деньги на руках» по дням ближайших недель.
 * Деньги на руках — те же, что в прогнозе «сколько можно тратить в день» (forecast.ts): кошельки cash / card / bank / other без накоплений.
 *
 * На каждый день ставятся:
 *  - регулярные платежи и доходы по расписанию, ещё не проведённые и не пропущенные (расход с обычного кошелька и перевод с него
 *    на накопления — минус; доход на обычный кошелёк и перевод с накоплений на обычный — плюс; остальное на деньги на руках не влияет);
 *  - просроченные платежи (прошлые даты не раньше overdueFrom правила, не проведённые и не пропущенные) — одним событием на сегодня;
 *    просроченный доход не ставится: обещать деньги, которые могут и не прийти, нельзя;
 *  - срок долга «я должен» (минус остаток; просроченный — сегодня); платёж по долгу, уже учтённый остатком, второй раз не берётся;
 *  - по желанию: «мне должны» к сроку (плюс остаток; просроченный — сегодня) — это только ожидание, поэтому включается отдельно;
 *  - по желанию: обычные траты — каждый день минус usualPerDay (за сегодня — то, что ещё не потрачено).
 * Деньги, платежи и долги в валюте без курса в расчёт не входят (skipped), цифры помечаются как приблизительные.
 */

/** На сколько дней вперёд смотрит календарь (с сегодняшним). */
export const CALENDAR_DAYS = 30;

export interface CalendarInput {
  today: IsoDate;
  base: CurrencyCode;
  /** Все живые кошельки (в том числе архивные: по ним определяется валюта правил); деньги считаются только по неархивным. */
  wallets: readonly ForecastWallet[];
  balances: ReadonlyMap<UUID, Minor>;
  /** Живые правила; архивные функция отбрасывает сама. */
  rules: readonly ForecastRule[];
  /** Какие даты правил уже проведены или пропущены: ключи occurrenceKey(ruleId, date). */
  doneOccurrences: ReadonlySet<string>;
  /** Долги обоих направлений. */
  debts: readonly ForecastDebt[];
  getRate: (from: CurrencyCode, to: CurrencyCode) => number | null;
  /** Обычный расход в день; null — истории ещё нет. */
  usualPerDayMinor: Minor | null;
  /** Уже потрачено сегодня из кошельков «на руках». */
  spentTodayMinor: Minor;
  includeUsual: boolean;
  includeReceivables: boolean;
  /** Подписи событий по id правила или долга. */
  labels?: ReadonlyMap<UUID, string>;
  /** Сколько дней показать (по умолчанию CALENDAR_DAYS). */
  days?: number;
}

export type CalendarEventKind = 'payment' | 'income' | 'debt-pay' | 'debt-receive';

export interface CalendarEvent {
  kind: CalendarEventKind;
  /** Id правила или долга. */
  id: UUID;
  label: string;
  date: IsoDate;
  /** Изменение денег на руках в основной валюте (минус — уходят). */
  deltaMinor: Minor;
  /** Срок уже прошёл (долг или платёж просрочен): событие поставлено на сегодня. */
  overdue?: boolean;
  /** Сколько просроченных дат платежа собрано в это событие. */
  overdueCount?: number;
}

export interface CalendarDay {
  date: IsoDate;
  events: CalendarEvent[];
  /** Сумма событий дня. */
  eventsMinor: Minor;
  /** Обычные траты дня (≤ 0); 0, если не учитываются. */
  usualMinor: Minor;
  /** Деньги на руках на конец дня. */
  balanceMinor: Minor;
}

export interface CashCalendarOk {
  status: 'ok';
  base: CurrencyCode;
  today: IsoDate;
  /** Последний показанный день. */
  endDate: IsoDate;
  /** Деньги на руках сейчас. */
  startMinor: Minor;
  /** Деньги на руках на конец последнего дня. */
  endMinor: Minor;
  /** Все дни от сегодня подряд, в том числе без событий. */
  days: CalendarDay[];
  /** Самое маленькое значение остатка за период и первый день, когда оно было. */
  minBalanceMinor: Minor;
  minDate: IsoDate;
  /** Первый день, на конец которого денег меньше нуля; null — не уходят в минус. */
  firstNegativeDate: IsoDate | null;
  /** Применены ли обычные траты (включены и есть история). */
  usualApplied: boolean;
  usualPerDayMinor: Minor | null;
  skipped: ForecastSkipped[];
  /** Платежи, у которых кошелёк не найден (в расчёт не вошли). */
  unknownWalletPayments: number;
  approximate: boolean;
}

export type CashCalendar = CashCalendarOk | { status: 'no-wallets' } | { status: 'only-savings' } | { status: 'overflow' } | { status: 'bad-date' };

const isSpendableKind = (kind: WalletKind | undefined): boolean => kind !== undefined && SPENDABLE_KINDS.includes(kind);

/** 'out' — деньги уходят с «денег на руках», 'in' — приходят, 'none' — не влияет, 'unknown' — кошелёк не найден, понять нельзя. */
function flowOf(r: ForecastRule, kindOf: ReadonlyMap<UUID, WalletKind>): 'out' | 'in' | 'none' | 'unknown' {
  const from = kindOf.get(r.walletId);
  if (r.kind === 'expense') return from === undefined ? 'unknown' : isSpendableKind(from) ? 'out' : 'none';
  if (r.kind === 'income') return isSpendableKind(from) ? 'in' : 'none';
  if (!r.toWalletId) return 'none';
  const to = kindOf.get(r.toWalletId);
  if (from === undefined || to === undefined) return 'unknown';
  if (isSpendableKind(from) && !isSpendableKind(to)) return 'out';
  if (!isSpendableKind(from) && isSpendableKind(to)) return 'in';
  return 'none';
}

/** Бросать не бросает: переполнение сумм возвращается признаком status: 'overflow'. */
export function computeCashCalendar(input: CalendarInput): CashCalendar {
  const { today, base, getRate } = input;
  const nDays = input.days ?? CALENDAR_DAYS;
  if (!isScheduleDate(today) || !Number.isInteger(nDays) || nDays < 1) return { status: 'bad-date' };
  const wallets = input.wallets.filter((w) => w.archivedAt === null);
  if (wallets.length === 0) return { status: 'no-wallets' };
  const spendable = wallets.filter((w) => SPENDABLE_KINDS.includes(w.kind));
  if (spendable.length === 0) return { status: 'only-savings' };

  try {
    const endDate = addDays(today, nDays - 1);
    const kindOf = new Map(input.wallets.map((w) => [w.id, w.kind] as const));
    const currencyOf = new Map(input.wallets.map((w) => [w.id, w.currency] as const));
    const skippedBy = new Map<string, ForecastSkipped>();
    let converted = false;
    let unknownWalletPayments = 0;

    const skip = (source: ForecastSkipped['source'], currency: CurrencyCode, amount: Minor) => {
      const key = `${source}|${currency}`;
      const cur = skippedBy.get(key);
      skippedBy.set(key, { source, currency, amountMinor: addMinor(cur?.amountMinor ?? 0, Math.abs(amount)) });
    };
    /** Сумма в валюте `currency` → основная валюта; null — курса нет (записано в skipped). */
    const inBase = (amount: Minor, currency: CurrencyCode, source: ForecastSkipped['source']): Minor | null => {
      if (currency === base) return amount;
      const rate = getRate(currency, base);
      if (rate === null || !Number.isFinite(rate) || rate <= 0) {
        skip(source, currency, amount);
        return null;
      }
      converted = true;
      return convertMinor(amount, currency, base, rate);
    };

    // 1. деньги на руках сейчас
    const moneyByCurrency = new Map<CurrencyCode, Minor>();
    for (const w of spendable) moneyByCurrency.set(w.currency, addMinor(moneyByCurrency.get(w.currency) ?? 0, input.balances.get(w.id) ?? 0));
    const items = [...moneyByCurrency].filter(([c, sum]) => c === base || sum !== 0).map(([currency, balanceMinor]) => ({ currency, balanceMinor }));
    const money = totalInBase(items, base, getRate);
    for (const c of money.missing) skip('money', c, moneyByCurrency.get(c) ?? 0);
    if (items.some((i) => i.currency !== base && !money.missing.includes(i.currency))) converted = true;
    const startMinor = money.totalMinor;

    // 2. события
    const byDate = new Map<IsoDate, CalendarEvent[]>();
    const put = (e: CalendarEvent) => {
      const list = byDate.get(e.date);
      if (list) list.push(e);
      else byDate.set(e.date, [e]);
    };
    const label = (id: UUID, fallback: string): string => input.labels?.get(id) ?? fallback;
    const dueDate = (dueOn: IsoDate): IsoDate => (dueOn < today ? today : dueOn);
    const openDue = (d: ForecastDebt, direction: ForecastDebt['direction']): boolean =>
      d.direction === direction &&
      d.closedAt === null &&
      d.archivedAt === null &&
      d.dueOn !== null &&
      d.dueOn <= endDate &&
      isMinor(d.remainingMinor) &&
      d.remainingMinor > 0;

    const coveredDebts = new Set<UUID>();
    for (const d of input.debts) {
      if (openDue(d, 'borrowed')) {
        coveredDebts.add(d.id);
        const delta = inBase(d.remainingMinor, d.currency, 'debt');
        if (delta !== null && d.dueOn !== null) {
          put({ kind: 'debt-pay', id: d.id, label: label(d.id, 'Возврат долга'), date: dueDate(d.dueOn), deltaMinor: -delta, ...(d.dueOn < today ? { overdue: true } : {}) });
        }
      } else if (input.includeReceivables && openDue(d, 'lent')) {
        coveredDebts.add(d.id);
        const delta = inBase(d.remainingMinor, d.currency, 'debt');
        if (delta !== null && d.dueOn !== null) {
          put({ kind: 'debt-receive', id: d.id, label: label(d.id, 'Вернут долг'), date: dueDate(d.dueOn), deltaMinor: delta, ...(d.dueOn < today ? { overdue: true } : {}) });
        }
      }
    }

    const yesterday = addDays(today, -1);
    for (const r of input.rules) {
      if (r.deletedAt !== null || r.archivedAt !== null) continue;
      const flow = flowOf(r, kindOf);
      if (flow === 'none') continue;
      if (r.debtId !== null && coveredDebts.has(r.debtId)) continue; // уже учтено остатком долга
      const currency = currencyOf.get(r.walletId);
      const known = flow !== 'unknown' && currency !== undefined;
      for (const date of occurrencesBetween(r, today, endDate)) {
        if (input.doneOccurrences.has(occurrenceKey(r.id, date))) continue;
        if (!known) {
          if (r.kind !== 'income') unknownWalletPayments++;
          continue;
        }
        const amount = inBase(r.amountMinor, currency, 'payment');
        if (amount === null) continue;
        put({
          kind: flow === 'out' ? 'payment' : 'income',
          id: r.id,
          label: label(r.id, flow === 'out' ? 'Платёж' : 'Доход'),
          date,
          deltaMinor: flow === 'out' ? -amount : amount,
        });
      }

      // просроченные расходы — одним событием на сегодня
      if (flow === 'in' || r.kind === 'income') continue;
      const from = r.overdueFrom;
      if (from === undefined || from === null || !isScheduleDate(from) || from > yesterday) continue;
      let overdueCount = 0;
      for (const date of occurrencesBetween(r, from, yesterday)) if (!input.doneOccurrences.has(occurrenceKey(r.id, date))) overdueCount++;
      if (overdueCount === 0) continue;
      if (!known) {
        unknownWalletPayments += overdueCount;
        continue;
      }
      let sum: Minor = 0;
      for (let i = 0; i < overdueCount; i++) sum = addMinor(sum, r.amountMinor);
      const amount = inBase(sum, currency, 'payment');
      if (amount === null) continue;
      put({ kind: 'payment', id: r.id, label: label(r.id, 'Платёж'), date: today, deltaMinor: -amount, overdue: true, overdueCount });
    }

    // 3. дни: остаток на конец каждого
    const usualApplied = input.includeUsual && input.usualPerDayMinor !== null && isMinor(input.usualPerDayMinor) && input.usualPerDayMinor >= 0;
    const usual = usualApplied ? (input.usualPerDayMinor ?? 0) : 0;
    const days: CalendarDay[] = [];
    let balance = startMinor;
    let minBalanceMinor = Number.POSITIVE_INFINITY;
    let minDate: IsoDate = today;
    let firstNegativeDate: IsoDate | null = null;
    for (let i = 0; i < nDays; i++) {
      const date = addDays(today, i);
      const events = (byDate.get(date) ?? []).sort((a, b) => a.deltaMinor - b.deltaMinor || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
      let eventsMinor: Minor = 0;
      for (const e of events) eventsMinor = addMinor(eventsMinor, e.deltaMinor);
      // за сегодня обычные траты — только то, что ещё не потрачено (потраченное уже вычтено из остатка)
      const usualToday = i === 0 ? Math.max(0, usual - Math.max(0, input.spentTodayMinor)) : usual;
      const usualMinor = usualApplied && usualToday > 0 ? -usualToday : 0; // без «минус нуля»
      balance = addMinor(addMinor(balance, eventsMinor), usualMinor);
      if (balance < minBalanceMinor) {
        minBalanceMinor = balance;
        minDate = date;
      }
      if (firstNegativeDate === null && balance < 0) firstNegativeDate = date;
      days.push({ date, events, eventsMinor, usualMinor, balanceMinor: balance });
    }

    const skipped = [...skippedBy.values()];
    return {
      status: 'ok',
      base,
      today,
      endDate,
      startMinor,
      endMinor: balance,
      days,
      minBalanceMinor,
      minDate,
      firstNegativeDate,
      usualApplied,
      usualPerDayMinor: input.usualPerDayMinor,
      skipped,
      unknownWalletPayments,
      approximate: skipped.length > 0 || unknownWalletPayments > 0 || converted,
    };
  } catch (e) {
    if (e instanceof RangeError) return { status: 'overflow' };
    throw e;
  }
}
