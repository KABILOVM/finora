import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { useCategories, useStore } from '@/db';
import type { BudgetProgress } from '@/domain/budgetProgress';
import { formatMinor } from '@/domain/money';
import type { Budget, LocalRow } from '@/domain/types';
import { MonthSwitcher } from '@/features/transactions/MonthSwitcher';
import { humanError } from '@/features/transactions/txActions';
import { monthKey, todayLocal } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { BudgetRow } from './BudgetRow';
import { BudgetSheet } from './BudgetSheet';
import { budgetLabel, excludedText } from './budgetText';
import { ForecastCard } from './ForecastCard';
import { useBudgetsData } from './useBudgetsData';
import { useDailyForecast } from './useDailyForecast';

type SheetState = { kind: 'new' } | { kind: 'edit'; budget: LocalRow<Budget> };

/**
 * Бюджеты: сверху «Осталось на день» (прогноз), ниже лимиты на месяц с полосами и предупреждениями 70/90/100%.
 * Лимиты не зависят от месяца, но смотреть траты можно за любой месяц.
 */
export default function BudgetsPage() {
  const store = useStore();
  const toast = useToast();
  const currentMonth = monthKey(todayLocal());
  const [month, setMonth] = useState(currentMonth);
  const forecast = useDailyForecast();
  const data = useBudgetsData(month);
  const expenseCategories = useCategories('expense');
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  const progressById = useMemo(() => {
    const map = new Map<string, BudgetProgress>();
    if (data && !('overflow' in data) && data.progress.ok) for (const p of data.progress.items) map.set(p.id, p);
    return map;
  }, [data]);

  const restore = async (b: LocalRow<Budget>, name: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await store.budgets.restore(b.id);
      toast.success(`Лимит «${name}» возвращён`);
    } catch (e) {
      console.error('Не удалось вернуть лимит:', e);
      toast.error(humanError(e, 'Не удалось вернуть лимит'));
    } finally {
      setBusy(false);
    }
  };

  const ready = data !== undefined && data !== null && !('overflow' in data);
  const addButton = (
    <Button icon="plus" disabled={!ready} onClick={() => setSheet({ kind: 'new' })}>
      Добавить лимит
    </Button>
  );

  let content;
  if (data === undefined) {
    content = (
      <p role="status" className="py-10 text-center text-muted">
        Считаем…
      </p>
    );
  } else if (data === null) {
    content = <EmptyState icon="cloud" title="Данные ещё загружаются" text="Подождите немного: после первой загрузки здесь появятся лимиты." />;
  } else if ('overflow' in data || !data.progress.ok) {
    content = <EmptyState icon="alert" title="Не удалось посчитать" text="Суммы слишком большие, проверьте данные." />;
  } else {
    const { base, active, archived, categories, summary, progress } = data;
    content = (
      <>
        <MonthSwitcher month={month} max={currentMonth} onChange={setMonth} />
        {active.length === 0 ? (
          <EmptyState
            icon="pie"
            title="Лимитов пока нет"
            text="Поставьте лимит на месяц — на все расходы или на одну категорию. Приложение покажет, сколько уже потрачено, и предупредит заранее."
            action={
              <Button size="lg" icon="plus" onClick={() => setSheet({ kind: 'new' })}>
                Поставить первый лимит
              </Button>
            }
          />
        ) : (
          <Card padding="none" className="mt-1">
            <ul className="divide-y divide-border">
              {active.map((b) => {
                const p = progressById.get(b.id);
                if (!p) return null;
                const label = budgetLabel(b.categoryId, categories);
                return (
                  <li key={b.id}>
                    <BudgetRow progress={p} name={label.name} icon={label.icon} base={base} onOpen={() => setSheet({ kind: 'edit', budget: b })} />
                  </li>
                );
              })}
              {progress.hasCategoryBudgets && progress.unlimitedMinor > 0 && (
                <li className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">
                      <span aria-hidden="true">➖ </span>Без лимита
                    </span>
                    <span className="money text-sm text-muted">{formatMinor(progress.unlimitedMinor, base)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">Расходы месяца вне лимитов по категориям, в том числе комиссии и «Без категории».</p>
                </li>
              )}
            </ul>
          </Card>
        )}

        {summary.excludedCount > 0 && <p className="mt-3 text-sm font-medium text-warning">{excludedText(summary.excludedCount, base)}</p>}

        {archived.length > 0 && (
          <section className="mt-6">
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-1 text-left font-semibold text-muted"
            >
              <span>
                Архив · {archived.length} {pluralRu(archived.length, 'лимит', 'лимита', 'лимитов')}
              </span>
              <Icon name="chevron" size={18} className={showArchived ? 'rotate-90' : ''} />
            </button>
            {showArchived && (
              <Card padding="none" className="mt-1">
                <ul className="divide-y divide-border">
                  {archived.map((b) => {
                    const label = budgetLabel(b.categoryId, categories);
                    return (
                      <li key={b.id} className="flex items-center justify-between gap-2 py-1 pl-4 pr-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            <span aria-hidden="true">{label.icon} </span>
                            {label.name}
                          </p>
                          <p className="money text-sm text-muted">{formatMinor(b.amountMinor, b.currency)}</p>
                        </div>
                        <Button variant="secondary" aria-label={`Вернуть: ${label.name}`} disabled={busy} onClick={() => void restore(b, label.name)}>
                          Вернуть
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Бюджеты" actions={addButton} />
      <div className="flex flex-col gap-4">
        <ForecastCard forecast={forecast} />
        <section aria-labelledby="budgets-title">
          <h2 id="budgets-title" className="mb-2 text-lg font-bold">
            Лимиты на месяц
          </h2>
          {content}
        </section>
      </div>

      {sheet && ready && (
        <BudgetSheet
          key={sheet.kind === 'edit' ? sheet.budget.id : 'new'}
          budget={sheet.kind === 'edit' ? sheet.budget : null}
          base={data.base}
          budgets={[...data.active, ...data.archived]}
          categories={expenseCategories ?? []}
          names={data.categories}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
