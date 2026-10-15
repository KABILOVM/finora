import { daysBetween, floorDiv } from './forecast';
import { addMinor, isMinor } from './money';
import type { IsoDate, Minor, Transaction, UUID } from './types';

/**
 * Цели накопления — ЧИСТЫЕ функции (без базы, React и часов). Цель — сумма (и необязательный срок) у кошелька вида «Накопления»;
 * накоплено = остаток кошелька, он считается из операций (domain/balances.ts) и нигде не хранится.
 * Проценты и деление — целыми числами (BigInt/floorDiv), поэтому на больших суммах точность не теряется.
 */

export interface GoalProgress {
  goalMinor: Minor;
  /** Остаток кошелька сейчас (может быть отрицательным). */
  balanceMinor: Minor;
  /** Целый процент, вниз: 0…100 (цель достигнута — 100, остаток не больше нуля — 0). */
  percent: number;
  /** Сколько ещё накопить (0, если цель достигнута). */
  remainingMinor: Minor;
  reached: boolean;
  /** Дней до срока; отрицательное — срок прошёл. null — срока нет. */
  daysLeft: number | null;
  /** Срок прошёл, а цель не достигнута. */
  overdue: boolean;
  /** Целых месяцев до срока, не меньше 1 (срок сегодня или в этом месяце — один месяц). null — срока нет, он прошёл или цель достигнута. */
  monthsLeft: number | null;
  /** Сколько откладывать в месяц, чтобы успеть: остаток ÷ месяцев, вверх. null — когда monthsLeft нет. */
  perMonthMinor: Minor | null;
}

/** Целое деление вверх для a ≥ 0, b ≥ 1 без потери точности. */
export function ceilDiv(a: Minor, b: number): Minor {
  return a <= 0 ? 0 : floorDiv(a - 1, b) + 1;
}

/** Целый процент a от b, вниз, BigInt. Не больше 100 для a ≥ b. */
function percentOf(a: Minor, b: Minor): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b <= 0 || a <= 0) return 0;
  if (a >= b) return 100;
  return Number((BigInt(a) * 100n) / BigInt(b));
}

/** Полных календарных месяцев от `from` до `to` ('ГГГГ-ММ-ДД', to ≥ from): день месяца учитывается (с 15 октября по 14 ноября — 0). */
export function wholeMonthsBetween(from: IsoDate, to: IsoDate): number {
  const [fy = 0, fm = 1, fd = 1] = from.split('-').map(Number);
  const [ty = 0, tm = 1, td = 1] = to.split('-').map(Number);
  const m = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, m);
}

export interface GoalInput {
  balanceMinor: Minor;
  goalMinor: Minor;
  goalOn: IsoDate | null;
  today: IsoDate;
}

export function goalProgress({ balanceMinor, goalMinor, goalOn, today }: GoalInput): GoalProgress {
  const reached = balanceMinor >= goalMinor;
  const remainingMinor = reached ? 0 : goalMinor - balanceMinor; // обе безопасные целые, разность не выходит за ±2·MAX_SAFE
  const daysLeft = goalOn === null ? null : daysBetween(today, goalOn);
  const overdue = !reached && daysLeft !== null && daysLeft < 0;
  const monthsLeft = reached || goalOn === null || daysLeft === null || daysLeft < 0 ? null : Math.max(1, wholeMonthsBetween(today, goalOn));
  return {
    goalMinor,
    balanceMinor,
    percent: percentOf(balanceMinor, goalMinor),
    remainingMinor,
    reached,
    daysLeft,
    overdue,
    monthsLeft,
    perMonthMinor: monthsLeft === null ? null : ceilDiv(remainingMinor, monthsLeft),
  };
}

export type FlowTx = Pick<Transaction, 'kind' | 'walletId' | 'toWalletId' | 'amountMinor' | 'toAmountMinor' | 'occurredOn' | 'deletedAt'>;

/**
 * Сколько пришло на кошелёк за период [from, to] (обе даты включительно): доходы и переводы на него минус расходы и переводы с него.
 * Те же знаки, что у остатка (computeBalances). Может быть отрицательным. Бросает RangeError, если сумма не помещается в безопасное целое.
 */
export function walletNetFlow(walletId: UUID, txs: readonly FlowTx[], from: IsoDate, to: IsoDate): Minor {
  let net: Minor = 0;
  for (const t of txs) {
    if (t.deletedAt !== null || t.occurredOn < from || t.occurredOn > to) continue;
    if (!isMinor(t.amountMinor) || t.amountMinor <= 0) continue;
    if (t.kind === 'income' && t.walletId === walletId) net = addMinor(net, t.amountMinor);
    else if (t.kind === 'expense' && t.walletId === walletId) net = addMinor(net, -t.amountMinor);
    else if (t.kind === 'transfer') {
      const credit = t.toAmountMinor ?? t.amountMinor;
      if (t.walletId === walletId) net = addMinor(net, -t.amountMinor);
      if (t.toWalletId === walletId && isMinor(credit) && credit > 0) net = addMinor(net, credit);
    }
  }
  return net;
}

/** С какого числа месяца «пора отложить» напоминает: в первой половине месяца ещё рано. */
export const NUDGE_FROM_DAY = 15;

export interface SavingNudge {
  /** Сколько отложено в этом месяце (не меньше 0). */
  savedMinor: Minor;
  /** Сколько нужно отложить за этот месяц, чтобы успеть к сроку. */
  neededMinor: Minor;
}

/**
 * «Пора отложить»: срок есть и впереди, цель не достигнута, идёт вторая половина месяца, а за этот месяц на кошелёк пришло меньше нужного.
 * Нужное за месяц = (остаток на начало месяца) ÷ месяцев до срока, вверх; остаток на начало = остаток сейчас + отложенное в этом месяце.
 * savedThisMonth — walletNetFlow за текущий месяц. null — напоминать не о чем.
 */
export function savingNudge(progress: GoalProgress, savedThisMonthMinor: Minor, today: IsoDate): SavingNudge | null {
  if (progress.reached || progress.monthsLeft === null) return null;
  if (Number(today.slice(8, 10)) < NUDGE_FROM_DAY) return null;
  const saved = Math.max(0, savedThisMonthMinor);
  const needed = ceilDiv(addMinor(progress.remainingMinor, saved), progress.monthsLeft);
  return saved < needed ? { savedMinor: saved, neededMinor: needed } : null;
}

/** Порядок целей: со сроком — раньше, по сроку; без срока — в конце; при равенстве — меньший процент выше. */
export function compareGoals(a: { goalOn: IsoDate | null; percent: number; id: string }, b: { goalOn: IsoDate | null; percent: number; id: string }): number {
  if (a.goalOn !== b.goalOn) return a.goalOn === null ? 1 : b.goalOn === null ? -1 : a.goalOn < b.goalOn ? -1 : 1;
  return a.percent - b.percent || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
