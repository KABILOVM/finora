import { useSearchParams } from 'react-router-dom';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { FilterBar } from '@/components/filters/FilterBar';
import type { FilterField } from '@/components/filters/filterState';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { Segmented } from '@/components/Segmented';
import { Skeleton } from '@/components/Skeleton';
import { pluralRu } from '@/lib/plural';
import { addMinor } from '@/domain/money';
import { useCategoryIndex } from '@/features/transactions/txData';
import { MonthSwitcher } from '@/features/transactions/MonthSwitcher';
import { monthKey, monthTitle } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';
import { MIN_MONTH, MONTH_PARAM } from '@/features/transactions/txFilters';
import { AnomaliesCard } from './AnomaliesCard';
import { categoryFilterOptions } from './categoryFilter';
import { CashCalendarView } from './CashCalendarView';
import { CategoryCompare } from './CategoryCompare';
import { MonthlyBars } from './charts/MonthlyBars';
import { WeekdayBars } from './charts/WeekdayBars';
import { NetWorthCard } from './NetWorthCard';
import { hasPaceContent, PaceCard } from './PaceCard';
import { PeriodsView } from './PeriodsView';
import { selectionToParams } from './periodParams';
import { Section } from './Section';
import { TopExpensesList } from './TopExpensesList';
import { isCompareReady, MIN_COMPARE_DAYS, previousPhrase } from './analytics';
import { useAnalyticsData, type AnalyticsData } from './useAnalyticsData';
import { WhereMoneyGoes } from './WhereMoneyGoes';
import { useNetWorth } from './useNetWorth';

/**
 * «На 12% больше, чем в прошлом месяце» — расходы месяца против прошлого; null — сравнивать не с чем. throughDay — идущий месяц сравнивается
 * с тем же отрезком прошлого («за те же 15 дней прошлого месяца»), а не с целым месяцем.
 */
export function expenseTrend(current: number, previous: number, throughDay: number | null = null): string | null {
  const then = previousPhrase(throughDay);
  if (previous <= 0) return current > 0 ? (throughDay === null ? 'В прошлом месяце расходов не было' : `${capitalize(then)} расходов не было`) : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return `Столько же, сколько ${then}`;
  return pct > 0 ? `На ${pct}% больше, чем ${then}` : `На ${-pct}% меньше, чем ${then}`;
}

const capitalize = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

function Summary({ data }: { data: AnalyticsData }) {
  const { current, through, compare, base } = data;
  const ready = isCompareReady(data.compareDays);
  const trend = ready ? expenseTrend(through.expenseMinor, compare.expenseMinor, data.compareDays) : null;
  let net: number | null = null;
  try {
    net = addMinor(current.incomeMinor, -current.expenseMinor);
  } catch {
    net = null;
  }
  const up = through.expenseMinor > compare.expenseMinor;
  const planned = current.expenseMinor - through.expenseMinor;
  return (
    <Card aria-label="Итоги месяца" data-testid="analytics-summary" className="!py-4 md:!p-5">
      <p className="text-sm text-muted">Расходы за {monthTitle(data.month).toLowerCase()}</p>
      <p className="mt-0.5 text-[clamp(1.75rem,8vw,2.25rem)] font-extrabold leading-tight tracking-tight">
        <MoneyText minor={current.expenseMinor} currency={base} tone="none" />
      </p>
      {trend !== null && (
        <p data-testid="analytics-trend" className={`mt-0.5 text-sm font-medium ${through.expenseMinor === compare.expenseMinor ? 'text-muted' : up ? 'text-expense' : 'text-income'}`}>
          {trend}
        </p>
      )}
      {!ready && (
        <p data-testid="analytics-trend-early" className="mt-0.5 text-sm text-muted">
          Месяц только начался: сравнение с прошлым появится на {MIN_COMPARE_DAYS}-й день.
        </p>
      )}
      {planned > 0 && (
        <p data-testid="analytics-planned" className="mt-0.5 text-xs text-muted">
          Из них <MoneyText minor={planned} currency={base} tone="none" /> — операции с датой позже сегодняшней: в сравнение они не входят.
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

/** id категории в адресе: буквы, цифры, «-» и «_» (как у фильтров списка операций). */
const CATEGORY_PARAM = /^[0-9A-Za-z_-]{1,64}$/;

type Tab = 'overview' | 'calendar' | 'periods';
const TABS = [
  { value: 'overview', label: 'Обзор' },
  { value: 'calendar', label: 'Календарь' },
  { value: 'periods', label: 'Периоды' },
] as const;

/** Заглушка на время чтения: сводка и два блока ниже; для скринридера — «Считаем…». */
function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Считаем…</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-36 !rounded-card" />
        <Skeleton className="h-44 !rounded-card" />
        <Skeleton className="h-44 !rounded-card" />
      </div>
    </div>
  );
}

/**
 * «Аналитика». Вкладка «Обзор»: расходы выбранного месяца против прошлого (идущий месяц — против того же отрезка прошлого), категории
 * с долями и изменением, самые крупные траты, доходы и расходы по месяцам, средний расход по дням недели, деньги в кошельках по месяцам.
 * Цифры считаются из операций (analytics.ts), по тем же правилам, что «Итоги месяца» на главной. Вкладка «Календарь»: что будет с
 * деньгами в ближайшие 30 дней (CashCalendarView). Вкладка и месяц лежат в адресе (?tab=calendar&month=2026-08): «Назад», обновление
 * и ссылка их не сбрасывают. Вкладка «Периоды»: год, квартал или любые даты, норма сбережений, куда ушли деньги, сравнение (PeriodsView).
 */
export default function AnalyticsPage() {
  const today = useToday();
  const currentMonth = monthKey(today);
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'calendar' || tabParam === 'periods' ? tabParam : 'overview';
  const asked = params.get('month');
  const month = asked !== null && MONTH_PARAM.test(asked) && asked >= MIN_MONTH && asked <= currentMonth ? asked : currentMonth;
  // Фильтр по категории лежит в адресе (?cat=<id>) рядом с месяцем: «Назад» из списка операций и ссылка его не сбрасывают.
  const catAsked = params.get('cat');
  const catParam = catAsked !== null && CATEGORY_PARAM.test(catAsked) ? catAsked : null;
  // По умолчанию (обзор, идущий месяц) адрес чистый; запись истории заменяем: листание месяцев не засоряет «Назад».
  const setView = (next: { tab?: Tab; month?: string; cat?: string | null }) => {
    const t = next.tab ?? tab;
    const m = next.month ?? month;
    const c = next.cat === undefined ? catParam : next.cat;
    const q = new URLSearchParams();
    if (t !== 'overview') q.set('tab', t);
    if (m !== currentMonth) q.set('month', m);
    if (t === 'overview' && c !== null) q.set('cat', c);
    setParams(q, { replace: true });
  };
  const data = useAnalyticsData(month, today, catParam);
  const categories = useCategoryIndex();
  const netWorth = useNetWorth(today);

  const header = <PageHeader title="Аналитика" />;
  const tabs = <Segmented ariaLabel="Раздел аналитики" options={TABS} value={tab} onChange={(t) => setView({ tab: t })} compact className="mb-3" />;
  const switcher = <MonthSwitcher month={month} max={currentMonth} onChange={(m) => setView({ month: m })} className="mb-3" />;

  // «Периоды» тоже не зависят от месяца «Обзора»; их выбор (вид, год, даты) лежит в адресе рядом с tab=periods
  if (tab === 'periods') {
    return (
      <>
        {header}
        {tabs}
        <PeriodsView
          params={params}
          today={today}
          onChange={(sel) => {
            const q = new URLSearchParams({ tab: 'periods' });
            selectionToParams(sel, today).forEach((v, k) => q.set(k, v));
            setParams(q, { replace: true });
          }}
        />
      </>
    );
  }

  // Календарь не зависит от выбранного месяца и читает всё сам, поэтому не ждёт данных «Обзора»
  if (tab === 'calendar') {
    return (
      <>
        {header}
        {tabs}
        <CashCalendarView />
      </>
    );
  }

  if (data === undefined || categories === undefined) {
    return (
      <>
        {header}
        {tabs}
        {switcher}
        <Loading />
      </>
    );
  }
  if (data === null) {
    return (
      <>
        {header}
        {tabs}
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
        {tabs}
        {switcher}
        <EmptyState icon="alert" title="Суммы слишком большие" text="Их не получилось сложить без потери точности. Проверьте данные." />
      </>
    );
  }

  const empty = data.series.every((p) => p.incomeMinor === 0 && p.expenseMinor === 0);
  // Фильтр по категории сужает только два списка ниже; сводка, темп, графики и аномалии остаются по всем расходам
  const filterOptions = categoryFilterOptions([...data.current.byCategory, ...data.previous.byCategory], data.categories, data.categoryFilter);
  const filterFields: FilterField[] =
    filterOptions.length > 1
      ? [{ key: 'category', label: 'Категория', type: 'select', anyLabel: 'Все категории', options: filterOptions, hint: 'С подкатегориями.' }]
      : [];
  const filterName = data.categoryFilter === null ? null : (data.categories.get(data.categoryFilter)?.name ?? 'Категория удалена');
  const filterNote =
    filterName === null ? null : (
      <p className="mb-2 text-sm text-muted" data-testid="analytics-filter-note">
        Только «{filterName}». Доли — от всех расходов месяца.
      </p>
    );
  return (
    <>
      {header}
      {tabs}
      {switcher}
      {empty ? (
        <EmptyState icon="chart" title="Пока нечего анализировать" text="Внесите несколько расходов и доходов: здесь появятся сравнение месяцев, категории и дни недели." />
      ) : (
        <div className="stagger flex flex-col gap-4">
          <Summary data={data} />
          {hasPaceContent(data) && <PaceCard data={data} />}
          <AnomaliesCard anomalies={data.anomalies} categories={data.categories} base={data.base} month={month} today={today} />
          {filterFields.length > 0 && (
            <FilterBar
              title="Фильтр по категории"
              fields={filterFields}
              values={{ category: data.categoryFilter ?? '' }}
              onChange={(v) => setView({ cat: v['category'] === undefined || v['category'] === '' ? null : v['category'] })}
            />
          )}
          <Section id="analytics-categories" title="Категории: сравнение с прошлым месяцем">
            {filterNote}
            {data.deltas.length === 0 ? (
              <p className="text-muted">
                {filterName !== null
                  ? `По категории «${filterName}» расходов в этом и прошлом месяце нет.`
                  : data.compareDays === null
                    ? 'Расходов по категориям в этом и прошлом месяце нет.'
                    : 'В этом месяце расходов пока нет.'}
              </p>
            ) : (
              <CategoryCompare
                key={month}
                deltas={data.deltas}
                categories={categories}
                base={data.base}
                month={month}
                totalMinor={data.through.expenseMinor}
                compareDays={data.compareDays}
              />
            )}
          </Section>
          {data.where.wallet.length > 0 && (
            <Section id="analytics-where" title="Куда уходят деньги">
              <WhereMoneyGoes key={month} where={data.where} wallets={data.wallets} base={data.base} month={month} />
            </Section>
          )}
          <Section id="analytics-top" title="Самые крупные расходы">
            {filterNote}
            {data.top.length === 0 ? (
              <p className="text-muted">{filterName !== null ? `По категории «${filterName}» расходов в этом месяце нет.` : 'Расходов в этом месяце пока нет.'}</p>
            ) : (
              <TopExpensesList items={data.top} categories={categories} base={data.base} today={today} />
            )}
          </Section>
          <Section id="analytics-months" title="Доходы и расходы по месяцам">
            <MonthlyBars points={data.series} base={data.base} onSelect={(m) => setView({ month: m })} />
          </Section>
          <Section id="analytics-weekdays" title="В какие дни недели вы тратите">
            <WeekdayBars points={data.weekday} base={data.base} />
          </Section>
          {/* деньги в кошельках не зависят от выбранного месяца: отдельным блоком в конце, а не между помесячными */}
          {netWorth && !('overflow' in netWorth) && <NetWorthCard data={netWorth} />}
        </div>
      )}
    </>
  );
}
