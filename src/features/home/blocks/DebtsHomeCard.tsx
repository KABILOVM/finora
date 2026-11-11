import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import type { DebtDirection, IsoDate } from '@/domain/types';
import { isOwing, nearestDue, overdueCount, remainingByCurrency, type DebtItem } from '@/features/debts/debtSummary';
import { DIRECTION_LABEL, dueInfo } from '@/features/debts/debtText';
import { useDebtsData } from '@/features/debts/useDebtsData';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import { HomeMoney } from '../hideAmounts';
import { blockCardClass, BlockBusy, BlockEmpty, BlockTitle } from './BlockParts';

const TONE: Record<DebtDirection, string> = { lent: 'text-income', borrowed: 'text-expense' };

/** Одна сторона долгов: подпись и остаток по каждой валюте отдельно (разные валюты без курса не складываем). Ведёт на свою вкладку. */
function Side({ direction, items, base }: { direction: DebtDirection; items: readonly DebtItem[]; base: string | null }) {
  const totals = remainingByCurrency(
    items.filter((it) => it.debt.direction === direction),
    base ?? undefined,
  );
  return (
    <Link
      to={`/debts?dir=${direction}`}
      data-testid={`home-debts-${direction}`}
      className="press flex min-h-[56px] min-w-0 flex-1 flex-col justify-center rounded-2xl bg-surface-2/70 px-3 py-2 hover:bg-surface-2"
    >
      <span className="text-xs font-medium text-muted">{DIRECTION_LABEL[direction]}</span>
      {!totals.ok ? (
        <span className="text-sm text-muted">Суммы слишком большие</span>
      ) : totals.totals.length === 0 ? (
        <span className="text-[15px] font-bold leading-tight text-muted">—</span>
      ) : (
        totals.totals.map((t) => (
          <HomeMoney key={t.currency} minor={t.minor} currency={t.currency} tone="none" animated className={cn('block truncate text-[15px] font-bold leading-tight', TONE[direction])} />
        ))
      )}
    </Link>
  );
}

/**
 * Блок «Долги» на «Главной» (по умолчанию скрыт, включается в настройке главной): сколько ещё должны вам и сколько должны вы —
 * по открытым долгам, отдельно по каждой валюте, — и строка про просрочку или ближайший срок. Остатки считаются из операций, как
 * в разделе «Долги». Долгов нет — одна строка со ссылкой, как завести.
 */
export default function DebtsHomeCard({ today, half = false }: { today: IsoDate; half?: boolean }) {
  const data = useDebtsData();
  const open = data?.items.filter(isOwing) ?? [];
  const overdue = overdueCount(open, today);
  const next = nearestDue(open);
  const due = next ? dueInfo(next.debt.dueOn, today) : null;
  return (
    <Card aria-labelledby="home-debts" data-testid="debts-card" className={blockCardClass(half)}>
      <BlockTitle id="home-debts" to="/debts" icon="banknote" tone="bg-warning/10 text-warning" label="Долги: открыть раздел" half={half}>
        Долги
      </BlockTitle>
      {!data ? (
        <BlockBusy />
      ) : open.length === 0 ? (
        <BlockEmpty text="Открытых долгов нет." to="/debts" action="Записать долг" />
      ) : (
        <>
          <div className={cn('mt-1.5 flex gap-2', half && 'flex-col')}>
            <Side direction="lent" items={open} base={data.base} />
            <Side direction="borrowed" items={open} base={data.base} />
          </div>
          {overdue > 0 ? (
            <p data-testid="home-debts-note" className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-danger">
              <Icon name="alert" size={16} className="shrink-0" />
              <span className="min-w-0 truncate">
                {overdue} {pluralRu(overdue, 'долг просрочен', 'долга просрочено', 'долгов просрочено')}
              </span>
            </p>
          ) : (
            next &&
            due &&
            due.text !== '' && (
              <p data-testid="home-debts-note" className="mt-2 truncate text-sm text-muted">
                Ближайший срок: <span className="font-semibold text-text">{next.debt.counterparty}</span>, {due.text}
              </p>
            )
          )}
        </>
      )}
    </Card>
  );
}
