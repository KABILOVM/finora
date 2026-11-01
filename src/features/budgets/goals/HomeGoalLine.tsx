import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { DailyForecast } from '@/domain/forecast';
import { HomeMoney } from '@/features/home/hideAmounts';
import { cn } from '@/lib/cn';
import { useGoalsPlan } from './useGoalsPlan';

/**
 * Строка в виджете «Можно тратить в день» на «Главной»: «С учётом целей — X в день» и ссылка на план. Появляется, только когда есть
 * цели, на которые в этом месяце ещё нужно откладывать; иначе (целей нет, всё отложено, нет прогноза) — ничего не рисует.
 * Тревожный вид — когда цели не успеть без изменений («впритык»).
 */
export function HomeGoalLine({ forecast }: { forecast: DailyForecast }) {
  const ok = forecast.status === 'ok' ? forecast : null;
  const data = useGoalsPlan(ok?.base ?? '', ok);
  if (ok === null || !data || !data.plan.ok || data.plan.day === null) return null;
  const day = data.plan.day;
  // общий лимит месяца тоже ограничивает «в день»: с целью — меньшее из двух чисел (как в карточке плана)
  const withGoal = ok.budget ? Math.min(day.perDayWithGoalMinor, ok.budget.perDayMinor) : day.perDayWithGoalMinor;
  const tight = day.status === 'tight';
  return (
    <Link
      to="/budgets"
      data-testid="widget-goal-line"
      aria-label="План целей накопления"
      className={cn('press mt-1 flex min-h-[44px] items-center gap-2 text-sm font-semibold', tight ? 'text-danger' : 'text-text')}
    >
      <Icon name="target" size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {tight ? 'Цели не успеть без изменений' : 'С учётом целей'} — <HomeMoney minor={withGoal} currency={ok.base} tone="none" /> в день
      </span>
      <Icon name="chevron" size={16} className="shrink-0 text-muted" />
    </Link>
  );
}
