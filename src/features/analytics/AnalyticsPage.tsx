import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { pluralRu } from '@/lib/plural';
import { addMinor } from '@/domain/money';
import { filtersFromParams } from '@/features/transactions/txFilters';
import { useCategoryIndex } from '@/features/transactions/txData';
import { MonthSwitcher } from '@/features/transactions/MonthSwitcher';
import { monthKey, monthTitle, todayLocal } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';
import { CategoryCompare } from './CategoryCompare';
import { MonthlyBars } from './charts/MonthlyBars';
import { WeekdayBars } from './charts/WeekdayBars';
import { hasPaceContent, PaceCard } from './PaceCard';
import { TopExpensesList } from './TopExpensesList';
import { useAnalyticsData, type AnalyticsData } from './useAnalyticsData';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={id} className="!py-4 md:!p-5">
      <h2 id={id} className="mb-3 text-base font-semibold">
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** «На 12% больше, чем в прошлом месяце» — расходы месяца против прошлого; null — сравнивать не с чем. */
export function expenseTrend(current: number, previous: number): string | null {
  if (previous <= 0) return current > 0 ? 'В прошлом месяце расходов не было' : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return 'Столько же, сколько в прошлом месяце';
  return pct > 0 ? `На ${pct}% больше, чем в прошлом месяце` : `На ${-pct}% меньше, чем в прошлом месяце`;
}

function Summary({ data }: { data: AnalyticsData }) {
  const { current, previous, base } = data;
  const trend = expenseTrend(current.expenseMinor, previous.expenseMinor);
  let net: number | null = null;
  try {
    net = addMinor(current.incomeMinor, -current.expenseMinor);
  } catch {
    net = null;
  }
  const up = current.expenseMinor > previous.expenseMinor;
  return (
    <Card aria-label="Итоги месяца" data-testid="analytics-summary" className="!py-4 md:!p-5">
      <p className="text-sm text-muted">Расходы за {monthTitle(data.month).toLowerCase()}</p>
      <p className="mt-0.5 text-[clamp(1.75rem,8vw,2.25rem)] font-extrabold leading-tight tracking-tight">
        <MoneyText minor={current.expenseMinor} currency={base} tone="none" />
      </p>
      {trend !== null && (
        <p data-testid="analytics-trend" className={`mt-0.5 text-sm font-medium ${current.expenseMinor === previous.expenseMinor ? 'text-muted' : up ? 'text-expense' : 'text-income'}`}>
          {trend}
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-surface-2/70 px-3 py-2">
          <dt className="text-xs text-muted">Доходы</dt>
          <dd className="font-semibold">
            <MoneyText minor={current.incomeMinor} currency={base} tone="income" sign="always" />
          </dd>
        </div>
        <div className="rounded-2xl bg-surface-2/70 px-3 py-2">
          <dt className="text-xs text-muted">Разница</dt>
          <dd className="font-semibold">{net === null ? '—' : <MoneyText minor={net} currency={base} tone="auto" sign="always" />}</dd>
        </div>
      </dl>
      {current.excludedCount > 0 && (
        <p className="mt-3 text-sm font-medium text-warning">
          Не учтено {current.excludedCount} {pluralRu(current.excludedCount, 'операция', 'операции', 'операций')}: они внесены в другой основной
          валюте, чем сейчас ({base}).
        </p>
      )}
    </Card>
  );
}

/**
 * «Аналитика»: расходы выбранного месяца против прошлого, доходы и расходы по месяцам, категории с изменением, средний расход по
 * дням недели и самые крупные траты. Цифры считаются из операций (analytics.ts), по тем же правилам, что «Итоги месяца» на главной.
 */
export default function AnalyticsPage() {
  const today = useToday();
  const currentMonth = monthKey(today);
  const [params] = useSearchParams();
  const [month, setMonth] = useState(() => {
    const asked = filtersFromParams(params, todayLocal()).month;
    return asked !== undefined && asked <= monthKey(todayLocal()) ? asked : monthKey(todayLocal());
  });
  const data = useAnalyticsData(month, today);
  const categories = useCategoryIndex();

  const header = <PageHeader title="Аналитика" />;
  const switcher = <MonthSwitcher month={month} max={currentMonth} onChange={setMonth} className="mb-3" />;

  if (data === undefined || categories === undefined) {
    return (
      <>
        {header}
        {switcher}
        <p role="status" className="py-10 text-center text-muted">
          Считаем…
        </p>
      </>
    );
  }
  if (data === null) {
    return (
      <>
        {header}
        <p role="status" className="py-10 text-center text-muted">
          Настройки ещё не загружены
        </p>
      </>
    );
  }
  if ('overflow' in data) {
    return (
      <>
        {header}
        {switcher}
        <EmptyState icon="alert" title="Суммы слишком большие" text="Их не получилось сложить без потери точности. Проверьте данные." />
      </>
    );
  }

  const empty = data.series.every((p) => p.incomeMinor === 0 && p.expenseMinor === 0);
  return (
    <>
      {header}
      {switcher}
      {empty ? (
        <EmptyState icon="chart" title="Пока нечего анализировать" text="Внесите несколько расходов и доходов: здесь появятся сравнение месяцев, категории и дни недели." />
      ) : (
        <div className="stagger flex flex-col gap-4">
          <Summary data={data} />
          {hasPaceContent(data) && <PaceCard data={data} />}
          <Section id="analytics-months" title="Доходы и расходы по месяцам">
            <MonthlyBars points={data.series} base={data.base} />
          </Section>
          <Section id="analytics-categories" title="Категории: сравнение с прошлым месяцем">
            {data.deltas.length === 0 ? (
              <p className="text-muted">Расходов по категориям в этом и прошлом месяце нет.</p>
            ) : (
              <CategoryCompare deltas={data.deltas} categories={categories} base={data.base} month={month} />
            )}
          </Section>
          <Section id="analytics-weekdays" title="В какие дни недели вы тратите">
            <WeekdayBars points={data.weekday} base={data.base} />
          </Section>
          <Section id="analytics-top" title="Самые крупные расходы">
            {data.top.length === 0 ? (
              <p className="text-muted">Расходов в этом месяце пока нет.</p>
            ) : (
              <TopExpensesList items={data.top} categories={categories} base={data.base} today={today} />
            )}
          </Section>
        </div>
      )}
    </>
  );
}
