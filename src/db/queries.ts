import { isAdjustment } from '@/domain/adjustment';
import { addMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor, Transaction, TxKind, UUID } from '@/domain/types';

/**
 * ЧИСТЫЕ функции над списками операций (без Dexie, без React). На них опираются хуки и экраны.
 * Удалённые операции (deletedAt) здесь всегда пропускаются.
 *
 * ПРАВИЛА СВОДОК (одни для месяца и для дня):
 *  - расход/доход без долга — обычные «Доходы/Расходы» и бюджеты;
 *  - операция с debtId (выдача/получение долга и платежи по нему) — НЕ доход и НЕ расход, в категории и бюджеты не попадает,
 *    но меняет остаток кошелька; считается отдельным итогом debtFlow;
 *  - перевод между кошельками в доходы/расходы не входит; его КОМИССИЯ (baseAmountMinor перевода) — расход месяца и дня
 *    отдельной строкой «комиссии» (kind: 'fee').
 */

export type TxLike = Pick<
  Transaction,
  'id' | 'kind' | 'walletId' | 'toWalletId' | 'categoryId' | 'occurredOn' | 'note' | 'createdAt' | 'deletedAt'
> & {
  /** Нет поля (старые данные и тестовые заготовки) = нет долга. */
  debtId?: Transaction['debtId'] | undefined;
  /** Нет поля = не «Корректировка остатка» (см. domain/adjustment.ts). */
  fxSource?: Transaction['fxSource'] | undefined;
};

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
  /** Только операции этого долга (выдача и платежи). */
  debtId?: UUID;
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
    if (filter.debtId !== undefined && (t.debtId ?? null) !== filter.debtId) return false;
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
  /** null — расходы «без категории» (а при kind === 'fee' — комиссии переводов) */
  categoryId: UUID | null;
  totalMinor: Minor;
  /**
   * Только у строки комиссий переводов: 'fee' (categoryId у неё null — не путать с «Без категории»; показывать как «Комиссии»).
   * У обычных строк поля нет.
   */
  kind?: 'fee';
}

export interface MonthSummary {
  /** Доходы месяца в базовой валюте (по снимкам baseAmountMinor). Без операций по долгам. */
  incomeMinor: Minor;
  /** Расходы месяца в базовой валюте: обычные расходы + комиссии переводов. Без операций по долгам. */
  expenseMinor: Minor;
  /** Расходы по категориям, от большего к меньшему; комиссии переводов — отдельной строкой (kind: 'fee'). */
  byCategory: CategoryTotal[];
  /** Комиссии переводов за месяц (входят в expenseMinor). */
  feeMinor: Minor;
  /** Деньги, полученные по долгам (взяли в долг, вернули мне): доходные операции с debtId. */
  debtInMinor: Minor;
  /** Деньги, отданные по долгам (дали в долг, вернул я): расходные операции с debtId. */
  debtOutMinor: Minor;
  /** debtInMinor − debtOutMinor: как долги изменили деньги на руках. Не доход и не расход. */
  debtFlowMinor: Minor;
  /** «Корректировки остатка» (domain/adjustment.ts): доход минус расход. Меняют деньги на руках, но не доход и не расход. */
  adjustmentFlowMinor: Minor;
  /** Сколько операций месяца не вошло в итоги: их снимок сделан в другой (прежней) базовой валюте. */
  excludedCount: number;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type SummaryTx = TxLike & Pick<Transaction, 'baseCurrency' | 'baseAmountMinor'>;

/** Итоги набора операций (месяц или день) по СНИМКАМ суммы в базовой валюте. Общая основа summarizeMonth и summarizeDay. */
function summarize(txs: readonly SummaryTx[], baseCurrency: CurrencyCode): MonthSummary {
  let incomeMinor = 0;
  let expenseMinor = 0;
  let feeMinor = 0;
  let debtInMinor = 0;
  let debtOutMinor = 0;
  let adjustmentFlowMinor = 0;
  let excludedCount = 0;
  const byCat = new Map<UUID | null, Minor>();

  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    if (t.kind === 'transfer') {
      // у перевода baseAmountMinor — комиссия; 0 (нет комиссии, обмен валют, старые переводы) считать нечего
      if (t.baseAmountMinor === 0) continue;
      if (t.baseCurrency !== baseCurrency) {
        excludedCount++;
        continue;
      }
      feeMinor = addMinor(feeMinor, t.baseAmountMinor);
      expenseMinor = addMinor(expenseMinor, t.baseAmountMinor);
      continue;
    }
    if (t.baseCurrency !== baseCurrency) {
      excludedCount++;
      continue;
    }
    if (isAdjustment(t)) {
      adjustmentFlowMinor = addMinor(adjustmentFlowMinor, t.kind === 'income' ? t.baseAmountMinor : -t.baseAmountMinor);
      continue;
    }
    if (t.debtId != null) {
      if (t.kind === 'income') debtInMinor = addMinor(debtInMinor, t.baseAmountMinor);
      else debtOutMinor = addMinor(debtOutMinor, t.baseAmountMinor);
      continue;
    }
    if (t.kind === 'income') {
      incomeMinor = addMinor(incomeMinor, t.baseAmountMinor);
    } else {
      expenseMinor = addMinor(expenseMinor, t.baseAmountMinor);
      byCat.set(t.categoryId, addMinor(byCat.get(t.categoryId) ?? 0, t.baseAmountMinor));
    }
  }

  const rows: CategoryTotal[] = [...byCat.entries()].map(([categoryId, totalMinor]) => ({ categoryId, totalMinor }));
  if (feeMinor > 0) rows.push({ categoryId: null, totalMinor: feeMinor, kind: 'fee' });
  // порядок полностью определён: сумма ↓, затем обычные категории по id, «без категории», комиссии
  const rank = (c: CategoryTotal) => (c.kind === 'fee' ? 2 : c.categoryId === null ? 1 : 0);
  const byCategory = rows.sort((a, b) => {
    if (a.totalMinor !== b.totalMinor) return b.totalMinor - a.totalMinor;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.categoryId === b.categoryId) return 0;
    return (a.categoryId as string) < (b.categoryId as string) ? -1 : 1;
  });
  return {
    incomeMinor,
    expenseMinor,
    byCategory,
    feeMinor,
    debtInMinor,
    debtOutMinor,
    debtFlowMinor: debtInMinor - debtOutMinor,
    adjustmentFlowMinor,
    excludedCount,
  };
}

/**
 * Итоги месяца по СНИМКАМ суммы в базовой валюте (курс на момент внесения, задним числом не меняется).
 * Правила — в шапке файла: переводы и удалённые операции в доходы/расходы не входят (комиссия перевода — расход),
 * операции по долгам — отдельный итог. Операции со снимком в иной базовой валюте не смешиваются
 * с остальными, а учитываются в excludedCount.
 */
export function summarizeMonth(
  txs: readonly SummaryTx[],
  month: string,
  baseCurrency: CurrencyCode,
): MonthSummary {
  if (!MONTH_RE.test(month)) throw new RangeError(`Месяц должен быть в виде ГГГГ-ММ, получено: ${String(month)}`);
  const prefix = `${month}-`;
  return summarize(
    txs.filter((t) => t.occurredOn.startsWith(prefix)),
    baseCurrency,
  );
}

/**
 * Итог дня (или любого набора операций, например группы groupByDay) по тем же правилам, что и месяц.
 * netMinor = доходы − расходы (с комиссиями); операции по долгам в него не входят и показаны отдельно (debtFlowMinor).
 * Бросает RangeError, если суммы не помещаются в безопасное целое — экран должен показать прочерк, а не упасть.
 */
export function summarizeDay(txs: readonly SummaryTx[], baseCurrency: CurrencyCode): MonthSummary & { netMinor: Minor } {
  const s = summarize(txs, baseCurrency);
  return { ...s, netMinor: s.incomeMinor - s.expenseMinor };
}
