import { computeDebtState, type DebtState, type DebtTx } from '@/domain/debts';
import { addMinor } from '@/domain/money';
import type { CurrencyCode, Debt, DebtDirection, IsoDate, LocalRow, Minor, UUID, Wallet } from '@/domain/types';
import { compareRu } from '@/db/sort';

/** Чистая сводка по долгам: остатки, группы для экрана, итоги по валютам, просрочка. Без React и без базы. */

export interface DebtItem {
  debt: LocalRow<Debt>;
  /** null — суммы по этому долгу не помещаются в расчёт (переполнение): показываем честное сообщение, а не нули. */
  state: DebtState | null;
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
