import { useMemo } from 'react';
import { goalNudge } from '@/domain/savingsPlan';
import { useCashCalendar } from '@/features/analytics/useCashCalendar';
import { useDebtsData } from '@/features/debts/useDebtsData';
import { budgetLabel } from '@/features/budgets/budgetText';
import { useGoalsPlan } from '@/features/budgets/goals/useGoalsPlan';
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
  // цели накопления из «Бюджетов»: для напоминания хватает самих целей, прогноз «в день» не нужен
  const goalsPlan = useGoalsPlan(lookups?.base ?? '', null);
  // те же настройки, с какими календарь открывается по умолчанию: цифра на «Главной» совпадает с календарём
  const calendar = useCashCalendar({ includeUsual: true, includeReceivables: false });

  return useMemo(() => {
    if (!debts || !upcoming || !lookups || budgets === undefined || !goals || !goalsPlan || calendar === undefined) return undefined;
    const cashShortfallOn = calendar !== null && calendar.status === 'ok' ? calendar.firstNegativeDate : null;
    const overduePayments = groupUpcoming(upcoming).overdue.map((i) => viewRule(i.rule, lookups.wallets, lookups.categories, lookups.base).title);
    const overBudgets: string[] = [];
    if (budgets && !('overflow' in budgets) && budgets.progress.ok) {
      for (const p of budgets.progress.items) {
        if (p.comparable && p.level === 'over') overBudgets.push(budgetLabel(p.categoryId, budgets.categories).name);
      }
    }
    const savingNudges = goals.filter((g) => g.nudge !== null).map((g) => g.wallet.name);
    const goalNudges: string[] = [];
    if (goalsPlan.plan.ok) {
      const items = new Map(goalsPlan.plan.items.map((i) => [i.id, i] as const));
      for (const g of goalsPlan.goals) {
        const item = items.get(g.id);
        if (item && goalNudge(item, g.walletId !== null, today)) goalNudges.push(g.name);
      }
    }
    return buildAttention({ today, debts: debts.items, overduePayments, cashShortfallOn, overBudgets, savingNudges, goalNudges });
  }, [today, debts, upcoming, lookups, budgets, goals, goalsPlan, calendar]);
}
