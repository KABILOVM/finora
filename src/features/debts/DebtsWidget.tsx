import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { DEBT_OVERFLOW_MESSAGE } from '@/db';
import type { DebtDirection } from '@/domain/types';
import { cn } from '@/lib/cn';
import { useToday } from '@/recurring/useToday';
import { groupDebts, isOwing, nearestDue, overdueCount, remainingByCurrency, type DebtItem } from './debtSummary';
import { dueInfo, DIRECTION_LABEL } from './debtText';
import { useDebtsData } from './useDebtsData';

function Sum({ items, direction, base }: { items: readonly DebtItem[]; direction: DebtDirection; base: string | null }) {
  const own = groupDebts(items, direction).active;
  const sums = remainingByCurrency(own, base ?? undefined);
  if (sums.ok && sums.totals.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3" data-testid={`debts-widget-${direction}`}>
      <dt className="text-muted">{DIRECTION_LABEL[direction]}</dt>
      <dd className="min-w-0 text-right text-lg font-bold">
        {sums.ok ? (
          sums.totals.map((t, i) => (
            <Fragment key={t.currency}>
              {i > 0 && ', '}
              <MoneyText minor={t.minor} currency={t.currency} tone="none" />
            </Fragment>
          ))
        ) : (
          <span className="text-sm font-medium text-danger">{DEBT_OVERFLOW_MESSAGE}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * Карточка «Долги» для «Главной»: сколько мне должны и сколько должен я (каждая валюта отдельно), ближайший срок, просрочка —
 * красным и словами. Нет открытых долгов с остатком — ничего не рисуем.
 */
export default function DebtsWidget() {
  const data = useDebtsData();
  const today = useToday();
  const items = useMemo(() => data?.items ?? [], [data]);
  const owing = items.filter(isOwing);
  if (data === undefined || owing.length === 0) return null;

  const late = overdueCount(items, today);
  const next = nearestDue(items);
  const info = next ? dueInfo(next.debt.dueOn, today, true) : null;
  return (
    <Card aria-labelledby="debts-widget-title" data-testid="debts-widget" className="!py-3 md:!p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="debts-widget-title" className="text-base font-semibold text-muted">
          Долги
        </h2>
        <Link to="/debts" className="inline-flex min-h-[44px] shrink-0 items-center text-base font-semibold text-brand">
          Все долги
        </Link>
      </div>
      <dl className="flex flex-col gap-1">
        <Sum items={items} direction="lent" base={data.base} />
        <Sum items={items} direction="borrowed" base={data.base} />
      </dl>
      {next && info && (
        <Link
          to={`/debts/${next.debt.id}`}
          data-testid="debts-widget-next"
          className={cn(
            'mt-2 flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2 text-sm',
            info.tone === 'overdue' ? 'bg-danger/10 font-semibold text-danger' : 'bg-surface-2 text-text',
          )}
        >
          {info.tone === 'overdue' && <Icon name="alert" size={18} className="shrink-0" />}
          <span className="min-w-0 break-words">
            {info.tone === 'overdue' ? (
              <>
                {info.text.charAt(0).toUpperCase() + info.text.slice(1)}: <span className="font-semibold">{next.debt.counterparty}</span>
              </>
            ) : (
              <>
                Ближайший срок: <span className="font-semibold">{next.debt.counterparty}</span> — {info.text}
              </>
            )}
          </span>
        </Link>
      )}
      {late > 1 && (
        <p className="mt-1 text-sm font-semibold text-danger">
          Всего просрочено: {late}
        </p>
      )}
    </Card>
  );
}
