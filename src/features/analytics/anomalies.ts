import { isAdjustment } from '@/domain/adjustment';
import { addMinor } from '@/domain/money';
import { normNote } from '@/domain/subscriptions';
import type { CurrencyCode, IsoDate, Minor, Transaction, UUID } from '@/domain/types';
import { shiftMonth } from '@/features/transactions/txFilters';

/**
 * «Что бросается в глаза»: три вида того, что стоит заметить в расходах месяца. ЧИСТЫЕ функции (без базы и часов), правила учёта
 * те же, что у «Итогов месяца»: суммы по снимкам в основной валюте, переводы, операции по долгам, корректировки остатка и операции
 * по расписанию в расходы-«события» не входят (аренда по расписанию не может быть «необычной тратой»).
 *  - крупная трата: больше любой из прошлых трат этой категории и заметно больше обычной (медианы);
 *  - новая статья: заметная доля расходов месяца в категории, где в последние три месяца трат не было;
 *  - возможный дубль: две и больше одинаковых трат (кошелёк, категория, сумма, заметка) в один день.
 * «Необычно много за месяц по категории» уже показывает «Темп трат» (domain/pace.ts), здесь его нет.
 * Бросают RangeError, если суммы не помещаются в безопасное целое.
 */

export type AnomalyTx = Pick<
  Transaction,
  'id' | 'kind' | 'walletId' | 'categoryId' | 'amountMinor' | 'baseAmountMinor' | 'baseCurrency' | 'occurredOn' | 'note' | 'debtId' | 'recurringRuleId' | 'deletedAt'
> & { fxSource?: string | null | undefined };

/** Сколько прошлых трат категории нужно, чтобы говорить, что у неё есть «обычная». */
export const MIN_HISTORY = 5;
/** Сколько месяцев назад смотрим «обычное» для крупной траты. */
export const HISTORY_MONTHS = 5;
/** Крупная трата — не меньше стольких процентов от обычной (2,5 раза). */
export const BIG_FACTOR_PERCENT = 250;
/** …и не меньше стольких процентов расходов месяца: мелочь не показываем. */
export const MIN_SHARE_PERCENT = 5;
/** Новая статья — не меньше стольких процентов расходов месяца. */
export const NEW_CATEGORY_SHARE_PERCENT = 10;
/** Сколько последних месяцев без трат в категории делают её «новой». */
export const NEW_CATEGORY_MONTHS = 3;
/** Сколько из этих месяцев должны быть «живыми» (с расходами вообще): иначе у человека нет истории, и «новое» всё подряд. */
export const MIN_ACTIVE_MONTHS = 2;
/** Сколько находок каждого вида показываем. */
export const MAX_PER_KIND = 3;

export interface BigPurchase {
  key: string;
  txId: UUID;
  categoryId: UUID;
  amountMinor: Minor;
  /** Обычная трата в этой категории (медиана прошлых). */
  usualMinor: Minor;
  occurredOn: IsoDate;
  note: string;
}

export interface NewCategory {
  key: string;
  categoryId: UUID;
  spentMinor: Minor;
  /** Доля расходов месяца, целым процентом вниз. */
  sharePercent: number;
}

export interface DuplicateGroup {
  key: string;
  txIds: UUID[];
  walletId: UUID;
  categoryId: UUID | null;
  /** Сумма одной траты в основной валюте (по снимку). */
  amountMinor: Minor;
  occurredOn: IsoDate;
  note: string;
}

export interface Anomalies {
  big: BigPurchase[];
  fresh: NewCategory[];
  dupes: DuplicateGroup[];
}

/** Расход, который считается тратой: не удалён, в основной валюте, не долг, не корректировка. */
const isSpend = (t: AnomalyTx, base: CurrencyCode): boolean =>
  t.deletedAt === null && t.kind === 'expense' && t.baseCurrency === base && (t.debtId ?? null) === null && !isAdjustment(t);

/** Трата, которую человек внёс сам (не по расписанию). */
const isManual = (t: AnomalyTx, base: CurrencyCode): boolean => isSpend(t, base) && (t.recurringRuleId ?? null) === null;

const monthStart = (month: string): IsoDate => `${month}-01`;
const monthEnd = (month: string): IsoDate => `${month}-31`;

/** Медиана (при чётном числе — нижняя из двух средних, как у «Необычно много» в domain/pace.ts). */
function median(values: readonly Minor[]): Minor {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** a ≥ b × percent / 100 без потери точности. */
const atLeastPercent = (a: Minor, b: Minor, percent: number): boolean => BigInt(a) * 100n >= BigInt(b) * BigInt(percent);

/** Траты месяца `month` не позже сегодняшнего дня (то, что уже случилось). */
function monthSpends(txs: readonly AnomalyTx[], month: string, today: IsoDate, base: CurrencyCode): AnomalyTx[] {
  return txs.filter((t) => isSpend(t, base) && t.occurredOn >= monthStart(month) && t.occurredOn <= monthEnd(month) && t.occurredOn <= today);
}

/** Расходы месяца вместе (по снимкам), для долей. */
function total(spends: readonly AnomalyTx[]): Minor {
  return spends.reduce((sum, t) => addMinor(sum, t.baseAmountMinor), 0);
}

/** Траты, которые больше любой из прошлых в своей категории и не меньше 2,5 обычной. Самые заметные первыми. */
export function bigPurchases(txs: readonly AnomalyTx[], month: string, today: IsoDate, base: CurrencyCode): BigPurchase[] {
  const spends = monthSpends(txs, month, today, base);
  const monthTotal = total(spends);
  if (monthTotal <= 0) return [];
  const since = monthStart(shiftMonth(month, -HISTORY_MONTHS));
  const history = new Map<UUID, Minor[]>();
  for (const t of txs) {
    if (!isManual(t, base) || t.categoryId === null || t.occurredOn < since || t.occurredOn >= monthStart(month)) continue;
    const list = history.get(t.categoryId);
    if (list) list.push(t.baseAmountMinor);
    else history.set(t.categoryId, [t.baseAmountMinor]);
  }
  const out: BigPurchase[] = [];
  for (const t of spends) {
    if (!isManual(t, base) || t.categoryId === null || t.baseAmountMinor <= 0) continue;
    const past = history.get(t.categoryId);
    if (!past || past.length < MIN_HISTORY) continue;
    const usual = median(past);
    if (usual <= 0 || t.baseAmountMinor <= Math.max(...past)) continue;
    if (!atLeastPercent(t.baseAmountMinor, usual, BIG_FACTOR_PERCENT) || !atLeastPercent(t.baseAmountMinor, monthTotal, MIN_SHARE_PERCENT)) continue;
    out.push({ key: `big:${t.id}`, txId: t.id, categoryId: t.categoryId, amountMinor: t.baseAmountMinor, usualMinor: usual, occurredOn: t.occurredOn, note: t.note.trim() });
  }
  return out.sort((a, b) => b.amountMinor - b.usualMinor - (a.amountMinor - a.usualMinor) || (a.txId < b.txId ? -1 : 1)).slice(0, MAX_PER_KIND);
}

/** Категории, на которые в этом месяце ушла заметная доля расходов, а в последние три месяца трат не было. */
export function newCategories(txs: readonly AnomalyTx[], month: string, today: IsoDate, base: CurrencyCode): NewCategory[] {
  const spends = monthSpends(txs, month, today, base);
  const monthTotal = total(spends);
  if (monthTotal <= 0) return [];
  // у человека должна быть история: хотя бы в двух из трёх прошлых месяцев были расходы
  const lookback = Array.from({ length: NEW_CATEGORY_MONTHS }, (_, i) => shiftMonth(month, -(i + 1)));
  const seen = new Set<UUID>();
  const activeMonths = new Set<string>();
  for (const t of txs) {
    if (!isSpend(t, base)) continue;
    const m = t.occurredOn.slice(0, 7);
    if (!lookback.includes(m)) continue;
    activeMonths.add(m);
    if (t.categoryId !== null) seen.add(t.categoryId);
  }
  if (activeMonths.size < MIN_ACTIVE_MONTHS) return [];
  const byCategory = new Map<UUID, Minor>();
  for (const t of spends) {
    if (t.categoryId === null || seen.has(t.categoryId)) continue;
    byCategory.set(t.categoryId, addMinor(byCategory.get(t.categoryId) ?? 0, t.baseAmountMinor));
  }
  const out: NewCategory[] = [];
  for (const [categoryId, spentMinor] of byCategory) {
    if (spentMinor <= 0 || !atLeastPercent(spentMinor, monthTotal, NEW_CATEGORY_SHARE_PERCENT)) continue;
    out.push({ key: `new:${month}:${categoryId}`, categoryId, spentMinor, sharePercent: Number((BigInt(spentMinor) * 100n) / BigInt(monthTotal)) });
  }
  return out.sort((a, b) => b.spentMinor - a.spentMinor || (a.categoryId < b.categoryId ? -1 : 1)).slice(0, MAX_PER_KIND);
}

/**
 * Одинаковые траты в один день: тот же кошелёк, категория, сумма и заметка (без регистра и лишних пробелов). Две порции кофе по одной
 * цене бывают, поэтому экран спрашивает «не дубль ли?», а не утверждает. Самые свежие дни первыми. `from`/`to` — границы (включительно).
 */
export function duplicateGroups(txs: readonly AnomalyTx[], from: IsoDate, to: IsoDate, base: CurrencyCode): DuplicateGroup[] {
  const groups = new Map<string, AnomalyTx[]>();
  for (const t of txs) {
    if (!isManual(t, base) || t.occurredOn < from || t.occurredOn > to) continue;
    const key = [t.walletId, t.categoryId ?? '', t.amountMinor, normNote(t.note), t.occurredOn].join('|');
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const out: DuplicateGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const ids = list.map((t) => t.id).sort();
    const first = list[0]!;
    out.push({ key: `dup:${key}`, txIds: ids, walletId: first.walletId, categoryId: first.categoryId, amountMinor: first.baseAmountMinor, occurredOn: first.occurredOn, note: first.note.trim() });
  }
  return out.sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : a.key < b.key ? -1 : 1));
}

/** Всё сразу для месяца `month`; `txs` должны покрывать месяц и пять предыдущих. */
export function findAnomalies(txs: readonly AnomalyTx[], month: string, today: IsoDate, base: CurrencyCode): Anomalies {
  const to = today < monthEnd(month) ? today : monthEnd(month);
  return {
    big: bigPurchases(txs, month, today, base),
    fresh: newCategories(txs, month, today, base),
    dupes: duplicateGroups(txs, monthStart(month), to, base).slice(0, MAX_PER_KIND),
  };
}

export const hasAnomalies = (a: Anomalies): boolean => a.big.length > 0 || a.fresh.length > 0 || a.dupes.length > 0;
