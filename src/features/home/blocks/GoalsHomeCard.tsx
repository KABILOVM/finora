import { Card } from '@/components/Card';
import { useBalances, useSavingsGoals, useWallets } from '@/db';
import { goalProgress, type GoalProgress } from '@/domain/goals';
import type { CurrencyCode } from '@/domain/types';
import { hasGoal } from '@/features/wallets/useGoals';
import { useToday } from '@/recurring/useToday';
import { HomeMoney } from '../hideAmounts';
import { blockCardClass, BlockBusy, BlockEmpty, BlockTitle, MiniBar } from './BlockParts';

/** Сколько целей показываем: во всю ширину и в половину. */
export const GOALS_ROWS = 3;
export const GOALS_ROWS_HALF = 1;

interface GoalRow {
  key: string;
  name: string;
  currency: CurrencyCode;
  progress: GoalProgress;
}

/** Недостигнутые первыми, среди них — ближайший срок (без срока в конце), затем ближе к цели. */
const byUrgency = (a: GoalRow, b: GoalRow): number =>
  Number(a.progress.reached) - Number(b.progress.reached) ||
  (a.progress.daysLeft ?? Infinity) - (b.progress.daysLeft ?? Infinity) ||
  b.progress.percent - a.progress.percent ||
  (a.key < b.key ? -1 : 1);

/**
 * Блок «Цели накопления» на «Главной» (по умолчанию скрыт, включается в настройке главной): цели из «Бюджетов» и цели
 * кошельков-накоплений одной лентой — сколько накоплено и сколько это от цели. Накоплено — остаток привязанного кошелька (он
 * считается из операций); кошелёк, уже привязанный к цели из «Бюджетов», второй раз не показывается. Заголовок ведёт в «Бюджеты».
 */
export default function GoalsHomeCard({ half = false }: { half?: boolean }) {
  const goals = useSavingsGoals();
  const wallets = useWallets();
  const balances = useBalances();
  const today = useToday();

  const ready = goals !== undefined && wallets !== undefined && balances !== undefined;
  const rows: GoalRow[] = [];
  if (ready) {
    const linked = new Set(goals.map((g) => g.walletId));
    for (const g of goals) {
      const saved = g.walletId === null ? 0 : (balances.get(g.walletId) ?? 0);
      rows.push({ key: g.id, name: g.name, currency: g.currency, progress: goalProgress({ balanceMinor: saved, goalMinor: g.targetMinor, goalOn: g.dueOn, today }) });
    }
    for (const w of wallets) {
      if (!hasGoal(w) || linked.has(w.id)) continue;
      const progress = goalProgress({ balanceMinor: balances.get(w.id) ?? 0, goalMinor: w.goalMinor, goalOn: w.goalOn ?? null, today });
      rows.push({ key: w.id, name: w.name, currency: w.currency, progress });
    }
    rows.sort(byUrgency);
  }
  const limit = half ? GOALS_ROWS_HALF : GOALS_ROWS;
  const more = rows.length - limit;

  return (
    <Card aria-labelledby="home-goals" data-testid="goals-card" className={blockCardClass(half)}>
      <BlockTitle id="home-goals" to="/budgets" icon="invest" tone="bg-income/10 text-income" label="Цели накопления: открыть бюджеты" half={half}>
        {half ? 'Цели' : 'Цели накопления'}
      </BlockTitle>
      {!ready ? (
        <BlockBusy />
      ) : rows.length === 0 ? (
        <BlockEmpty text="Целей пока нет." to="/budgets" action="Поставить цель" />
      ) : (
        <>
          <ul className="mt-1.5 flex flex-col gap-2.5">
            {rows.slice(0, limit).map((r, i) => (
              <li key={r.key} style={{ '--i': i } as React.CSSProperties} className="pop-spring" data-testid="home-goal-row">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${r.progress.reached ? 'text-income' : r.progress.overdue ? 'text-danger' : 'text-text'}`}>{r.progress.percent}%</span>
                </div>
                <MiniBar percent={r.progress.percent} fill="bg-income" className="mt-1" />
                <p className="mt-1 truncate text-xs text-muted">
                  <HomeMoney minor={r.progress.balanceMinor} currency={r.currency} tone="none" className="font-semibold text-text" />
                  {' из '}
                  <HomeMoney minor={r.progress.goalMinor} currency={r.currency} tone="none" />
                  {r.progress.reached ? ' · цель достигнута' : r.progress.overdue ? ' · срок прошёл' : ''}
                </p>
              </li>
            ))}
          </ul>
          {more > 0 && <p className="mt-2 text-sm text-muted">Ещё целей: {more}</p>}
        </>
      )}
    </Card>
  );
}
