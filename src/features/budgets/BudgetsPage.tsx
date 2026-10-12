import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { useCategories, useStore } from '@/db';
import type { BudgetProgress } from '@/domain/budgetProgress';
import { formatMinor } from '@/domain/money';
import type { Budget, LocalRow } from '@/domain/types';
import { MonthSwitcher } from '@/features/transactions/MonthSwitcher';
import { humanError } from '@/features/transactions/txActions';
import { monthKey } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { useToday } from '@/recurring/useToday';
import { BudgetRow } from './BudgetRow';
import { BudgetSheet } from './BudgetSheet';
import { budgetLabel, excludedText } from './budgetText';
import { ForecastCard } from './ForecastCard';
import { useBudgetsData } from './useBudgetsData';
import { useDailyForecast } from './useDailyForecast';

const CHIP: Record<'ok' | 'warn' | 'over', { label: string; dot: string }> = {
  ok: { label: 'В норме', dot: 'bg-brand' },
  warn: { label: 'Внимание', dot: 'bg-warning' },
  over: { label: 'Исчерпано', dot: 'bg-danger' },
};

/** Сводка по уровням: сколько лимитов в норме, сколько на грани и сколько исчерпано. Нули не показываем. */
function LevelChips({ items }: { items: readonly BudgetProgress[] }) {
  const n = { ok: 0, warn: 0, over: 0 };
  for (const p of items) {
    if (!p.comparable) continue;
    if (p.level === 'ok') n.ok++;
    else if (p.level === 'warn' || p.level === 'danger') n.warn++;
    else n.over++;
  }
  const shown = (['ok', 'warn', 'over'] as const).filter((k) => n[k] > 0);
  if (shown.length === 0) return null;
  return (
    <ul aria-label="Сводка по лимитам" className="mb-3 flex flex-wrap gap-2">
      {shown.map((k) => (
        <li key={k} className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface/75 px-3 py-1.5 text-sm font-semibold">
          <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-full', CHIP[k].dot)} />
          {CHIP[k].label}
          <span className="money tabular-nums text-muted">{n[k]}</span>
        </li>
      ))}
    </ul>
  );
}

type SheetState = { kind: 'new' } | { kind: 'edit'; budget: LocalRow<Budget> };

/**
 * Бюджеты: сверху «Осталось на день» (прогноз), ниже лимиты на месяц с полосами и предупреждениями 70/90/100%.
 * Лимиты не зависят от месяца, но смотреть траты можно за любой месяц.
 */
export default function BudgetsPage() {
  const store = useStore();
  const toast = useToast();
  const currentMonth = monthKey(useToday());
  // Выбранный вручную месяц; null — «текущий»: он сам переезжает на новый месяц, если экран простоял через полночь 1-го числа.
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? currentMonth;
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
    // Короткая подпись, как на «Кошельках» и «Категориях»: с длинной на узком экране (320px) заголовок «Бюджеты» обрезался до «Бюд…».
    // Для скринридера и поиска по имени кнопка по-прежнему «Добавить лимит».
    <Button icon="plus" aria-label="Добавить лимит" disabled={!ready} onClick={() => setSheet({ kind: 'new' })}>
      Добавить
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
        <MonthSwitcher month={month} max={currentMonth} onChange={(m) => setPicked(m === currentMonth ? null : m)} />
        <LevelChips items={progress.ok ? progress.items : []} />
        {active.length === 0 ? (
          <EmptyState
            icon="pie"
            title="Лимитов пока нет"
            text="Поставьте лимит на месяц: приложение покажет, сколько уже потрачено."
            className="py-6"
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
                    <BudgetRow progress={p} name={label.name} icon={label.icon} color={label.color} base={base} onOpen={() => setSheet({ kind: 'edit', budget: b })} />
                  </li>
                );
              })}
              {progress.hasCategoryBudgets && progress.unlimitedMinor > 0 && (
                <li className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <Glyph value="➖" size={44} />
                    <span className="min-w-0 flex-1 font-semibold">Без лимита</span>
                    <span className="money shrink-0 text-lg font-bold tabular-nums">{formatMinor(progress.unlimitedMinor, base)}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted">Расходы месяца вне лимитов по категориям, в том числе комиссии и «Без категории».</p>
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
                      <li key={b.id} className="flex items-center gap-3 py-2 pl-4 pr-2">
                        <Glyph value={label.icon} color={label.color ?? undefined} size={36} className="opacity-70" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{label.name}</p>
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
