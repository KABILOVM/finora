import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { useStore } from '@/db';
import type { Category, CurrencyCode, IsoDate, LocalRow } from '@/domain/types';
import { DeltaLine } from '@/features/analytics/PeriodDelta';
import { formatDayLabel } from '@/lib/dates';
import { useDismissedKeys } from '@/lib/dismissedKeys';
import { useWeeklySummary, weekRangeText } from './weekly';

/** Вид подсказок для «Скрыть» (на этом устройстве). */
export const WEEKLY_NAMESPACE = 'weekly';

export interface WeeklyCardProps {
  today: IsoDate;
  categories: ReadonlyMap<string, LocalRow<Category>>;
}

const nameOf = (id: string | null, categories: WeeklyCardProps['categories']): string => (id === null ? 'Без категории' : (categories.get(id)?.name ?? 'Без категории'));

/**
 * «Итоги недели» на «Главной» в первые дни новой недели: сколько потрачено на прошлой, как это против недели до неё, на что ушло
 * больше всего и самая крупная трата. «Подробнее» открывает «Аналитику → Периоды» на этих же датах (сравнение — с неделей до неё),
 * «Скрыть» убирает карточку этой недели на этом устройстве. Нет расходов и доходов за неделю — нет карточки.
 */
export default function WeeklyCard({ today, categories }: WeeklyCardProps) {
  const store = useStore();
  const state = useWeeklySummary(today);
  const { hidden, dismiss } = useDismissedKeys(WEEKLY_NAMESPACE, store.userId);
  const summary = state?.summary ?? null;
  if (!state || !summary) return null;
  const key = `week:${summary.from}`;
  if (hidden.has(key)) return null;
  const base: CurrencyCode = state.base;
  const detail = new URLSearchParams({ tab: 'periods', kind: 'custom', from: summary.from, to: summary.to }).toString();
  return (
    <section aria-labelledby="home-weekly" data-testid="weekly-card" className="slide-down">
      <Card padding="none" className="p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Icon name="chart" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="home-weekly" className="text-base font-semibold">
              Итоги недели
            </h2>
            <p className="text-sm text-muted">{weekRangeText(summary.from, summary.to)}</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">Потрачено</p>
        <p className="text-[clamp(1.5rem,7vw,2rem)] font-extrabold leading-tight tracking-tight" data-testid="weekly-expense">
          <MoneyText minor={summary.expenseMinor} currency={base} tone="none" />
        </p>
        <DeltaLine
          testId="weekly-delta"
          current={summary.expenseMinor}
          previous={summary.previousExpenseMinor}
          base={base}
          phrase="неделей раньше"
          noun="расходов"
          goodWhen="down"
        />
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {summary.top && (
            <li data-testid="weekly-top">
              Больше всего ушло на <span className="font-semibold">{nameOf(summary.top.categoryId, categories)}</span>:{' '}
              <MoneyText minor={summary.top.totalMinor} currency={base} tone="none" className="font-semibold" /> ({Math.max(summary.top.sharePercent, 1)}% расходов)
            </li>
          )}
          {summary.biggest && (
            <li data-testid="weekly-biggest">
              Самая крупная трата: <span className="font-semibold">{summary.biggest.note !== '' ? summary.biggest.note : nameOf(summary.biggest.categoryId, categories)}</span> —{' '}
              <MoneyText minor={summary.biggest.amountMinor} currency={base} tone="expense" className="font-semibold" />, {formatDayLabel(summary.biggest.occurredOn, today).toLowerCase()}
            </li>
          )}
          {summary.incomeMinor > 0 && (
            <li data-testid="weekly-income">
              Получено: <MoneyText minor={summary.incomeMinor} currency={base} tone="income" sign="always" className="font-semibold" />
            </li>
          )}
        </ul>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Link to={`/analytics?${detail}`} className={`${buttonClasses('secondary', 'md')} min-w-[9rem] flex-1`}>
            Подробнее
          </Link>
          <Button variant="ghost" aria-label="Скрыть итоги недели" className="min-w-[9rem] flex-1" onClick={() => dismiss(key)}>
            Скрыть
          </Button>
        </div>
      </Card>
    </section>
  );
}
