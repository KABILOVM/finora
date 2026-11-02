import { Badge } from '@/components/Badge';
import { Glyph } from '@/components/Glyph';
import { MoneyText } from '@/components/MoneyText';
import type { PeriodAverage } from '@/domain/dailyAverage';
import type { CurrencyCode } from '@/domain/types';
import { BudgetBar } from '@/features/budgets/BudgetBar';
import type { DailyLine } from './dailyStats';
import { daysWord, PERIOD_LABEL, planLevel, STATUS_TONE, STATUS_WORD, unavailableText } from './dailyText';

export interface DailyLineViewProps {
  line: DailyLine;
  base: CurrencyCode;
  /** Нажатие на название: правка категории (там лимит). Нет — строка без кнопки. */
  onOpen?: () => void;
}

function PerDay({ avg, base }: { avg: PeriodAverage; base: CurrencyCode }) {
  return avg.perDayMinor === null ? <span className="text-muted">—</span> : <MoneyText minor={avg.perDayMinor} currency={base} tone="none" className="font-semibold" />;
}

/**
 * Одна строка «Трат в день»: название, лимит, сегодня «потрачено из», полоса месяца с запасом или перерасходом и средняя трата в день
 * за сегодня / 7 / 30 дней / месяц. Без лимита — средняя и подсказка поставить лимит.
 */
export function DailyLineView({ line, base, onOpen }: DailyLineViewProps) {
  const { plan } = line;
  const head = (
    <>
      <Glyph value={line.icon} color={line.color ?? undefined} size={44} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-semibold">{line.name}</span>
        <span className="block text-sm text-muted">
          {line.limitPerDayMinor === null ? (
            'Лимит не задан'
          ) : (
            <>
              Лимит <MoneyText minor={line.limitPerDayMinor} currency={base} tone="none" /> в день
            </>
          )}
        </span>
      </span>
      {plan?.kind === 'plan' && <Badge tone={STATUS_TONE[plan.status]}>{STATUS_WORD[plan.status]}</Badge>}
    </>
  );
  return (
    <div data-testid={`daily-line-${line.key}`}>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={`Изменить: ${line.name}`} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl text-left">
          {head}
        </button>
      ) : (
        <div className="flex items-center gap-3">{head}</div>
      )}

      {plan?.kind === 'plan' && <PlanPart line={line} plan={plan} base={base} />}
      {plan?.kind === 'unavailable' && <p className="mt-2 text-sm text-muted">{unavailableText(plan.reason)}</p>}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {(['today', 'week', 'last30', 'month'] as const).map((k) => (
          <div key={k}>
            <dt className="text-muted">{PERIOD_LABEL[k]}</dt>
            <dd data-testid={`daily-${line.key}-${k}`}>
              <PerDay avg={line[k]} base={base} />
              {line[k].perDayMinor !== null && <span className="text-muted"> в день</span>}
            </dd>
          </div>
        ))}
      </dl>

      {line.limitPerDayMinor === null && line.last30.perDayMinor !== null && onOpen && (
        <p className="mt-2 text-sm text-muted">
          За 30 дней в среднем <MoneyText minor={line.last30.perDayMinor} currency={base} tone="none" className="font-semibold" /> в день. Откройте категорию и поставьте лимит.
        </p>
      )}
    </div>
  );
}

function PlanPart({ line, plan, base }: { line: DailyLine; plan: Extract<NonNullable<DailyLine['plan']>, { kind: 'plan' }>; base: CurrencyCode }) {
  const { percent, level } = planLevel(plan);
  const month = line.month;
  const reserveOk = plan.reserveMinor >= 0;
  return (
    <div className="mt-3">
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">Сегодня</span>
        <span data-testid={`daily-${line.key}-today-fact`} className="font-semibold">
          <MoneyText minor={plan.todaySpentMinor} currency={base} tone={plan.todayLeftMinor < 0 ? 'expense' : 'none'} />
          <span className="font-normal text-muted"> из </span>
          <MoneyText minor={plan.limitPerDayMinor} currency={base} tone="none" />
        </span>
      </p>
      <BudgetBar percent={percent} level={level} label={`${line.name}: ${percent}% плана месяца`} className="mt-2" />
      <p className="mt-1.5 text-sm" data-testid={`daily-${line.key}-reserve`}>
        {reserveOk ? 'Запас' : 'Перерасход за месяц'}:{' '}
        <MoneyText minor={Math.abs(plan.reserveMinor)} currency={base} tone={reserveOk ? 'income' : 'expense'} className="font-semibold" />
        <span className="text-muted"> · {daysWord(plan.monthDays)} месяца</span>
      </p>
      {month.daysWithinLimit !== null && month.days >= 3 && (
        <p className="mt-0.5 text-sm text-muted" data-testid={`daily-${line.key}-within`}>
          В лимит уложились в {month.daysWithinLimit} из {month.days} {month.days % 10 === 1 && month.days % 100 !== 11 ? 'дня' : 'дней'}
          {month.medianDayMinor !== null && (
            <>
              {' '}
              · обычный день <MoneyText minor={month.medianDayMinor} currency={base} tone="none" />
            </>
          )}
        </p>
      )}
    </div>
  );
}

