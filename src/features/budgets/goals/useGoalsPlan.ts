import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useBalances, useSavingsGoals, useStore, useWallets } from '@/db';
import type { DailyForecast, DailyForecastOk } from '@/domain/forecast';
import { walletNetFlow } from '@/domain/goals';
import {
  computeSavingsPlan,
  usualSpendFromHistory,
  type PlanGoal,
  type SavingsPlanResult,
} from '@/domain/savingsPlan';
import type { Category, CurrencyCode, LocalRow, SavingsGoal, UUID, Wallet } from '@/domain/types';
import { monthKey } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';
import { useSpendingHistory } from '../useSpendingHistory';

export interface GoalsData {
  /** Живые цели не в архиве: ближайший срок первым. */
  goals: LocalRow<SavingsGoal>[];
  /** Цели в архиве. */
  archived: LocalRow<SavingsGoal>[];
  /** Кошельки-накопления, не в архиве: из них выбирают, какой считать накопленным. */
  savingsWallets: LocalRow<Wallet>[];
  /** ВСЕ категории (в том числе архивные: у старых трат категория могла уйти в архив). */
  categories: ReadonlyMap<UUID, LocalRow<Category>>;
  plan: SavingsPlanResult;
  /** Прогноз «Осталось на день», если он посчитан (иначе плана «в день» нет). */
  forecast: DailyForecastOk | null;
}

/** Категория обязательна сама или через родителя (подкатегории обязательной — тоже обязательные). Защита от петли в данных. */
export function isEssentialCategory(id: UUID, categories: ReadonlyMap<UUID, Pick<Category, 'essential' | 'parentId'>>): boolean {
  const seen = new Set<UUID>();
  let cur: UUID | null = id;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const c = categories.get(cur);
    if (!c) return false;
    if (c.essential === 1) return true;
    cur = c.parentId;
  }
  return false;
}

const byDue = (a: LocalRow<SavingsGoal>, b: LocalRow<SavingsGoal>): number =>
  a.dueOn !== b.dueOn ? (a.dueOn < b.dueOn ? -1 : 1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1;

/**
 * Цели накопления и их план на сегодня (расчёт — domain/savingsPlan.ts): накоплено берётся из остатка привязанного кошелька,
 * «отложено в этом месяце» — из операций этого месяца по нему, привычные траты — из прошлых месяцев, «в день» — из прогноза.
 * undefined — ещё читается.
 */
export function useGoalsPlan(base: CurrencyCode, forecast: DailyForecast | null | undefined): GoalsData | undefined {
  const store = useStore();
  const today = useToday();
  const month = monthKey(today);
  const allGoals = useSavingsGoals({ includeArchived: true });
  const wallets = useWallets();
  const balances = useBalances();
  const history = useSpendingHistory();
  const monthTxs = useLiveQuery(
    () => store.db.transactions.where('occurredOn').between(`${month}-01`, `${month}-31`, true, true).toArray(),
    [store, month],
  );
  const categoryRows = useLiveQuery(() => store.db.categories.toArray(), [store]);

  return useMemo(() => {
    if (!allGoals || !wallets || !balances || !monthTxs || !categoryRows || history === undefined) return undefined;
    const categories = new Map(categoryRows.map((c) => [c.id, c] as const));
    const goals = allGoals.filter((g) => g.archivedAt === null).sort(byDue);
    const archived = allGoals.filter((g) => g.archivedAt !== null).sort(byDue);
    const savingsWallets = wallets.filter((w) => w.kind === 'savings');
    const okForecast = forecast && forecast.status === 'ok' ? forecast : null;

    let plan: SavingsPlanResult;
    try {
      const planGoals: PlanGoal[] = goals.map((g) => ({
        id: g.id,
        targetMinor: g.targetMinor,
        currency: g.currency,
        dueOn: g.dueOn,
        savedMinor: g.walletId === null ? 0 : (balances.get(g.walletId) ?? 0),
        savedThisMonthMinor: g.walletId === null ? 0 : walletNetFlow(g.walletId, monthTxs, `${month}-01`, `${month}-31`),
      }));
      const usual = history ? usualSpendFromHistory(history, (id) => isEssentialCategory(id, categories)) : null;
      plan = computeSavingsPlan({
        today,
        base,
        goals: planGoals,
        forecast: okForecast
          ? { perDayMinor: okForecast.perDayMinor, daysLeft: okForecast.daysLeft, obligationsMinor: okForecast.obligationsMinor }
          : null,
        usual,
      });
    } catch (e) {
      if (!(e instanceof RangeError)) throw e; // суммы не помещаются в расчёт — экран скажет об этом, а не упадёт
      plan = { ok: false, error: 'overflow' };
    }
    return { goals, archived, savingsWallets, categories, plan, forecast: okForecast };
  }, [allGoals, wallets, balances, monthTxs, categoryRows, history, forecast, today, month, base]);
}
