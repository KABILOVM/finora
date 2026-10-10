import { addMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor, Transaction, TxKind, UUID } from '@/domain/types';

/**
 * ЧИСТЫЕ функции над списками операций (без Dexie, без React). На них опираются хуки и экраны.
 * Удалённые операции (deletedAt) здесь всегда пропускаются.
 */

export type TxLike = Pick<
  Transaction,
  'id' | 'kind' | 'walletId' | 'toWalletId' | 'categoryId' | 'occurredOn' | 'note' | 'createdAt' | 'deletedAt'
>;

export interface TxFilter {
  /** Включительно, 'YYYY-MM-DD' */
  from?: IsoDate;
  /** Включительно, 'YYYY-MM-DD' */
  to?: IsoDate;
  /** Операции кошелька: и списания с него, и переводы НА него. */
  walletId?: UUID;
  /** UUID — только эта категория; null — только операции «без категории» (расходы/доходы); не задано — любые. */
  categoryId?: UUID | null;
  kind?: TxKind;
  /** Подстрока заметки без учёта регистра. */
  search?: string;
}

/** Новые сверху: дата операции ↓, затем время создания ↓, затем id ↓ (порядок полностью определён). */
export function compareTxNewestFirst(a: TxLike, b: TxLike): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

export function filterTransactions<T extends TxLike>(txs: readonly T[], filter: TxFilter = {}): T[] {
  const needle = filter.search?.trim().toLocaleLowerCase('ru') ?? '';
  const out = txs.filter((t) => {
    if (t.deletedAt !== null) return false;
    if (filter.from !== undefined && t.occurredOn < filter.from) return false;
    if (filter.to !== undefined && t.occurredOn > filter.to) return false;
    if (filter.kind !== undefined && t.kind !== filter.kind) return false;
    if (filter.walletId !== undefined && t.walletId !== filter.walletId && t.toWalletId !== filter.walletId) return false;
    if (filter.categoryId !== undefined) {
      // «Без категории» — только расходы и доходы: у перевода категории не бывает по определению, это не «пропущенная» категория
      if (filter.categoryId === null && t.kind === 'transfer') return false;
      if (t.categoryId !== filter.categoryId) return false;
    }
    if (needle !== '' && !t.note.toLocaleLowerCase('ru').includes(needle)) return false;
    return true;
  });
  return out.sort(compareTxNewestFirst);
}

export interface DayGroup<T extends TxLike = TxLike> {
  date: IsoDate;
  items: T[];
}

/** Группы по дню операции: дни от новых к старым, внутри дня — новые сверху. */
export function groupByDay<T extends TxLike>(txs: readonly T[]): DayGroup<T>[] {
  const byDay = new Map<IsoDate, T[]>();
  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    const list = byDay.get(t.occurredOn);
    if (list) list.push(t);
    else byDay.set(t.occurredOn, [t]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, items]) => ({ date, items: items.sort(compareTxNewestFirst) }));
}

export interface CategoryTotal {
  /** null — расходы «без категории» */
  categoryId: UUID | null;
  totalMinor: Minor;
}

export interface MonthSummary {
  /** Доходы месяца в базовой валюте (по снимкам baseAmountMinor). */
  incomeMinor: Minor;
  /** Расходы месяца в базовой валюте. */
  expenseMinor: Minor;
  /** Расходы по категориям, от большего к меньшему. */
  byCategory: CategoryTotal[];
  /** Сколько операций месяца не вошло в итоги: их снимок сделан в другой (прежней) базовой валюте. */
  excludedCount: number;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type SummaryTx = TxLike & Pick<Transaction, 'baseCurrency' | 'baseAmountMinor'>;

/**
 * Итоги месяца по СНИМКАМ суммы в базовой валюте (курс на момент внесения, задним числом не меняется).
 * Переводы и удалённые операции не считаются. Операции со снимком в иной базовой валюте не смешиваются
 * с остальными, а учитываются в excludedCount.
 */
export function summarizeMonth(
  txs: readonly SummaryTx[],
  month: string,
  baseCurrency: CurrencyCode,
): MonthSummary {
  if (!MONTH_RE.test(month)) throw new RangeError(`Месяц должен быть в виде ГГГГ-ММ, получено: ${String(month)}`);
  const prefix = `${month}-`;
  let incomeMinor = 0;
  let expenseMinor = 0;
  let excludedCount = 0;
  const byCat = new Map<UUID | null, Minor>();

  for (const t of txs) {
    if (t.deletedAt !== null || t.kind === 'transfer' || !t.occurredOn.startsWith(prefix)) continue;
    if (t.baseCurrency !== baseCurrency) {
      excludedCount++;
      continue;
    }
    if (t.kind === 'income') {
      incomeMinor = addMinor(incomeMinor, t.baseAmountMinor);
    } else {
      expenseMinor = addMinor(expenseMinor, t.baseAmountMinor);
      byCat.set(t.categoryId, addMinor(byCat.get(t.categoryId) ?? 0, t.baseAmountMinor));
    }
  }

  const byCategory = [...byCat.entries()]
    .map(([categoryId, totalMinor]) => ({ categoryId, totalMinor }))
    .sort((a, b) => {
      if (a.totalMinor !== b.totalMinor) return b.totalMinor - a.totalMinor;
      if (a.categoryId === b.categoryId) return 0;
      if (a.categoryId === null) return 1;
      if (b.categoryId === null) return -1;
      return a.categoryId < b.categoryId ? -1 : 1;
    });
  return { incomeMinor, expenseMinor, byCategory, excludedCount };
}
