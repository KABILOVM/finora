import { Icon } from '@/components/Icon';
import { DebtBar } from '@/features/debts/DebtRow';
import { cn } from '@/lib/cn';
import { goalBarLabel, goalDueLine, goalPaceLine, goalRemainingLine, goalSavedLine, nudgeLine } from './goalText';
import type { GoalItem } from './useGoals';

/**
 * Цель накопления под строкой кошелька: полоса, «накоплено из», «осталось», срок словами, сколько откладывать в месяц и,
 * во второй половине месяца, подсказка «пора отложить». Цвет не единственный признак: просрочка и подсказка идут текстом и значком.
 */
export function GoalLine({ item, className }: { item: GoalItem; className?: string }) {
  const { wallet, progress, nudge } = item;
  const cur = wallet.currency;
  const due = goalDueLine(wallet.goalOn ?? null, progress);
  const remaining = goalRemainingLine(progress, cur);
  const pace = goalPaceLine(progress, cur);
  return (
    <div className={cn('px-4 pb-3', className)} data-testid="wallet-goal">
      <DebtBar percent={progress.percent} label={goalBarLabel(wallet.name, progress)} />
      <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-sm">
        <span className={progress.reached ? 'font-semibold text-income' : 'text-text'}>{goalSavedLine(progress, cur)}</span>
        {remaining && <span className="text-muted">{remaining}</span>}
      </p>
      {due && (
        <p className={cn('mt-0.5 text-sm', progress.overdue ? 'font-semibold text-danger' : 'text-muted')}>
          {progress.overdue && <Icon name="alert" size={16} className="mr-1 inline align-[-3px]" />}
          {due}
        </p>
      )}
      {pace && <p className="mt-0.5 text-sm text-muted">{pace}</p>}
      {nudge && (
        <p role="note" className="mt-1.5 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium" data-testid="goal-nudge">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-warning" />
          <span className="min-w-0 break-words">{nudgeLine(nudge, cur)}</span>
        </p>
      )}
    </div>
  );
}
