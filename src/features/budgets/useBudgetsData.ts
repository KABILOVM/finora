import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { summarizeMonth, useStore, type MonthSummary } from '@/db';
import { computeBudgetProgress, type BudgetsResult } from '@/domain/budgetProgress';
import type { Budget, Category, CurrencyCode, LocalRow, UUID } from '@/domain/types';

export interface BudgetsData {
  /** Месяц, за который посчитано ('ГГГГ-ММ'). */
  month: string;
  base: CurrencyCode;
  /** Живые бюджеты не в архиве: общий лимит первым, затем по времени создания. */
  active: LocalRow<Budget>[];
  /** Живые бюджеты в архиве. */
  archived: LocalRow<Budget>[];
  /** ВСЕ категории (архивные и удалённые тоже): название и родитель нужны и у старых трат. */
  categories: ReadonlyMap<UUID, LocalRow<Category>>;
  summary: MonthSummary;
  /** Прогресс бюджетов не в архиве или признак переполнения сумм. */
  progress: BudgetsResult;
}

type Loaded = { overflow: true } | { overflow: false; value: Omit<BudgetsData, 'progress'> };

const byOrder = (a: LocalRow<Budget>, b: LocalRow<Budget>): number => {
  if ((a.categoryId === null) !== (b.categoryId === null)) return a.categoryId === null ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * Бюджеты и траты выбранного месяца ('ГГГГ-ММ') одним чтением из локальной базы.
 * undefined — считается; null — настроек ещё нет (основная валюта неизвестна); данные с overflow: true — суммы не помещаются.
 */
export function useBudgetsData(month: string): BudgetsData | { overflow: true } | null | undefined {
  const store = useStore();
  const loaded = useLiveQuery(async (): Promise<Loaded | null> => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const { db } = store;
    const [budgetRows, categoryRows, txs] = await Promise.all([
      db.budgets.toArray(),
      db.categories.toArray(),
      db.transactions.where('occurredOn').between(`${month}-01`, `${month}-31`, true, true).toArray(),
    ]);
    let summary: MonthSummary;
    try {
      summary = summarizeMonth(txs, month, settings.baseCurrency);
    } catch (e) {
      if (e instanceof RangeError) return { overflow: true };
      throw e;
    }
    const live = budgetRows.filter((b) => b.deletedAt === null).sort(byOrder);
    return {
      overflow: false,
      value: {
        month,
        base: settings.baseCurrency,
        active: live.filter((b) => b.archivedAt === null),
        archived: live.filter((b) => b.archivedAt !== null),
        categories: new Map(categoryRows.map((c) => [c.id, c] as const)),
        summary,
      },
    };
  }, [store, month]);

  return useMemo(() => {
    if (loaded === undefined || loaded === null) return loaded;
    if (loaded.overflow) return { overflow: true } as const;
    const { value } = loaded;
    const progress = computeBudgetProgress({
      budgets: value.active,
      byCategory: value.summary.byCategory,
      expenseMinor: value.summary.expenseMinor,
      parentOf: new Map([...value.categories].map(([id, c]) => [id, c.parentId] as const)),
      base: value.base,
    });
    return { ...value, progress };
  }, [loaded]);
}
