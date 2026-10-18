import { addDays } from '@/lib/dates';
import {
  isSpendableWallet,
  occurrenceKey,
  SPENDABLE_KINDS,
  transferFeeMinor,
  type ForecastDebt,
  type ForecastRule,
  type ForecastSkipped,
  type ForecastWallet,
} from './forecast';
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
 *    на накопления — минус; комиссия перевода между обычными — минус; доход на обычный неархивный кошелёк и перевод с накоплений
 *    на него — плюс (зачисленная сумма); остальное на деньги на руках не влияет);
 *  - просроченные платежи (прошлые даты не раньше overdueFrom правила, не проведённые и не пропущенные) — одним событием на сегодня;
 *    просроченный доход не ставится: обещать деньги, которые могут и не прийти, нельзя;
 *  - срок долга «я должен» (минус остаток за вычетом плановых платежей до срока; просроченный — сегодня); плановые платежи по нему
 *    с даты срока уже внутри остатка и второй раз не берутся;
 *  - по желанию: «мне должны» к сроку (плюс остаток; просроченный — сегодня) и плановые возвраты по открытым таким долгам (не больше
 *    остатка) — это только ожидание, поэтому включается отдельно;
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

/** Сколько денег правила за одну дату уходит с «денег на руках» ('out') или приходит на них ('in'), в какой валюте. */
interface Move {
  flow: 'out' | 'in';
  amountMinor: Minor;
  currency: CurrencyCode;
}

/**
 * Движение денег правила: 'none' — на деньги на руках не влияет, 'unknown' — кошелёк не найден, понять нельзя.
 * Приходят — только на обычный НЕархивный кошелёк: деньги архивного в «деньги на руках» не входят (как и в прогнозе «в день»).
 * Перевод между обычными кошельками уносит только комиссию; с накоплений приходит зачисленная сумма.
 */
function moveOf(r: ForecastRule, walletOf: ReadonlyMap<UUID, ForecastWallet>): Move | 'none' | 'unknown' {
  const from = walletOf.get(r.walletId);
  if (r.kind === 'expense') {
    if (from === undefined) return 'unknown';
    return isSpendableWallet(from) ? { flow: 'out', amountMinor: r.amountMinor, currency: from.currency } : 'none';
  }
  if (r.kind === 'income') return from !== undefined && isSpendableWallet(from) ? { flow: 'in', amountMinor: r.amountMinor, currency: from.currency } : 'none';
  if (!r.toWalletId) return 'none';
  const to = walletOf.get(r.toWalletId);
  if (from === undefined || to === undefined) return 'unknown';
  if (from.archivedAt !== null || to.archivedAt !== null) return 'none'; // с архивным кошельком операцию не провести
  if (isSpendableKind(from.kind) && !isSpendableKind(to.kind)) return { flow: 'out', amountMinor: r.amountMinor, currency: from.currency };
  if (!isSpendableKind(from.kind) && isSpendableKind(to.kind)) {
    const received = r.toAmountMinor;
    if (received !== null && received !== undefined && isMinor(received)) return { flow: 'in', amountMinor: received, currency: to.currency };
    return from.currency === to.currency ? { flow: 'in', amountMinor: r.amountMinor, currency: to.currency } : 'none';
  }
  if (isSpendableKind(from.kind) && isSpendableKind(to.kind)) {
    const fee = transferFeeMinor(r, from, to);
    return fee > 0 ? { flow: 'out', amountMinor: fee, currency: from.currency } : 'none';
  }
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
    const walletOf = new Map(input.wallets.map((w) => [w.id, w] as const));
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

    // Долг к сроку учтён остатком: «я должен» — мои плановые платежи С ДАТЫ СРОКА второй раз не берём (до срока — платятся как
    // обычно, и остаток к сроку на них меньше), «мне должны» (если включено) — плановые возвраты мне не берём совсем.
    const coveredDebts = new Map<UUID, ForecastDebt>();
    for (const d of input.debts) {
      if (openDue(d, 'borrowed') || (input.includeReceivables && openDue(d, 'lent'))) coveredDebts.set(d.id, d);
    }
    const debtOf = new Map(input.debts.map((d) => [d.id, d] as const));
    const isOpen = (d: ForecastDebt): boolean => d.closedAt === null && d.archivedAt === null && isMinor(d.remainingMinor) && d.remainingMinor > 0;

    /** Плановое движение по правилу: одна дата или все просроченные даты сразу (на сегодня). */
    interface Planned {
      rule: ForecastRule;
      move: Move;
      date: IsoDate;
      count: number;
      overdue: boolean;
    }
    /** Движения по долгам: по долгу — в порядке дат и не больше остатка (что сверх остатка, платить или ждать не придётся). */
    const byDebt = new Map<UUID, Planned[]>();
    const planned: Planned[] = [];
    const plan = (p: Planned) => {
      const debt = p.rule.debtId === null ? undefined : debtOf.get(p.rule.debtId);
      const capped = debt !== undefined && ((debt.direction === 'borrowed' && p.move.flow === 'out') || (debt.direction === 'lent' && p.move.flow === 'in'));
      if (!capped || debt === undefined) {
        planned.push(p);
        return;
      }
      const list = byDebt.get(debt.id);
      if (list) list.push(p);
      else byDebt.set(debt.id, [p]);
    };

    const yesterday = addDays(today, -1);
    for (const r of input.rules) {
      if (r.deletedAt !== null || r.archivedAt !== null) continue;
      const move = moveOf(r, walletOf);
      if (move === 'none') continue;
      const flow = move === 'unknown' ? 'unknown' : move.flow;
      const debt = r.debtId === null ? undefined : debtOf.get(r.debtId);
      const covered = r.debtId === null ? undefined : coveredDebts.get(r.debtId);
      if (covered?.direction === 'lent' && flow === 'in') continue; // уже учтено остатком долга
      // «я должен» закрыт или отдан — платить по нему нечего
      if (debt?.direction === 'borrowed' && flow !== 'in' && !isOpen(debt)) continue;
      // возврат «мне должны» по расписанию — только ожидание: как и остаток такого долга, ставится, лишь если включено,
      // и только пока долг открыт
      const receivable = r.kind === 'income' && r.debtId !== null && debt?.direction !== 'borrowed';
      if (receivable && (!input.includeReceivables || debt === undefined || !isOpen(debt))) continue;
      /** Дата позже срока долга «я должен», учтённого остатком: этот платёж уже внутри остатка. */
      const insideDebt = (date: IsoDate): boolean => covered?.direction === 'borrowed' && flow !== 'in' && covered.dueOn !== null && date >= covered.dueOn;

      for (const date of occurrencesBetween(r, today, endDate)) {
        if (input.doneOccurrences.has(occurrenceKey(r.id, date)) || insideDebt(date)) continue;
        if (move === 'unknown') {
          if (r.kind !== 'income') unknownWalletPayments++;
          continue;
        }
        plan({ rule: r, move, date, count: 1, overdue: false });
      }

      // просроченные расходы — одним событием на сегодня
      if (flow === 'in' || r.kind === 'income') continue;
      const from = r.overdueFrom;
      if (from === undefined || from === null || !isScheduleDate(from) || from > yesterday) continue;
      let overdueCount = 0;
      for (const date of occurrencesBetween(r, from, yesterday)) {
        if (!input.doneOccurrences.has(occurrenceKey(r.id, date)) && !insideDebt(date)) overdueCount++;
      }
      if (overdueCount === 0) continue;
      if (move === 'unknown') {
        unknownWalletPayments += overdueCount;
        continue;
      }
      plan({ rule: r, move, date: today, count: overdueCount, overdue: true });
    }

    /** Плановые платежи по долгу «я должен» до его срока: в валюте долга (если та же) и остальное — в основной валюте. */
    const paidSame = new Map<UUID, Minor>();
    const paidBase = new Map<UUID, Minor>();
    const putPlanned = (p: Planned, amountMinor: Minor) => {
      const amount = inBase(amountMinor, p.move.currency, 'payment');
      if (amount === null) return;
      const title = label(p.rule.id, p.move.flow === 'out' ? 'Платёж' : 'Доход');
      put({
        kind: p.move.flow === 'out' ? 'payment' : 'income',
        id: p.rule.id,
        label: title,
        date: p.date,
        deltaMinor: p.move.flow === 'out' ? -amount : amount,
        ...(p.overdue ? { overdue: true, overdueCount: p.count } : {}),
      });
    };
    const total = (p: Planned): Minor => {
      let sum: Minor = 0;
      for (let i = 0; i < p.count; i++) sum = addMinor(sum, p.move.amountMinor);
      return sum;
    };
    for (const p of planned) putPlanned(p, total(p));
    for (const [debtId, list] of byDebt) {
      const debt = debtOf.get(debtId) as ForecastDebt;
      list.sort((a, b) => (a.overdue !== b.overdue ? (a.overdue ? -1 : 1) : a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      let left = debt.remainingMinor;
      for (const p of list) {
        let amount = total(p);
        if (p.move.currency === debt.currency) {
          if (left <= 0) break;
          if (amount > left) amount = left;
          left = addMinor(left, -amount);
          if (debt.direction === 'borrowed') paidSame.set(debtId, addMinor(paidSame.get(debtId) ?? 0, amount));
        } else if (debt.direction === 'borrowed') {
          const inB = inBase(amount, p.move.currency, 'payment');
          if (inB !== null) paidBase.set(debtId, addMinor(paidBase.get(debtId) ?? 0, inB));
        }
        putPlanned(p, amount);
      }
    }

    for (const d of coveredDebts.values()) {
      if (d.dueOn === null) continue;
      const overdue = d.dueOn < today ? { overdue: true } : {};
      if (d.direction === 'borrowed') {
        // к сроку отдать остаток за вычетом плановых платежей до срока (не меньше нуля)
        const rest = addMinor(d.remainingMinor, -(paidSame.get(d.id) ?? 0));
        if (rest <= 0) continue;
        const restBase = inBase(rest, d.currency, 'debt');
        if (restBase === null) continue;
        const delta = addMinor(restBase, -(paidBase.get(d.id) ?? 0));
        if (delta > 0) put({ kind: 'debt-pay', id: d.id, label: label(d.id, 'Возврат долга'), date: dueDate(d.dueOn), deltaMinor: -delta, ...overdue });
      } else {
        const remaining = inBase(d.remainingMinor, d.currency, 'debt');
        if (remaining !== null) put({ kind: 'debt-receive', id: d.id, label: label(d.id, 'Вернут долг'), date: dueDate(d.dueOn), deltaMinor: remaining, ...overdue });
      }
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
