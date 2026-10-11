import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { summarizeDay, summarizeMonth, uuidV5, useStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import {
  computeDailyForecast,
  endOfMonth,
  floorDiv,
  occurrenceKey,
  usualSpendWindow,
  type DailyForecast,
  type ForecastDebt,
  type ForecastInput,
} from '@/domain/forecast';
import { occurrencesBetween } from '@/domain/schedule';
import type { IsoDate, LocalRow, Transaction } from '@/domain/types';
import { todayLocal } from '@/lib/dates';
import { useRates } from '@/rates/hooks';

type ForecastData = Omit<ForecastInput, 'getRate'>;
type Loaded = { overflow: true } | { overflow: false; data: ForecastData };

/**
 * Читает из локальной базы всё, что нужно прогнозу, ОДНИМ чтением (иначе экран на миг показал бы цифры из разных моментов).
 * null — настройки ещё не созданы. После последнего обращения к базе идёт только ожидание crypto (v5-идентификаторы) —
 * вне транзакции Dexie это безопасно (так же сделано в useUpcoming).
 */
async function loadForecastData(store: Store, today: IsoDate): Promise<Loaded | null> {
  const settings = await store.settings.get();
  if (!settings) return null;
  const { db } = store;
  const [walletRows, txs, ruleRows, debtRows, budgetRows] = await Promise.all([
    db.wallets.toArray(),
    db.transactions.toArray(),
    db.recurring_rules.toArray(),
    db.debts.toArray(),
    db.budgets.toArray(),
  ]);
  const base = settings.baseCurrency;
  const wallets = walletRows.filter((w) => w.deletedAt === null);
  const rules = ruleRows.filter((r) => r.deletedAt === null && r.archivedAt === null);

  const byDebt = new Map<string, LocalRow<Transaction>[]>();
  const existingIds = new Set<string>();
  let firstOp: IsoDate | null = null;
  for (const t of txs) {
    if (t.recurringRuleId !== null && t.recurringRuleId !== undefined) existingIds.add(t.id); // проведённые и «пропущенные» (удалённые)
    if (t.deletedAt !== null) continue;
    if (firstOp === null || t.occurredOn < firstOp) firstOp = t.occurredOn;
    if (t.debtId !== null && t.debtId !== undefined) {
      const list = byDebt.get(t.debtId);
      if (list) list.push(t);
      else byDebt.set(t.debtId, [t]);
    }
  }

  let data: Omit<ForecastData, 'doneOccurrences'>;
  try {
    const balances = computeBalances(wallets, txs);
    const walletById = new Map(walletRows.map((w) => [w.id, w] as const));
    const debts: ForecastDebt[] = debtRows
      .filter((d) => d.deletedAt === null && d.direction === 'borrowed')
      .map((d) => ({
        id: d.id,
        direction: d.direction,
        currency: d.currency,
        dueOn: d.dueOn,
        remainingMinor: computeDebtState(d, byDebt.get(d.id) ?? [], walletById).remainingMinor,
        closedAt: d.closedAt,
        archivedAt: d.archivedAt,
      }));

    const month = summarizeMonth(txs, today.slice(0, 7), base);
    const spentToday = summarizeDay(
      txs.filter((t) => t.occurredOn === today),
      base,
    ).expenseMinor;
    const window = usualSpendWindow(firstOp, today);
    const usualPerDayMinor = window
      ? floorDiv(
          summarizeDay(
            txs.filter((t) => t.occurredOn >= window.from && t.occurredOn <= window.to),
            base,
          ).expenseMinor,
          window.days,
        )
      : null;
    const total = budgetRows.find((b) => b.deletedAt === null && b.archivedAt === null && b.categoryId === null);

    data = {
      today,
      base,
      wallets,
      balances,
      rules,
      debts,
      spentTodayMinor: spentToday,
      usualPerDayMinor,
      totalBudget: total
        ? { limitMinor: total.amountMinor, currency: total.currency, spentMonthMinor: month.expenseMinor, excludedCount: month.excludedCount }
        : null,
    };
  } catch (e) {
    if (e instanceof RangeError) return { overflow: true };
    throw e;
  }

  // Какие даты правил уже проведены или пропущены: id операции = v5(правило, дата).
  const monthEnd = endOfMonth(today);
  const doneOccurrences = new Set<string>();
  for (const r of rules) {
    if (r.kind !== 'expense' && r.kind !== 'income') continue;
    for (const date of occurrencesBetween(r, today, monthEnd)) {
      if (existingIds.has(await uuidV5(r.id, date))) doneOccurrences.add(occurrenceKey(r.id, date));
    }
  }
  return { overflow: false, data: { ...data, doneOccurrences } };
}

/**
 * Прогноз «сколько можно тратить в день» для экрана (формула — в domain/forecast.ts). Пересчитывается сам после любой записи
 * в базу и после обновления курсов. undefined — считается (ничего не показываем, а не нули); null — настроек ещё нет.
 */
export function useDailyForecast(): DailyForecast | null | undefined {
  const store = useStore();
  const { getRate } = useRates();
  const today = todayLocal();
  const loaded = useLiveQuery(() => loadForecastData(store, today), [store, today]);
  return useMemo(() => {
    if (loaded === undefined) return undefined;
    if (loaded === null) return null;
    if (loaded.overflow) return { status: 'overflow' } as const;
    return computeDailyForecast({ ...loaded.data, getRate: (from, to) => getRate(from, to)?.rate ?? null });
  }, [loaded, getRate]);
}
