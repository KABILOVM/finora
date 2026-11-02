import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { MoneyText } from '@/components/MoneyText';
import { Notice } from '@/components/Notice';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import type { DailyStats } from './dailyStats';
import { DailyLineView } from './DailyLineView';
import { useDailyStats } from './useDailyStats';

export interface DailySectionProps {
  /** Правка категории (там флажок и лимит). Нет — строки без кнопки. */
  onEditCategory?: (categoryId: string) => void;
}

/** Пока нет ни одной ежедневной категории: что это и как включить. */
function Intro() {
  return (
    <Card data-testid="daily-intro">
      <p className="font-semibold">Следите за ежедневными тратами</p>
      <p className="mt-1 text-sm text-muted">
        Отметьте категории (еда, дорога, продукты) как «ежедневные» и поставьте лимит в день. Приложение покажет, сколько вы тратите в день в среднем, сколько запаса накопилось и
        где вышли за лимит. Крупные разовые покупки в среднее не попадают.
      </p>
      <Link to="/categories" className={`${buttonClasses('secondary', 'md')} mt-3`}>
        Выбрать категории
      </Link>
    </Card>
  );
}

function Everything({ stats }: { stats: DailyStats }) {
  const per = stats.everything.month.perDayMinor;
  if (per === null) return null;
  return (
    <p data-testid="daily-everything" className="mt-2 px-1 text-sm text-muted">
      Все расходы вместе, с крупными покупками и платежами: <MoneyText minor={per} currency={stats.base} tone="none" className="font-semibold" /> в день с начала месяца.
    </p>
  );
}

/**
 * «Траты в день» на экране «Бюджеты»: все ежедневные вместе (с общим лимитом, если он есть у каждой категории) и каждая ежедневная
 * категория отдельно. Лимит в день — «в среднем не больше»: экономия копится в пределах месяца, красным становится накопленный минус.
 */
export function DailySection({ onEditCategory }: DailySectionProps) {
  const state = useDailyStats();
  if (state === undefined) return <Skeleton className="h-40 w-full" />;
  if (state === null) return null;
  if (state.overflow) return <Notice tone="warning">Суммы слишком большие, проверьте данные: траты в день не посчитать.</Notice>;
  const { stats } = state;
  return (
    <section aria-labelledby="daily-title" data-testid="daily-section">
      <SectionHeader id="daily-title">Траты в день</SectionHeader>
      {!stats.hasDaily ? (
        <Intro />
      ) : (
        <>
          <Card>
            <DailyLineView line={stats.total} base={stats.base} />
            {stats.total.limitPerDayMinor === null && stats.headsWithoutLimit > 0 && (
              <p className="mt-3 text-sm text-muted" data-testid="daily-total-hint">
                Общий лимит появится, когда лимит будет у каждой ежедневной категории. Пока без лимита: {stats.headsWithoutLimit}.
              </p>
            )}
          </Card>
          <Card padding="none" className="mt-3">
            <ul className="divide-y divide-border">
              {stats.lines.map((l) => (
                <li key={l.key} className="px-4 py-3.5">
                  <DailyLineView line={l} base={stats.base} onOpen={onEditCategory && l.categoryId ? () => onEditCategory(l.categoryId!) : undefined} />
                </li>
              ))}
            </ul>
          </Card>
          <Everything stats={stats} />
        </>
      )}
    </section>
  );
}
