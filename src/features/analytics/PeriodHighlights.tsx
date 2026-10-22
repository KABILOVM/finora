import { MoneyText } from '@/components/MoneyText';
import { percentOf } from '@/domain/budgetLevels';
import type { Category, CurrencyCode, LocalRow } from '@/domain/types';
import { monthTitle } from '@/lib/dates';
import { Section } from './Section';
import { highlights, type PeriodSummary } from './periods';

export interface PeriodHighlightsProps {
  summary: PeriodSummary;
  categories: ReadonlyMap<string, LocalRow<Category>>;
  base: CurrencyCode;
}

/** Главное за период: самый затратный и самый доходный месяц, главная статья расходов, средний расход в месяц. null — отмечать нечего. */
export function PeriodHighlights({ summary, categories, base }: PeriodHighlightsProps) {
  const h = highlights(summary);
  const top = h.topExpense;
  const topName = top === null ? '' : top.categoryId === null ? 'Без категории' : (categories.get(top.categoryId)?.name ?? 'Без категории');
  if (!h.peakExpenseMonth && !h.peakIncomeMonth && !top && h.avgMonthlyExpenseMinor === null) return null;
  return (
    <Section id="period-highlights" title="Главное за период">
      <ul className="flex flex-col gap-2 text-sm" data-testid="period-highlights">
        {h.peakExpenseMonth && (
          <li>
            Больше всего потрачено в месяце «{monthTitle(h.peakExpenseMonth.month).toLowerCase()}»:{' '}
            <MoneyText minor={h.peakExpenseMonth.expenseMinor} currency={base} tone="expense" className="font-semibold" />
          </li>
        )}
        {h.peakIncomeMonth && (
          <li>
            Больше всего получено в месяце «{monthTitle(h.peakIncomeMonth.month).toLowerCase()}»:{' '}
            <MoneyText minor={h.peakIncomeMonth.incomeMinor} currency={base} tone="income" className="font-semibold" />
          </li>
        )}
        {top && (
          <li>
            Главная статья расходов — {topName}: <MoneyText minor={top.totalMinor} currency={base} tone="none" className="font-semibold" /> (
            {Math.max(percentOf(top.totalMinor, summary.expenseMinor), 1)}% всех расходов)
          </li>
        )}
        {h.avgMonthlyExpenseMinor !== null && (
          <li>
            В среднем в месяц уходит <MoneyText minor={h.avgMonthlyExpenseMinor} currency={base} tone="none" className="font-semibold" />
          </li>
        )}
      </ul>
    </Section>
  );
}
