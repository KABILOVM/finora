import { mergeLinks } from '@/domain/debtGroups';
import { computeDebtState, type DebtPayment, type DebtState, type DebtTx } from '@/domain/debts';
import { addMinor } from '@/domain/money';
import type { CurrencyCode, Debt, DebtDirection, IsoDate, LocalRow, Minor, UUID, Wallet } from '@/domain/types';
import { compareRu } from '@/db/sort';
import { progressPercent } from './debtText';

/** Чистая сводка по долгам: остатки, группы для экрана, итоги по валютам, просрочка. Без React и без базы. */

export interface DebtItem {
  debt: LocalRow<Debt>;
  /** null — суммы по этому долгу не помещаются в расчёт (переполнение): показываем честное сообщение, а не нули. */
  state: DebtState | null;
  /**
   * Объединённый долг: свои долги всех составляющих, главный первым (у каждого свои сумма, проценты, срок, даты, платежи).
   * Есть только у главного долга с составляющими; его debt и state тогда — ИТОГ по ним (foldGroups).
   */
  parts?: DebtItem[];
}

/** Остатки всех долгов. Переполнение одного долга не роняет остальные; любая другая ошибка — настоящий сбой, её не прячем. */
export function buildDebtItems(
  debts: readonly LocalRow<Debt>[],
  txs: readonly DebtTx[],
  wallets: ReadonlyMap<UUID, Pick<Wallet, 'currency'>>,
): DebtItem[] {
  const byDebt = new Map<UUID, DebtTx[]>();
  for (const t of txs) {
    if (t.debtId === null || t.debtId === undefined) continue;
    const list = byDebt.get(t.debtId);
    if (list) list.push(t);
    else byDebt.set(t.debtId, [t]);
  }
  return debts
    .filter((d) => d.deletedAt === null)
    .sort(compareDebts)
    .map((debt) => {
      try {
        return { debt, state: computeDebtState(debt, byDebt.get(debt.id) ?? [], wallets) };
      } catch (e) {
        if (e instanceof RangeError) return { debt, state: null };
        throw e;
      }
    });
}

const byDate = (a: DebtPayment, b: DebtPayment): number =>
  a.occurredOn !== b.occurredOn ? (a.occurredOn < b.occurredOn ? -1 : 1) : a.txId < b.txId ? -1 : a.txId > b.txId ? 1 : 0;

/**
 * Итог по составляющим: суммы, проценты, платежи и выдачи складываются. Остаток — только по незакрытым частям (закрытая часть
 * списана и в остаток не входит, как закрытый долг не входит в итоги); закрыты все — остаток всех, как у закрытого долга.
 * Переплата одной части другую не гасит: у каждой части свой остаток. null — суммы не помещаются в расчёт.
 */
function sumStates(own: readonly DebtItem[]): DebtState | null {
  try {
    const first = own[0]!;
    const anyOpen = own.some((it) => it.debt.closedAt === null);
    let principal = 0;
    let interest = 0;
    let paid = 0;
    let issued = 0;
    let overpaid = 0;
    let remaining = 0;
    const payments: DebtPayment[] = [];
    const entries: DebtPayment[] = [];
    const issues: DebtState['issues'] = [];
    for (const it of own) {
      const s = it.state;
      if (s === null) return null;
      principal = addMinor(principal, s.principalMinor);
      interest = addMinor(interest, s.interestMinor);
      paid = addMinor(paid, s.paidMinor);
      issued = addMinor(issued, s.issuedMinor);
      overpaid = addMinor(overpaid, s.overpaidMinor);
      if (!anyOpen || it.debt.closedAt === null) remaining = addMinor(remaining, s.remainingMinor);
      payments.push(...s.payments);
      entries.push(...s.entries);
      issues.push(...s.issues);
    }
    return {
      principalMinor: principal,
      interestMinor: interest,
      totalMinor: addMinor(principal, interest),
      currency: first.debt.currency,
      paidMinor: paid,
      remainingMinor: remaining,
      overpaidMinor: overpaid,
      issuedMinor: issued,
      settled: remaining === 0,
      payments: payments.sort(byDate),
      entries: entries.sort(byDate),
      issues,
    };
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** Долг ещё что-то должен принести/отдать: не закрыт, не в архиве и остаток больше нуля. */
const owingNow = (it: DebtItem): boolean =>
  it.debt.closedAt === null && it.debt.archivedAt === null && it.state !== null && it.state.remainingMinor > 0;

/**
 * Один элемент списка вместо главного долга и его составляющих: имя, направление и валюта главного, сумма и проценты — сумма по частям,
 * дата — самая ранняя, срок — ближайший среди тех, что ещё должны (нет таких — ближайший вообще), закрыт — только когда закрыты все.
 * Ставка и срок кредита остаются, только если у всех частей с процентами они одинаковые и процентами обложены все.
 */
function aggregate(own: readonly DebtItem[]): DebtItem {
  const root = own[0]!;
  const state = sumStates(own);
  const debts = own.map((it) => it.debt);
  const nearest = (list: readonly DebtItem[]): string | null =>
    list.reduce<string | null>((min, it) => (it.debt.dueOn !== null && (min === null || it.debt.dueOn < min) ? it.debt.dueOn : min), null);
  const owing = own.filter(owingNow);
  const dueOn = nearest(owing.length > 0 ? owing : own);
  const open = debts.filter((d) => d.closedAt === null);
  const withInterest = debts.filter((d) => (d.interestMinor ?? 0) > 0);
  const sameTerms = withInterest.length === debts.length && withInterest.every((d) => d.interestRateBp === withInterest[0]!.interestRateBp && d.termMonths === withInterest[0]!.termMonths);
  const debt: LocalRow<Debt> = {
    ...root.debt,
    principalMinor: state?.principalMinor ?? root.debt.principalMinor,
    interestMinor: state !== null ? (state.interestMinor > 0 ? state.interestMinor : null) : root.debt.interestMinor,
    interestRateBp: sameTerms ? withInterest[0]!.interestRateBp : null,
    termMonths: sameTerms ? withInterest[0]!.termMonths : null,
    openedOn: debts.reduce((min, d) => (d.openedOn < min ? d.openedOn : min), root.debt.openedOn),
    dueOn,
    closedAt: open.length === 0 ? root.debt.closedAt : null,
  };
  return { debt, state, parts: [...own] };
}

/**
 * Список без составляющих: главный долг объединения и его части идут ОДНИМ элементом (aggregate), у которого в `parts` лежат
 * свои долги каждой части. Итоги, просрочка и списки считаются по таким элементам, поэтому ничего не удваивается.
 * Связь, которая не действует (главный удалён, вложенность, другая валюта — domain/debtGroups.ts), игнорируется: долг виден сам по себе.
 */
export function foldGroups(items: readonly DebtItem[]): DebtItem[] {
  const { rootOf, parts } = mergeLinks(items.map((it) => it.debt));
  if (rootOf.size === 0) return [...items];
  const byId = new Map(items.map((it) => [it.debt.id, it] as const));
  const out: DebtItem[] = [];
  for (const it of items) {
    if (rootOf.has(it.debt.id)) continue;
    const kids = (parts.get(it.debt.id) ?? []).map((k) => byId.get(k.id)).filter((x): x is DebtItem => x !== undefined);
    out.push(kids.length > 0 ? aggregate([it, ...kids]) : it);
  }
  return out.sort((a, b) => compareDebts(a.debt, b.debt));
}

/** Порядок как у useDebts: незакрытые первыми, затем по сроку (без срока — в конце), затем новые сверху. */
export function compareDebts(a: Debt, b: Debt): number {
  if ((a.closedAt === null) !== (b.closedAt === null)) return a.closedAt === null ? -1 : 1;
  if (a.dueOn !== b.dueOn) return a.dueOn === null ? 1 : b.dueOn === null ? -1 : a.dueOn < b.dueOn ? -1 : 1;
  if (a.openedOn !== b.openedOn) return a.openedOn < b.openedOn ? 1 : -1;
  const byName = compareRu(a.counterparty, b.counterparty);
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface DebtGroups {
  /** Не закрыты, не в архиве, остаток больше нуля (или не посчитан). */
  active: DebtItem[];
  /** Выплачены полностью (остаток ноль), но ещё не закрыты: их остаётся закрыть. */
  settled: DebtItem[];
  /** Закрыты, не в архиве. */
  closed: DebtItem[];
  /** В архиве (закрытые или нет). */
  archived: DebtItem[];
}

export function groupDebts(items: readonly DebtItem[], direction: DebtDirection): DebtGroups {
  const out: DebtGroups = { active: [], settled: [], closed: [], archived: [] };
  for (const it of items) {
    if (it.debt.direction !== direction) continue;
    if (it.debt.archivedAt !== null) out.archived.push(it);
    else if (it.debt.closedAt !== null) out.closed.push(it);
    else if (it.state !== null && it.state.settled) out.settled.push(it);
    else out.active.push(it);
  }
  return out;
}

/** Долг ещё что-то должен принести/отдать: не закрыт, не в архиве и остаток больше нуля. */
export const isOwing = (it: DebtItem): boolean =>
  it.debt.closedAt === null && it.debt.archivedAt === null && it.state !== null && it.state.remainingMinor > 0;

export interface CurrencyTotal {
  currency: CurrencyCode;
  minor: Minor;
}

export type Totals = { ok: true; totals: CurrencyTotal[] } | { ok: false };

/**
 * Сколько всего осталось по долгам: ОТДЕЛЬНО по каждой валюте (разные валюты без курса не складываем — это были бы выдуманные деньги).
 * Основная валюта идёт первой, остальные по коду. Переполнение суммы — { ok: false }, а не неверное число.
 */
export function remainingByCurrency(items: readonly DebtItem[], base?: CurrencyCode): Totals {
  const sums = new Map<CurrencyCode, Minor>();
  try {
    for (const it of items) {
      if (!isOwing(it) || it.state === null) continue;
      sums.set(it.debt.currency, addMinor(sums.get(it.debt.currency) ?? 0, it.state.remainingMinor));
    }
  } catch (e) {
    if (e instanceof RangeError) return { ok: false };
    throw e;
  }
  const totals = [...sums].map(([currency, minor]) => ({ currency, minor }));
  totals.sort((a, b) => {
    if ((a.currency === base) !== (b.currency === base)) return a.currency === base ? -1 : 1;
    return compareRu(a.currency, b.currency);
  });
  return { ok: true, totals };
}

/**
 * Какая доля открытых долгов уже погашена: сумма выплаченного к сумме долгов (с процентами), целые проценты. Считается по ОДНОЙ валюте (суммы разных
 * валют не складываем); долгов в ней нет, всё ещё не тронуто (0 выплат) или суммы не помещаются в расчёт — null.
 */
export function repaidShare(items: readonly DebtItem[], currency: CurrencyCode): number | null {
  try {
    let paid = 0;
    let total = 0;
    for (const it of items) {
      if (!isOwing(it) || it.state === null || it.debt.currency !== currency) continue;
      paid = addMinor(paid, Math.min(it.state.paidMinor, it.state.totalMinor));
      total = addMinor(total, it.state.totalMinor);
    }
    if (total <= 0 || paid <= 0) return null;
    return progressPercent(paid, total);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** Сколько долгов просрочено на сегодня: срок строго раньше сегодняшнего дня, а остаток ещё есть. */
export function overdueCount(items: readonly DebtItem[], today: IsoDate): number {
  return items.filter((it) => isOwing(it) && it.debt.dueOn !== null && it.debt.dueOn < today).length;
}

/** Долг с ближайшим сроком среди тех, что ещё должны (просроченные — раньше всех). null — сроков нет. */
export function nearestDue(items: readonly DebtItem[]): DebtItem | null {
  let best: DebtItem | null = null;
  for (const it of items) {
    if (!isOwing(it) || it.debt.dueOn === null) continue;
    if (best === null || best.debt.dueOn === null || it.debt.dueOn < best.debt.dueOn) best = it;
  }
  return best;
}

/**
 * Какая вкладка «Долгов» открывается, когда адрес её не называет: там, где есть открытые долги. Есть и там и там — где просрочка
 * (если только в одной); иначе «Мне должны». Человек, у которого только «Я должен», не упирается в пустой экран.
 */
export function defaultDirection(items: readonly DebtItem[], today: IsoDate): DebtDirection {
  const open = (d: DebtDirection) => items.filter((it) => it.debt.direction === d && isOwing(it));
  const lent = open('lent');
  const borrowed = open('borrowed');
  if (lent.length === 0 && borrowed.length > 0) return 'borrowed';
  if (lent.length > 0 && borrowed.length > 0 && overdueCount(lent, today) === 0 && overdueCount(borrowed, today) > 0) return 'borrowed';
  return 'lent';
}
