import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { pickWidgetBudgets } from '@/domain/budgetProgress';
import type { DailyForecast } from '@/domain/forecast';
import { formatMinor } from '@/domain/money';
import { endSentence } from '@/features/transactions/txDisplay';
import { monthKey, todayLocal } from '@/lib/dates';
import { BudgetRow } from './BudgetRow';
import { budgetLabel, daysText, longDate } from './budgetText';
import { PerDay, skippedText } from './ForecastCard';
import { useBudgetsData, type BudgetsData } from './useBudgetsData';
import { useDailyForecast } from './useDailyForecast';

function ForecastPart({ forecast }: { forecast: DailyForecast }) {
  if (forecast.status === 'overflow') return <p className="mt-2 text-muted">Суммы слишком большие, проверьте данные.</p>;
  if (forecast.status === 'only-savings') {
    return <p className="mt-2 text-muted">Все кошельки — накопления, а их мы не считаем: на траты денег нет.</p>;
  }
  if (forecast.status !== 'ok') return null;
  return (
    <>
      <p data-testid="widget-per-day" className="mt-0.5 text-[clamp(1.75rem,8.4vw,2.25rem)] font-bold leading-tight tracking-tight">
        <PerDay f={forecast} />
      </p>
      <p className="text-[13px] text-muted">
        До {longDate(forecast.horizonEnd)} — {daysText(forecast.daysLeft)}
        {forecast.incomeDate !== null && `, потом ждём доход ${longDate(forecast.incomeDate)}`}
      </p>
      {forecast.notEnough && (
        <p className="mt-1.5 flex items-start gap-2 text-sm font-semibold text-danger">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>Денег не хватает: нужно ещё {endSentence(formatMinor(forecast.shortfallMinor, forecast.base))}</span>
        </p>
      )}
      {forecast.skipped.length > 0 && (
        <p className="mt-1.5 text-sm font-medium text-warning">Не вошло в расчёт — нет курса: {endSentence(skippedText(forecast.skipped))}</p>
      )}
    </>
  );
}

function BudgetsPart({ data }: { data: BudgetsData }) {
  if (!data.progress.ok) return null;
  const rows = pickWidgetBudgets(data.progress.items);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-3 divide-y divide-border border-t border-border" aria-label="Лимиты на месяц">
      {rows.map((p) => {
        const label = budgetLabel(p.categoryId, data.categories);
        return (
          <li key={p.id}>
            <BudgetRow progress={p} name={label.name} icon={label.icon} base={data.base} compact />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Карточка для «Главной»: «Можно тратить в день» и бюджеты месяца с предупреждениями 70/90/100%.
 * Пока данные читаются — серый каркас, а не нули; нет кошельков — ничего не рисуем.
 */
export default function BudgetsWidget() {
  const forecast = useDailyForecast();
  const data = useBudgetsData(monthKey(todayLocal()));

  if (forecast === undefined || data === undefined) {
    return (
      <Card aria-busy="true" className="min-h-[7.5rem] !py-3 md:!p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-surface-2" aria-hidden="true" />
        <div className="mt-3 h-9 w-44 animate-pulse rounded bg-surface-2" aria-hidden="true" />
      </Card>
    );
  }
  if (forecast === null || data === null || forecast.status === 'no-wallets') return null;

  const budgetsData = 'overflow' in data ? null : data;
  const hasBudgets = budgetsData !== null && budgetsData.progress.ok && budgetsData.progress.items.length > 0;
  return (
    <Card aria-labelledby="budgets-widget-title" data-testid="budgets-widget" className="!py-3 md:!p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="budgets-widget-title" className="text-base font-semibold text-muted">
          Можно тратить в день
        </h2>
        <Link to="/budgets" className="inline-flex min-h-[44px] shrink-0 items-center text-base font-semibold text-brand">
          Все бюджеты
        </Link>
      </div>
      <ForecastPart forecast={forecast} />
      {budgetsData && <BudgetsPart data={budgetsData} />}
      {budgetsData && !hasBudgets && (
        <p className="mt-2 text-sm text-muted">
          Лимитов пока нет.{' '}
          <Link to="/budgets" className="font-semibold text-brand">
            Поставить лимит
          </Link>
        </p>
      )}
    </Card>
  );
}
