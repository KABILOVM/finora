import { isAdjustment } from '@/domain/adjustment';
import type { CurrencyCode, IsoDate, Minor, UUID, Wallet } from '@/domain/types';
import { duplicateGroups, isSpend, MIN_HISTORY, type AnomalyTx, type DuplicateGroup } from '@/features/analytics/anomalies';
import { addDays } from '@/lib/dates';

/**
 * «Проверка данных»: что в операциях и кошельках похоже на ошибку внесения. ЧИСТАЯ функция (без базы и часов); ничего не меняет и не
 * утверждает — только показывает кандидатов, а решает человек (каждую находку можно открыть или отметить «Это нормально»).
 *  - возможные дубли: одинаковые траты (кошелёк, категория, сумма, заметка) в один день, за последние DUPLICATE_DAYS дней;
 *  - без категории: расходы и доходы без категории за последние UNCATEGORIZED_DAYS дней;
 *  - дата в будущем: операции позже сегодняшнего дня (опечатка в годе — частый случай);
 *  - выбросы: трата, которая больше любой другой в своей категории за год и не меньше чем в 10 раз больше обычной (опечатка в сумме: лишний ноль);
 *  - отрицательный остаток кошелька (кроме накоплений, где минус невозможен по смыслу, но всё равно ошибка).
 */

export const DUPLICATE_DAYS = 180;
export const UNCATEGORIZED_DAYS = 90;
export const OUTLIER_DAYS = 365;
/** Выброс — не меньше стольких процентов от обычной траты категории (в 10 раз). */
export const OUTLIER_FACTOR_PERCENT = 1000;
/** Сколько находок каждого вида возвращаем (остальные — числом). */
export const MAX_ITEMS = 20;

export type CheckTx = AnomalyTx;

export interface UncategorizedItem {
  id: UUID;
  kind: 'expense' | 'income';
  /** В валюте кошелька. */
  amountMinor: Minor;
  currency: CurrencyCode;
  occurredOn: IsoDate;
  note: string;
}

export interface FutureItem {
  key: string;
  id: UUID;
  kind: 'expense' | 'income' | 'transfer';
  /** В валюте кошелька. */
  amountMinor: Minor;
  currency: CurrencyCode;
  occurredOn: IsoDate;
  note: string;
  /** На сколько дней вперёд. */
  daysAhead: number;
}

export interface Outlier {
  key: string;
  txId: UUID;
  categoryId: UUID;
  amountMinor: Minor;
  usualMinor: Minor;
  occurredOn: IsoDate;
  note: string;
}

export interface NegativeWallet {
  key: string;
  walletId: UUID;
  name: string;
  currency: CurrencyCode;
  balanceMinor: Minor;
}

export interface DataCheck {
  dupes: DuplicateGroup[];
  uncategorized: { total: number; items: UncategorizedItem[] };
  future: { total: number; items: FutureItem[] };
  outliers: Outlier[];
  negative: NegativeWallet[];
}

type WalletLite = Pick<Wallet, 'id' | 'name' | 'currency' | 'archivedAt'>;

const live = (t: CheckTx): boolean => t.deletedAt === null;
const daysBetween = (a: IsoDate, b: IsoDate): number => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);

/** Медиана: при чётном числе — нижняя из двух средних (как у «Необычно много», domain/pace.ts). */
function median(values: readonly Minor[]): Minor {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

export function checkData(i: { txs: readonly CheckTx[]; wallets: readonly WalletLite[]; balances: ReadonlyMap<UUID, Minor>; today: IsoDate; base: CurrencyCode }): DataCheck {
  const { txs, today, base } = i;
  const currencyOf = new Map(i.wallets.map((w) => [w.id, w.currency] as const));
  const alive = txs.filter(live);

  // дубли
  const dupes = duplicateGroups(alive, addDays(today, -DUPLICATE_DAYS), today, base);

  // без категории: настоящие расходы и доходы человека (не переводы, долги, корректировки остатка и операции по расписанию)
  const uncat = alive
    .filter(
      (t) =>
        (t.kind === 'expense' || t.kind === 'income') &&
        t.categoryId === null &&
        (t.debtId ?? null) === null &&
        !isAdjustment(t) &&
        (t.recurringRuleId ?? null) === null &&
        t.occurredOn <= today &&
        t.occurredOn >= addDays(today, -UNCATEGORIZED_DAYS),
    )
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : a.id < b.id ? -1 : 1));

  // будущие даты (по возрастанию: ближайшие первыми)
  const ahead = alive
    .filter((t) => t.occurredOn > today && (t.debtId ?? null) === null && !isAdjustment(t))
    .sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : a.id < b.id ? -1 : 1));

  // выбросы: в категории за год — не меньше MIN_HISTORY других трат
  const since = addDays(today, -OUTLIER_DAYS);
  const byCategory = new Map<UUID, CheckTx[]>();
  for (const t of alive) {
    if (!isSpend(t, base) || (t.recurringRuleId ?? null) !== null || t.categoryId === null || t.occurredOn < since || t.occurredOn > today) continue;
    const list = byCategory.get(t.categoryId);
    if (list) list.push(t);
    else byCategory.set(t.categoryId, [t]);
  }
  const outliers: Outlier[] = [];
  for (const [categoryId, list] of byCategory) {
    if (list.length < MIN_HISTORY + 1) continue;
    for (const t of list) {
      const others = list.filter((o) => o.id !== t.id).map((o) => o.baseAmountMinor);
      const usual = median(others);
      if (usual <= 0 || t.baseAmountMinor <= Math.max(...others)) continue;
      if (BigInt(t.baseAmountMinor) * 100n < BigInt(usual) * BigInt(OUTLIER_FACTOR_PERCENT)) continue;
      outliers.push({ key: `out:${t.id}`, txId: t.id, categoryId, amountMinor: t.baseAmountMinor, usualMinor: usual, occurredOn: t.occurredOn, note: t.note.trim() });
    }
  }
  outliers.sort((a, b) => b.amountMinor - b.usualMinor - (a.amountMinor - a.usualMinor) || (a.txId < b.txId ? -1 : 1));

  // отрицательные остатки
  const negative: NegativeWallet[] = [];
  for (const w of i.wallets) {
    if (w.archivedAt !== null) continue;
    const bal = i.balances.get(w.id) ?? 0;
    if (bal < 0) negative.push({ key: `neg:${w.id}`, walletId: w.id, name: w.name, currency: w.currency, balanceMinor: bal });
  }

  return {
    dupes: dupes.slice(0, MAX_ITEMS),
    uncategorized: {
      total: uncat.length,
      items: uncat.slice(0, MAX_ITEMS).map((t) => ({ id: t.id, kind: t.kind as 'expense' | 'income', amountMinor: t.amountMinor, currency: currencyOf.get(t.walletId) ?? base, occurredOn: t.occurredOn, note: t.note.trim() })),
    },
    future: {
      total: ahead.length,
      items: ahead.slice(0, MAX_ITEMS).map((t) => ({ key: `fut:${t.id}`, id: t.id, kind: t.kind, amountMinor: t.amountMinor, currency: currencyOf.get(t.walletId) ?? base, occurredOn: t.occurredOn, note: t.note.trim(), daysAhead: daysBetween(today, t.occurredOn) })),
    },
    outliers: outliers.slice(0, MAX_ITEMS),
    negative,
  };
}

/** Сколько находок всего (без «нормально» отмеченных: их отсекает экран). */
export const issueCount = (c: DataCheck): number => c.dupes.length + c.uncategorized.total + c.future.total + c.outliers.length + c.negative.length;

export interface OpenFindings {
  dupes: DataCheck['dupes'];
  uncategorized: DataCheck['uncategorized'];
  future: FutureItem[];
  outliers: Outlier[];
  negative: NegativeWallet[];
}

/**
 * Находки, которые человек ещё не отметил «Это нормально» (`hidden` — ключи с этого устройства). Один расчёт и для экрана «Проверка
 * данных», и для плашки в «Операциях»: числа в них не могут разойтись. «Без категории» отметить нельзя — исправляется категорией.
 */
export function openFindings(c: DataCheck, hidden: ReadonlySet<string>): OpenFindings {
  return {
    dupes: c.dupes.filter((d) => !hidden.has(d.key)),
    uncategorized: c.uncategorized,
    future: c.future.items.filter((f) => !hidden.has(f.key)),
    outliers: c.outliers.filter((o) => !hidden.has(o.key)),
    negative: c.negative.filter((n) => !hidden.has(n.key)),
  };
}

/** Сколько пунктов покажет экран «Проверка данных». */
export const openCount = (f: OpenFindings): number => f.dupes.length + f.uncategorized.total + f.future.length + f.outliers.length + f.negative.length;

/** Какие виды находок есть (для строки в плашке): «дубли, без категории, дата в будущем». */
export function openKinds(f: OpenFindings): string[] {
  const kinds: string[] = [];
  if (f.dupes.length > 0) kinds.push('дубли');
  if (f.uncategorized.total > 0) kinds.push('без категории');
  if (f.future.length > 0) kinds.push('дата в будущем');
  if (f.outliers.length > 0) kinds.push('крупные траты');
  if (f.negative.length > 0) kinds.push('остаток в минусе');
  return kinds;
}
