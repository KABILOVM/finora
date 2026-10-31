import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { FilterBar } from '@/components/filters/FilterBar';
import type { FilterField } from '@/components/filters/filterState';
import { Skeleton } from '@/components/Skeleton';
import type { IsoDate, UUID } from '@/domain/types';
import { budgetLabel } from '@/features/budgets/budgetText';
import { useCategoryIndex } from '@/features/transactions/txData';
import { categoryFilterOptions, effectiveCategory, filterSpendRows } from './categoryFilter';
import { IncomeFlowCard } from './IncomeFlowCard';
import { PeriodCategories } from './PeriodCategories';
import { PeriodControls } from './PeriodControls';
import { PeriodHighlights } from './PeriodHighlights';
import { PeriodMonths } from './PeriodMonths';
import { PeriodSummaryCard } from './PeriodSummaryCard';
import { customProblem, effectiveCompare, parseSelection, resolvePeriod, type PeriodSelection } from './periodParams';
import { comparePhrase } from './periods';
import { Section } from './Section';
import { usePeriodReport } from './usePeriodReport';
import { WrappedSheet } from './WrappedSheet';
import { wrappedCards, wrappedFacts } from './wrapped';

function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Считаем…</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-56 !rounded-card" />
        <Skeleton className="h-44 !rounded-card" />
        <Skeleton className="h-44 !rounded-card" />
      </div>
    </div>
  );
}

export interface PeriodsViewProps {
  /** Адресная строка страницы: выбор периода лежит в ней (см. periodParams.ts). */
  params: URLSearchParams;
  today: IsoDate;
  onChange: (next: PeriodSelection) => void;
}

/**
 * Вкладка «Периоды» в «Аналитике»: год, квартал или любые даты — доходы и расходы, норма сбережений, куда ушли деньги, категории
 * против сравниваемого периода и разбивка по месяцам. Цифры считаются из операций (periods.ts), по тем же правилам, что остальная
 * «Аналитика». Выбор лежит в адресе: «Назад», обновление и ссылка его не сбрасывают.
 */
export function PeriodsView({ params, today, onChange }: PeriodsViewProps) {
  const key = params.toString();
  // выбор и период — по значению, а не по новому объекту на каждый кадр: от смены `period` зависит повторное чтение базы
  const selection = useMemo(() => parseSelection(new URLSearchParams(key), today), [key, today]);
  const period = useMemo(() => resolvePeriod(selection, today), [selection, today]);
  const mode = effectiveCompare(selection.kind, selection.cmp);
  const state = usePeriodReport(period, mode);
  const categories = useCategoryIndex();
  const [wrapped, setWrapped] = useState(false);
  // Фильтр по категории расходов: лежит в состоянии вкладки, а не в адресе — адрес здесь целиком занят выбором периода
  const [asked, setAsked] = useState<UUID | null>(null);
  const problem = selection.kind === 'custom' ? customProblem(selection.from, selection.to, today) : null;

  const controls = <PeriodControls selection={selection} onChange={onChange} today={today} dateError={problem} />;

  if (!period) {
    return (
      <>
        {controls}
        <p role="status" className="py-8 text-center text-muted">
          Выберите правильные даты — и здесь появится отчёт.
        </p>
      </>
    );
  }
  if (state === undefined || categories === undefined) {
    return (
      <>
        {controls}
        <Loading />
      </>
    );
  }
  if (state === null) {
    return (
      <>
        {controls}
        <p role="status" className="py-10 text-center text-muted">
          Настройки ещё не загружены
        </p>
      </>
    );
  }
  if ('overflow' in state) {
    return (
      <>
        {controls}
        <EmptyState icon="alert" title="Суммы слишком большие" text="Их не получилось сложить без потери точности. Проверьте данные." />
      </>
    );
  }

  const { base, report, rows } = state;
  const { current, compare } = report;
  const phrase = comparePhrase(report.period, mode);
  const nothing =
    current.incomeMinor === 0 && current.expenseMinor === 0 && current.excludedCount === 0 && (compare === null || (compare.summary.incomeMinor === 0 && compare.summary.expenseMinor === 0));
  if (nothing) {
    return (
      <>
        {controls}
        <EmptyState icon="chart" title="За этот период нет операций" text="Выберите другие даты или внесите операции — здесь появятся итоги, норма сбережений и категории." />
      </>
    );
  }
  // Фильтр сужает только список «Расходы по категориям»; итоги, доходы, «По месяцам» и «Итоги года» остаются по всем операциям.
  // Доли в списке считаются от всех расходов периода, поэтому подпись под заголовком это говорит.
  const known = new Set(categories.keys());
  const filterId = effectiveCategory(asked, known);
  const parentOf = new Map([...categories].map(([id, c]) => [id, c.parentId] as const));
  const filterOptions = categoryFilterOptions(report.expenseDeltas, categories, filterId);
  const filterFields: FilterField[] =
    filterOptions.length > 1
      ? [{ key: 'category', label: 'Категория', type: 'select', anyLabel: 'Все категории', options: filterOptions, hint: 'С подкатегориями.' }]
      : [];
  const expenseDeltas = filterSpendRows(report.expenseDeltas, filterId, parentOf);
  const filterName = filterId === null ? null : (categories.get(filterId)?.name ?? 'Категория удалена');
  const resetKey = `${report.period.from}:${report.period.to}:${mode}:${filterId ?? ''}`;
  // «Итоги года» карточками — только для года (идущего: «на сегодня»)
  const cards =
    report.period.kind === 'year'
      ? wrappedCards(report, wrappedFacts(rows, report.period, base), (id) => (id === null ? 'Без категории' : budgetLabel(id, categories).name), today)
      : [];
  return (
    <>
      {controls}
      <div className="stagger flex flex-col gap-4">
        <PeriodSummaryCard report={report} base={base} mode={mode} />
        {cards.length > 0 && (
          <Button variant="secondary" icon="stars" fullWidth onClick={() => setWrapped(true)} data-testid="open-wrapped">
            {report.period.partial ? `Итоги ${report.period.from.slice(0, 4)} года на сегодня` : `Итоги ${report.period.from.slice(0, 4)} года карточками`}
          </Button>
        )}
        <IncomeFlowCard summary={current} categories={categories} base={base} />
        {filterFields.length > 0 && (
          <FilterBar
            title="Фильтр по категории"
            fields={filterFields}
            values={{ category: filterId ?? '' }}
            onChange={(v) => setAsked(v['category'] === undefined || v['category'] === '' ? null : v['category'])}
          />
        )}
        <Section id="period-expenses" title="Расходы по категориям">
          {filterName !== null && (
            <p className="mb-2 text-sm text-muted" data-testid="period-filter-note">
              Только «{filterName}». Доли — от всех расходов периода.
            </p>
          )}
          {expenseDeltas.length === 0 ? (
            <p className="text-muted">{filterName !== null ? `По категории «${filterName}» расходов за этот период нет.` : 'Расходов за этот период нет.'}</p>
          ) : (
            <PeriodCategories key={resetKey} deltas={expenseDeltas} categories={categories} base={base} totalMinor={current.expenseMinor} kind="expense" phrase={phrase} />
          )}
        </Section>
        {report.incomeDeltas.length > 0 && (
          <Section id="period-incomes" title="Доходы по категориям">
            <PeriodCategories key={resetKey} deltas={report.incomeDeltas} categories={categories} base={base} totalMinor={current.incomeMinor} kind="income" phrase={phrase} />
          </Section>
        )}
        {current.months.length >= 2 && (
          <Section id="period-months" title="По месяцам">
            <PeriodMonths points={current.months} base={base} />
          </Section>
        )}
        {current.months.length >= 2 && <PeriodHighlights summary={current} categories={categories} base={base} />}
      </div>
      {wrapped && cards.length > 0 && (
        <WrappedSheet title={`Итоги ${report.period.from.slice(0, 4)} года`} cards={cards} base={base} onClose={() => setWrapped(false)} />
      )}
    </>
  );
}
