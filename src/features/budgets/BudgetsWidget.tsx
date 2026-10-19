import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { Skeleton } from '@/components/Skeleton';
import { pickWidgetBudgets, type BudgetProgress } from '@/domain/budgetProgress';
import type { DailyForecast } from '@/domain/forecast';
import type { CurrencyCode } from '@/domain/types';
import { HomeMoney } from '@/features/home/hideAmounts';
import { cn } from '@/lib/cn';
import { monthKey } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';
import { BudgetBar, LEVEL_TEXT } from './BudgetBar';
import { budgetLabel, fitFontSize, longDate, spentWord } from './budgetText';
import { BUDGET_SCHEDULED_TEXT, perDayChars, spendBlocked } from './ForecastCard';
import { useBudgetsData, type BudgetsData } from './useBudgetsData';
import { useDailyForecast } from './useDailyForecast';

/** Сколько полосок лимитов на «Главной»: общий лимит и самый «горячий» по категории, либо два самых «горячих». */
export const WIDGET_BUDGET_ROWS = 2;

function ForecastPart({ forecast }: { forecast: DailyForecast }) {
  if (forecast.status === 'overflow') return <p className="mt-2 text-muted">Суммы слишком большие, проверьте данные.</p>;
  if (forecast.status === 'only-savings') {
    return <p className="mt-2 text-muted">Все кошельки — накопления, а их мы не считаем: на траты денег нет.</p>;
  }
  if (forecast.status !== 'ok') return null;
  const b = forecast.budget;
  // суммы в тревожных строках — тоже через HomeMoney: «Скрыть суммы» прячет их, как и крупное число
  const budgetAlarm =
    b === null ? null : b.overMinor > 0 ? (
      <>
        Лимит месяца превышен на <HomeMoney minor={b.overMinor} currency={forecast.base} tone="none" />
      </>
    ) : b.leftMinor === 0 ? (
      'Лимит месяца исчерпан'
    ) : forecast.effective.budgetState === 'scheduled' ? (
      BUDGET_SCHEDULED_TEXT
    ) : null;
  return (
    <>
      <p
        data-testid="widget-per-day"
        className="mt-0.5 font-bold leading-tight tracking-tight"
        style={{ fontSize: fitFontSize(perDayChars(forecast), '1.75rem', '8.4vw', '2.25rem') }}
      >
        {forecast.approximate && <span title="Приблизительно: часть денег пересчитана по курсу или не вошла в расчёт">≈ </span>}
        <HomeMoney minor={forecast.effective.perDayMinor} currency={forecast.base} tone={spendBlocked(forecast) ? 'expense' : 'none'} animated />
      </p>
      {forecast.notEnough && (
        <p className="mt-1.5 flex items-start gap-2 text-sm font-semibold text-danger">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>
            Денег не хватает: нужно ещё <HomeMoney minor={forecast.shortfallMinor} currency={forecast.base} tone="none" />
          </span>
        </p>
      )}
      {!forecast.notEnough && budgetAlarm !== null && (
        <p className="mt-1.5 flex items-start gap-2 text-sm font-semibold text-danger">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>{budgetAlarm}</span>
        </p>
      )}
      {!forecast.notEnough && budgetAlarm === null && forecast.effective.by === 'budget' && (
        <p className="text-sm text-muted">по лимиту месяца</p>
      )}
    </>
  );
}

/** Тонкая строка лимита: значок, название, процент и анимированная полоска. Нажатия нет — вся карточка ведёт в «Бюджеты». */
function MiniRow({ progress, name, icon, color, base, index }: { progress: BudgetProgress; name: string; icon: string; color: string | null; base: CurrencyCode; index: number }) {
  return (
    <li style={{ '--i': index } as React.CSSProperties} className="pop-spring py-1.5" data-testid="widget-budget-row">
      <div className="flex items-center gap-2">
        <Glyph value={icon} color={color ?? undefined} size={24} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
        {progress.comparable ? (
          <span className={cn('shrink-0 text-sm font-bold tabular-nums', LEVEL_TEXT[progress.level])}>{progress.percent > 999 ? '999%+' : `${progress.percent}%`}</span>
        ) : (
          <span className="shrink-0 text-xs font-medium text-warning">лимит в {progress.currency}</span>
        )}
      </div>
      {progress.comparable ? (
        <BudgetBar percent={progress.percent} level={progress.level} label={`${name}: ${spentWord(progress.percent)}`} className="mt-1.5 !h-2" />
      ) : (
        <p className="mt-1 text-xs font-medium text-warning">Основная валюта сейчас {base}. Укажите сумму заново.</p>
      )}
    </li>
  );
}

function BudgetsPart({ data }: { data: BudgetsData }) {
  if (!data.progress.ok) return null;
  const rows = pickWidgetBudgets(data.progress.items, WIDGET_BUDGET_ROWS);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-2" aria-label="Лимиты на месяц">
      {rows.map((p, i) => {
        const label = budgetLabel(p.categoryId, data.categories);
        return <MiniRow key={p.id} progress={p} name={label.name} icon={label.icon} color={label.color} base={data.base} index={i} />;
      })}
    </ul>
  );
}

/**
 * Карточка для «Главной»: «Можно тратить в день» крупной цифрой и до двух тонких полосок лимитов месяца. Пока данные читаются —
 * мерцающая заглушка той же высоты, а не нули; нет кошельков — ничего не рисуем. Заголовок ведёт в «Бюджеты».
 */
export default function BudgetsWidget() {
  const forecast = useDailyForecast();
  const data = useBudgetsData(monthKey(useToday()));

  if (forecast === undefined || data === undefined) {
    return (
      <Card aria-busy="true" className="min-h-[7.5rem] !py-3 md:!p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-9 w-44" />
        <Skeleton className="mt-4 h-2 w-full !rounded-pill" />
      </Card>
    );
  }
  if (forecast === null || data === null || forecast.status === 'no-wallets') return null;

  const budgetsData = 'overflow' in data ? null : data;
  const hasBudgets = budgetsData !== null && budgetsData.progress.ok && budgetsData.progress.items.length > 0;
  return (
    <Card aria-labelledby="budgets-widget-title" data-testid="budgets-widget" className="!py-3 md:!p-5">
      <Link to="/budgets" aria-label="Все бюджеты" className="press -my-1 flex min-h-[44px] items-center justify-between gap-3">
        <h2 id="budgets-widget-title" className="text-base font-semibold text-muted">
          Можно тратить в день
        </h2>
        <span className="flex shrink-0 items-center gap-1 text-sm text-muted">
          {forecast.status === 'ok' && <span>до {longDate(forecast.effective.horizonEnd)}</span>}
          <Icon name="chevron" size={16} />
        </span>
      </Link>
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
