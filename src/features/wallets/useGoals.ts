import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useBalances, useStore, useWallets } from '@/db';
import { compareGoals, goalProgress, savingNudge, walletNetFlow, type GoalProgress, type SavingNudge } from '@/domain/goals';
import type { LocalRow, Wallet } from '@/domain/types';
import { monthKey } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';

export interface GoalItem {
  wallet: LocalRow<Wallet>;
  progress: GoalProgress;
  /** «Пора отложить»; null — напоминать не о чем. */
  nudge: SavingNudge | null;
}

/** Цель есть только у кошелька-накопления с заданной суммой. */
export function hasGoal(w: Wallet): w is Wallet & { goalMinor: number } {
  return w.kind === 'savings' && w.goalMinor != null;
}

/**
 * Цели накопления по живым (не архивным) кошелькам-накоплениям: прогресс считается из текущего остатка, подсказка «пора отложить» —
 * из операций этого месяца по кошельку. Порядок: недостигнутые (по сроку, затем по проценту), потом достигнутые.
 * undefined — ещё считается (или суммы не помещаются в расчёт: цифры тогда не показываем).
 */
export function useGoals(): GoalItem[] | undefined {
  const store = useStore();
  const wallets = useWallets();
  const balances = useBalances();
  const today = useToday();
  const month = monthKey(today);

  const monthTxs = useLiveQuery(
    () => store.db.transactions.where('occurredOn').between(`${month}-01`, `${month}-31`, true, true).toArray(),
    [store, month],
  );

  return useMemo(() => {
    if (!wallets || !balances || !monthTxs) return undefined;
    const items: GoalItem[] = [];
    for (const wallet of wallets) {
      if (!hasGoal(wallet)) continue;
      const progress = goalProgress({
        balanceMinor: balances.get(wallet.id) ?? 0,
        goalMinor: wallet.goalMinor,
        goalOn: wallet.goalOn ?? null,
        today,
      });
      let nudge: SavingNudge | null = null;
      try {
        nudge = savingNudge(progress, walletNetFlow(wallet.id, monthTxs, `${month}-01`, `${month}-31`), today);
      } catch (e) {
        if (!(e instanceof RangeError)) throw e; // суммы не помещаются в расчёт — подсказку просто не показываем
      }
      items.push({ wallet, progress, nudge });
    }
    return items.sort(
      (a, b) =>
        Number(a.progress.reached) - Number(b.progress.reached) ||
        compareGoals(
          { goalOn: a.wallet.goalOn ?? null, percent: a.progress.percent, id: a.wallet.id },
          { goalOn: b.wallet.goalOn ?? null, percent: b.progress.percent, id: b.wallet.id },
        ),
    );
  }, [wallets, balances, monthTxs, today, month]);
}
