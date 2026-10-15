import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { DebtBar } from '@/features/debts/DebtRow';
import { goalBarLabel, goalDueLine, goalPaceLine, goalRemainingLine, goalSavedLine, nudgeLine } from '@/features/wallets/goalText';
import { useGoals, type GoalItem } from '@/features/wallets/useGoals';
import { cn } from '@/lib/cn';

/** Сколько целей показываем на «Главной»; остальные — на странице «Кошельки». */
export const GOALS_WIDGET_LIMIT = 3;

function GoalRow({ item }: { item: GoalItem }) {
  const { wallet, progress, nudge } = item;
  const cur = wallet.currency;
  const due = goalDueLine(wallet.goalOn ?? null, progress);
  const remaining = goalRemainingLine(progress, cur);
  const pace = goalPaceLine(progress, cur);
  return (
    <li className="py-2" data-testid="goals-widget-item">
      <div className="flex items-center gap-2">
        <Glyph value={wallet.icon} color={wallet.color} size={28} />
        <span className="min-w-0 flex-1 truncate font-semibold">{wallet.name}</span>
        <span className="shrink-0 text-sm font-semibold">{progress.percent}%</span>
      </div>
      <DebtBar percent={progress.percent} label={goalBarLabel(wallet.name, progress)} className="mt-1.5" />
      <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-sm">
        <span className={progress.reached ? 'font-semibold text-income' : undefined}>{goalSavedLine(progress, cur)}</span>
        {remaining && <span className="text-muted">{remaining}</span>}
      </p>
      {due && (
        <p className={cn('text-sm', progress.overdue ? 'font-semibold text-danger' : 'text-muted')}>
          {progress.overdue && <Icon name="alert" size={16} className="mr-1 inline align-[-3px]" />}
          {due}
        </p>
      )}
      {pace && <p className="text-sm text-muted">{pace}</p>}
      {nudge && (
        <p className="mt-1 flex items-start gap-2 text-sm font-medium" data-testid="goals-widget-nudge">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-warning" />
          <span className="min-w-0 break-words">{nudgeLine(nudge, cur)}</span>
        </p>
      )}
    </li>
  );
}

/**
 * Карточка «Цели» для «Главной»: до трёх целей накопления — полоса, «накоплено из», срок и «пора отложить». Цели разных валют не
 * складываем. Нет ни одной цели (или ещё считается) — ничего не рисуем.
 */
export default function GoalsWidget() {
  const goals = useGoals();
  if (goals === undefined || goals.length === 0) return null;
  const shown = goals.slice(0, GOALS_WIDGET_LIMIT);
  return (
    <Card aria-labelledby="goals-widget-title" data-testid="goals-widget" className="!py-3 md:!p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="goals-widget-title" className="text-base font-semibold text-muted">
          Цели
        </h2>
        <Link to="/wallets" className="inline-flex min-h-[44px] shrink-0 items-center text-base font-semibold text-brand">
          Все цели
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((g) => (
          <GoalRow key={g.wallet.id} item={g} />
        ))}
      </ul>
      {goals.length > shown.length && <p className="mt-1 text-sm text-muted">И ещё {goals.length - shown.length} на странице «Кошельки».</p>}
    </Card>
  );
}
