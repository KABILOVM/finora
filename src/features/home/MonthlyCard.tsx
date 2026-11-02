import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { useStore } from '@/db';
import type { Category, CurrencyCode, IsoDate, LocalRow } from '@/domain/types';
import { DeltaLine } from '@/features/analytics/PeriodDelta';
import { formatDayLabel, monthTitle } from '@/lib/dates';
import { useDismissedKeys } from '@/lib/dismissedKeys';
import { useMonthRecap } from './monthly';

/** Вид подсказок для «Скрыть» (на этом устройстве). */
export const MONTHLY_NAMESPACE = 'monthly';

export interface MonthlyCardProps {
  today: IsoDate;
  categories: ReadonlyMap<string, LocalRow<Category>>;
}

const nameOf = (id: string | null, categories: MonthlyCardProps['categories']): string => (id === null ? 'Без категории' : (categories.get(id)?.name ?? 'Без категории'));

/**
 * «Итоги месяца» на «Главной» в первые дни нового месяца: сколько потрачено в прошлом, как это против месяца до него, на что ушло
 * больше всего, самая крупная трата, сколько получено. «Подробнее» открывает «Аналитику» на этом месяце, «Скрыть» убирает карточку
 * этого месяца на этом устройстве. Нет расходов и доходов за месяц — нет карточки.
 */
export default function MonthlyCard({ today, categories }: MonthlyCardProps) {
  const store = useStore();
  const state = useMonthRecap(today);
  const { hidden, dismiss } = useDismissedKeys(MONTHLY_NAMESPACE, store.userId);
  const recap = state?.recap ?? null;
  if (!state || !recap) return null;
  const key = `month:${recap.month}`;
  if (hidden.has(key)) return null;
  const base: CurrencyCode = state.base;
  const detail = new URLSearchParams({ month: recap.month }).toString();
  return (
    <section aria-labelledby="home-monthly" data-testid="monthly-card" className="slide-down">
      <Card padding="none" className="p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Icon name="chart" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="home-monthly" className="text-base font-semibold">
              Итоги месяца
            </h2>
            <p className="text-sm text-muted">{monthTitle(recap.month)}</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">Потрачено</p>
        <p className="text-[clamp(1.5rem,7vw,2rem)] font-extrabold leading-tight tracking-tight" data-testid="monthly-expense">
          <MoneyText minor={recap.expenseMinor} currency={base} tone="none" />
        </p>
        <DeltaLine
          testId="monthly-delta"
          current={recap.expenseMinor}
          previous={recap.previousExpenseMinor}
          base={base}
          phrase="месяцем раньше"
          noun="расходов"
          goodWhen="down"
        />
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {recap.top && (
            <li data-testid="monthly-top">
              Больше всего ушло на <span className="font-semibold">{nameOf(recap.top.categoryId, categories)}</span>:{' '}
              <MoneyText minor={recap.top.totalMinor} currency={base} tone="none" className="font-semibold" /> ({Math.max(recap.top.sharePercent, 1)}% расходов)
            </li>
          )}
          {recap.biggest && (
            <li data-testid="monthly-biggest">
              Самая крупная трата: <span className="font-semibold">{recap.biggest.note !== '' ? recap.biggest.note : nameOf(recap.biggest.categoryId, categories)}</span> —{' '}
              <MoneyText minor={recap.biggest.amountMinor} currency={base} tone="expense" className="font-semibold" />, {formatDayLabel(recap.biggest.occurredOn, today).toLowerCase()}
            </li>
          )}
          {recap.expenseMinor > 0 && (
            <li data-testid="monthly-per-day">
              В среднем в день: <MoneyText minor={recap.perDayMinor} currency={base} tone="none" className="font-semibold" />
            </li>
          )}
          {recap.incomeMinor > 0 && (
            <li data-testid="monthly-income">
              Получено: <MoneyText minor={recap.incomeMinor} currency={base} tone="income" sign="always" className="font-semibold" />
            </li>
          )}
          {recap.incomeMinor > 0 && recap.expenseMinor > 0 && (
            <li data-testid="monthly-net">
              {recap.netMinor >= 0 ? 'Осталось' : 'Ушло больше, чем получено'}: <MoneyText minor={Math.abs(recap.netMinor)} currency={base} tone={recap.netMinor >= 0 ? 'income' : 'expense'} className="font-semibold" />
            </li>
          )}
        </ul>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Link to={`/analytics?${detail}`} className={`${buttonClasses('secondary', 'md')} min-w-[9rem] flex-1`}>
            Подробнее
          </Link>
          <Button variant="ghost" aria-label="Скрыть итоги месяца" className="min-w-[9rem] flex-1" onClick={() => dismiss(key)}>
            Скрыть
          </Button>
        </div>
      </Card>
    </section>
  );
}
