import { useMemo } from 'react';
import { useDebtsData } from '@/features/debts/useDebtsData';
import { budgetLabel } from '@/features/budgets/budgetText';
import { useBudgetsData } from '@/features/budgets/useBudgetsData';
import { useRecurringLookups } from '@/features/recurring/useRecurringData';
import { useGoals } from '@/features/wallets/useGoals';
import { useUpcoming } from '@/db';
import { monthKey } from '@/lib/dates';
import { viewRule } from '@/recurring/ruleView';
import { groupUpcoming } from '@/recurring/upcoming';
import { useToday } from '@/recurring/useToday';
import { buildAttention, type AttentionItem } from './attention';

/**
 * Данные для строки «Требует внимания»: долги, платежи, лимиты месяца и цели читаются теми же запросами, что и их страницы.
 * undefined — что-то ещё читается (строку не показываем: она появится плавно, когда данные придут).
 */
export function useAttention(): AttentionItem[] | undefined {
  const today = useToday();
  const debts = useDebtsData();
  const upcoming = useUpcoming(0, { today });
  const lookups = useRecurringLookups();
  const budgets = useBudgetsData(monthKey(today));
  const goals = useGoals();

  return useMemo(() => {
    if (!debts || !upcoming || !lookups || budgets === undefined || !goals) return undefined;
    const overduePayments = groupUpcoming(upcoming).overdue.map((i) => viewRule(i.rule, lookups.wallets, lookups.categories, lookups.base).title);
    const overBudgets: string[] = [];
    if (budgets && !('overflow' in budgets) && budgets.progress.ok) {
      for (const p of budgets.progress.items) {
        if (p.comparable && p.level === 'over') overBudgets.push(budgetLabel(p.categoryId, budgets.categories).name);
      }
    }
    const savingNudges = goals.filter((g) => g.nudge !== null).map((g) => g.wallet.name);
    return buildAttention({ today, debts: debts.items, overduePayments, overBudgets, savingNudges });
  }, [today, debts, upcoming, lookups, budgets, goals]);
}
