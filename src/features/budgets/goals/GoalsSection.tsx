import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { DailyForecast } from '@/domain/forecast';
import type { GoalPlanItem } from '@/domain/savingsPlan';
import type { CurrencyCode, LocalRow, SavingsGoal, Wallet } from '@/domain/types';
import { DebtBar } from '@/features/debts/DebtRow';
import { goalBarLabel, goalDueLine, goalPaceLine, goalRemainingLine, goalSavedLine } from '@/features/wallets/goalText';
import { humanError } from '@/features/transactions/txActions';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import { DeleteGoalDialog } from './DeleteGoalDialog';
import { EssentialSheet } from './EssentialSheet';
import { GoalPlanCard } from './GoalPlanCard';
import { GoalSheet } from './GoalSheet';
import { goalMonthLine } from './goalsText';
import { useGoalsPlan } from './useGoalsPlan';

type SheetState = { kind: 'new' } | { kind: 'edit'; goal: LocalRow<SavingsGoal> } | null;

interface GoalRowProps {
  goal: LocalRow<SavingsGoal>;
  item: GoalPlanItem | undefined;
  wallet: LocalRow<Wallet> | undefined;
  base: CurrencyCode;
  onOpen: () => void;
}

/** Строка цели: название, полоса «накоплено», срок словами, сколько отложить в этом месяце. Вся строка — кнопка «править». */
function GoalRow({ goal, item, wallet, base, onOpen }: GoalRowProps) {
  const progress = item?.progress ?? null;
  const due = progress ? goalDueLine(goal.dueOn, progress) : '';
  const remaining = progress ? goalRemainingLine(progress, goal.currency) : '';
  const pace = progress && item?.state === 'active' ? goalPaceLine(progress, goal.currency) : '';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Цель «${goal.name}»: править`}
        className="block min-h-[56px] w-full px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-border/60"
        data-testid="goal-row"
      >
        <span className="flex items-center gap-3">
          <Glyph value="🎯" size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{goal.name}</span>
            <span className="block truncate text-sm text-muted">
              {wallet ? `Копим в «${wallet.name}»` : goal.walletId === null ? 'Кошелёк не привязан' : 'Кошелёк в архиве'}
            </span>
          </span>
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </span>
        {progress ? (
          <>
            <DebtBar percent={progress.percent} label={goalBarLabel(goal.name, progress)} className="mt-2.5" />
            <span className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-sm">
              <span className={progress.reached ? 'font-semibold text-income' : 'text-text'}>{goalSavedLine(progress, goal.currency)}</span>
              {remaining && <span className="text-muted">{remaining}</span>}
            </span>
            {due && (
              <span className={cn('mt-0.5 block text-sm', progress.overdue ? 'font-semibold text-danger' : 'text-muted')}>
                {progress.overdue && <Icon name="alert" size={16} className="mr-1 inline align-[-3px]" />}
                {due}
              </span>
            )}
          </>
        ) : (
          <span className="mt-1.5 block text-sm text-muted">{formatMinor(goal.targetMinor, goal.currency)}</span>
        )}
        {item && <span className="mt-0.5 block text-sm text-muted">{goalMonthLine(item, base)}</span>}
        {pace && <span className="mt-0.5 block text-sm text-muted">{pace}</span>}
      </button>
    </li>
  );
}

export interface GoalsSectionProps {
  base: CurrencyCode;
  forecast: DailyForecast | null | undefined;
}

/**
 * «Цели накопления»: список целей (накоплено, срок, сколько отложить в этом месяце) и план «с учётом целей»: сколько можно тратить
 * в день и что сократить по категориям. Расчёт — domain/savingsPlan.ts; цель хранится в базе, накоплено считается из кошелька.
 */
export function GoalsSection({ base, forecast }: GoalsSectionProps) {
  const toast = useToast();
  const data = useGoalsPlan(base, forecast);
  const store = useStore();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [essential, setEssential] = useState(false);
  const [deleting, setDeleting] = useState<LocalRow<SavingsGoal> | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => new Map(data && data.plan.ok ? data.plan.items.map((i) => [i.id, i] as const) : []), [data]);
  const walletById = useMemo(() => new Map((data?.savingsWallets ?? []).map((w) => [w.id, w] as const)), [data]);
  const expenseCategories = useMemo(() => [...(data?.categories.values() ?? [])].filter((c) => c.kind === 'expense' && c.archivedAt === null && c.deletedAt === null), [data]);

  const restore = async (g: LocalRow<SavingsGoal>) => {
    if (busy) return;
    setBusy(true);
    try {
      await store.savingsGoals.restore(g.id);
      toast.success(`Цель «${g.name}» возвращена`);
    } catch (e) {
      console.error('Не удалось вернуть цель:', e);
      toast.error(humanError(e, 'Не удалось вернуть цель'));
    } finally {
      setBusy(false);
    }
  };

  const addButton = (
    <Button variant="secondary" icon="plus" aria-label="Добавить цель накопления" disabled={!data} onClick={() => setSheet({ kind: 'new' })}>
      Цель
    </Button>
  );

  let body;
  if (data === undefined) {
    body = (
      <div role="status" aria-busy="true">
        <span className="sr-only">Считаем…</span>
        <Card aria-hidden="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-3 w-full !rounded-pill" />
        </Card>
      </div>
    );
  } else if (data.goals.length === 0 && data.archived.length === 0) {
    body = (
      <Card className="flex flex-col items-center gap-3 py-6 text-center" data-testid="goals-empty">
        <Glyph value="🎯" size={48} />
        <p className="font-semibold">Поставьте цель накопления</p>
        <p className="max-w-sm text-sm text-muted">
          Сколько накопить и к какому числу — приложение посчитает, сколько откладывать, сколько можно тратить в день и на чём сэкономить.
        </p>
        <Button size="lg" icon="plus" onClick={() => setSheet({ kind: 'new' })}>
          Поставить цель
        </Button>
      </Card>
    );
  } else {
    const plan = data.plan;
    body = (
      <div className="flex flex-col gap-3">
        {data.goals.length > 0 && (
          <Card padding="none">
            <ul aria-label="Цели накопления" className="divide-y divide-border">
              {data.goals.map((g) => (
                <GoalRow
                  key={g.id}
                  goal={g}
                  item={items.get(g.id)}
                  wallet={g.walletId === null ? undefined : walletById.get(g.walletId)}
                  base={base}
                  onOpen={() => setSheet({ kind: 'edit', goal: g })}
                />
              ))}
            </ul>
          </Card>
        )}

        {!plan.ok && (
          <Notice tone="danger" icon="alert">
            Не удалось посчитать: суммы слишком большие, проверьте данные.
          </Notice>
        )}
        {plan.ok && plan.day !== null && data.forecast !== null && (
          <GoalPlanCard
            base={base}
            forecast={data.forecast}
            day={plan.day}
            leftThisMonthMinor={plan.leftThisMonthMinor}
            activeGoals={plan.items.filter((i) => i.state === 'active').length}
            categories={data.categories}
            onEssential={() => setEssential(true)}
          />
        )}
        {plan.ok && plan.day === null && data.goals.length > 0 && (
          <Notice tone={plan.leftThisMonthMinor === 0 ? 'success' : 'info'} icon={plan.leftThisMonthMinor === 0 ? 'check' : 'info'} role="note">
            {plan.leftThisMonthMinor === 0
              ? 'В этом месяце уже отложено сколько нужно по всем целям.'
              : `В этом месяце нужно отложить ещё ${formatMinor(plan.leftThisMonthMinor, base)}. «В день» с учётом целей появится, когда будет прогноз «Осталось на день» — нужны кошельки с деньгами.`}
          </Notice>
        )}

        {data.archived.length > 0 && (
          <section>
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-1 text-left font-semibold text-muted"
            >
              <span>
                Архив целей · {data.archived.length} {pluralRu(data.archived.length, 'цель', 'цели', 'целей')}
              </span>
              <Icon name="chevron" size={18} className={showArchived ? 'rotate-90' : ''} />
            </button>
            {showArchived && (
              <Card padding="none" className="mt-1">
                <ul className="divide-y divide-border">
                  {data.archived.map((g) => (
                    <li key={g.id} className="flex items-center gap-3 py-2 pl-4 pr-2">
                      <Glyph value="🎯" size={36} className="opacity-70" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{g.name}</p>
                        <p className="money text-sm text-muted">{formatMinor(g.targetMinor, g.currency)}</p>
                      </div>
                      <Button variant="secondary" aria-label={`Вернуть цель: ${g.name}`} disabled={busy} onClick={() => void restore(g)}>
                        Вернуть
                      </Button>
                      <Button variant="ghost" className="text-danger" aria-label={`Удалить цель: ${g.name}`} disabled={busy} onClick={() => setDeleting(g)}>
                        Удалить
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="goals-title" data-testid="goals-section">
      <SectionHeader id="goals-title" action={addButton}>
        Цели накопления
      </SectionHeader>
      {body}
      {sheet && data && (
        <GoalSheet
          key={sheet.kind === 'edit' ? sheet.goal.id : 'new'}
          goal={sheet.kind === 'edit' ? sheet.goal : null}
          base={base}
          savingsWallets={data.savingsWallets}
          goals={data.goals}
          onClose={() => setSheet(null)}
        />
      )}
      {deleting && <DeleteGoalDialog goal={deleting} onClose={() => setDeleting(null)} />}
      {essential && data && <EssentialSheet categories={expenseCategories} onClose={() => setEssential(false)} />}
    </section>
  );
}
