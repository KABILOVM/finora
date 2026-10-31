import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { Notice } from '@/components/Notice';
import { Button } from '@/components/Button';
import type { DailyForecastOk } from '@/domain/forecast';
import type { CategoryAdvice, DayPlan } from '@/domain/savingsPlan';
import type { Category, CurrencyCode, LocalRow, UUID } from '@/domain/types';
import { cn } from '@/lib/cn';
import { budgetLabel } from '../budgetText';
import { NO_HISTORY_TEXT, adviceLine, catchUpLine, horizonLabel, monthLeftLine, planStatusLine, withoutGoalLine } from './goalsText';

export interface GoalPlanCardProps {
  base: CurrencyCode;
  forecast: DailyForecastOk;
  day: DayPlan;
  /** Сколько ещё откладывать в этом месяце по всем целям. */
  leftThisMonthMinor: number;
  /** Сколько целей ещё копится: при нескольких дата-подсказка относится ко всем вместе. */
  activeGoals: number;
  categories: ReadonlyMap<UUID, LocalRow<Category>>;
  /** «Обязательные категории»: открыть выбор. */
  onEssential: () => void;
}

const TONE: Record<DayPlan['status'], string> = { ok: 'text-income', cut: 'text-text', tight: 'text-danger' };

/** Строка разбора по одной категории: название, совет и цветная метка (цвет не единственный признак — рядом слова). */
function AdviceRow({ c, base, categories }: { c: CategoryAdvice; base: CurrencyCode; categories: ReadonlyMap<UUID, LocalRow<Category>> }) {
  const label = budgetLabel(c.categoryId, categories);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-testid="goal-advice-row" data-advice={c.essential ? 'essential' : c.advice}>
      <Glyph value={label.icon} color={label.color ?? undefined} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{label.name}</p>
        <p
          className={cn(
            'text-sm',
            c.essential || c.advice === 'keep' ? 'text-muted' : c.advice === 'skip' ? 'font-semibold text-danger' : 'font-medium text-warning',
          )}
        >
          {adviceLine(c, base)}
        </p>
      </div>
    </li>
  );
}

/**
 * План накопления: сколько можно тратить в день с учётом целей и — по категориям — сколько можно, что сократить, а что лучше
 * не тратить, чтобы к сроку накопить. Основная цифра «Осталось на день» выше остаётся прежней: здесь отдельный расчёт «с целью».
 */
export function GoalPlanCard({ base, forecast, day, leftThisMonthMinor, activeGoals, categories, onEssential }: GoalPlanCardProps) {
  const until = horizonLabel(forecast.horizonEnd, forecast.monthEnd);
  // Общий лимит месяца тоже ограничивает «в день»: с целью — меньшее из двух чисел
  const budgetPerDay = forecast.budget?.perDayMinor;
  const withGoal = budgetPerDay === undefined ? day.perDayWithGoalMinor : Math.min(day.perDayWithGoalMinor, budgetPerDay);
  const without = forecast.effective.perDayMinor;
  const cuttable = day.categories.filter((c) => !c.essential);
  const kept = day.categories.filter((c) => c.essential);
  return (
    <Card aria-labelledby="goal-plan-title" data-testid="goal-plan" className="flex flex-col gap-3">
      <div>
        <h3 id="goal-plan-title" className="text-sm font-semibold text-muted">
          С учётом целей можно тратить
        </h3>
        <p className={cn('mt-1 text-[clamp(1.5rem,7vw,2rem)] font-bold leading-tight', day.status === 'tight' ? 'text-danger' : '')}>
          <MoneyText minor={withGoal} currency={base} tone="none" /> <span className="text-base font-semibold text-muted">в день</span>
        </p>
        <p className="mt-0.5 text-sm text-muted">{withoutGoalLine(without, base)}</p>
      </div>

      <p className="text-sm text-muted">{monthLeftLine(leftThisMonthMinor, base)}</p>

      <Notice tone={day.status === 'tight' ? 'danger' : day.status === 'ok' ? 'success' : 'info'} icon={day.status === 'ok' ? 'check' : 'info'} role="note" className={TONE[day.status]}>
        {planStatusLine(day, base, until)}
      </Notice>
      {day.catchUp !== null && (
        <p className="text-sm font-medium" data-testid="goal-catchup">
          {catchUpLine(day.catchUp, base, activeGoals > 1, forecast.today)}
        </p>
      )}

      {day.categories.length === 0 ? (
        <p className="text-sm text-muted">{NO_HISTORY_TEXT}</p>
      ) : (
        <>
          {cuttable.length > 0 && (
            <section aria-label="Что сократить">
              <h4 className="mb-1 px-1 text-sm font-semibold text-muted">По категориям {until}</h4>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border/70">
                {cuttable.map((c) => (
                  <AdviceRow key={c.categoryId} c={c} base={base} categories={categories} />
                ))}
              </ul>
            </section>
          )}
          {kept.length > 0 && (
            <section aria-label="Обязательные траты">
              <h4 className="mb-1 px-1 text-sm font-semibold text-muted">Обязательные — не трогаем</h4>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border/70">
                {kept.map((c) => (
                  <AdviceRow key={c.categoryId} c={c} base={base} categories={categories} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <Button variant="secondary" icon="settings" onClick={onEssential} className="self-start">
        Обязательные категории
      </Button>
      <p className="flex items-start gap-2 text-xs text-muted">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        <span>
          Расчёт приблизительный: привычные траты — среднее за прошлые месяцы, платежи по расписанию и долги уже учтены в прогнозе «Осталось на день».
        </span>
      </p>
    </Card>
  );
}
