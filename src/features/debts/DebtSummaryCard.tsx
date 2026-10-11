import type { ReactNode } from 'react';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import type { DebtState } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { Debt, IsoDate, LocalRow } from '@/domain/types';
import { cn } from '@/lib/cn';
import { formatDayLabel } from '@/lib/dates';
import { dueInfo, progressPercent, REMAINING_LABEL, repaidWord, ruDateShort } from './debtText';
import { DebtBar } from './DebtRow';

function Line({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('min-w-0 text-right', strong && 'font-semibold')}>{children}</dd>
    </div>
  );
}

export interface DebtSummaryCardProps {
  debt: LocalRow<Debt>;
  state: DebtState;
  today: IsoDate;
}

/** Главная карточка страницы долга: остаток крупно, оплачено, переплата, срок, дата, как двигались деньги, заметка. */
export function DebtSummaryCard({ debt, state, today }: DebtSummaryCardProps) {
  const closed = debt.closedAt !== null;
  const due = dueInfo(debt.dueOn, today, !closed && !state.settled);
  const percent = progressPercent(state.paidMinor, state.principalMinor);
  const word = repaidWord(debt.direction, percent);
  const cur = debt.currency;
  return (
    <Card aria-label="Остаток долга" data-testid="debt-summary">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted">{REMAINING_LABEL[debt.direction]}</p>
        {closed && <Badge tone="neutral">Закрыт</Badge>}
        {debt.archivedAt !== null && <Badge tone="neutral">В архиве</Badge>}
        {!closed && state.settled && <Badge tone="income">Погашен</Badge>}
      </div>
      <p className="mt-0.5" data-testid="debt-remaining">
        <MoneyText
          minor={state.remainingMinor}
          currency={cur}
          tone="none"
          className="text-[clamp(1.875rem,9vw,2.5rem)] font-bold leading-tight tracking-tight"
        />
      </p>
      <DebtBar percent={percent} label={`${debt.counterparty}: ${word}`} className="mt-3" />
      <p className="mt-1.5 text-sm font-medium">{word}</p>

      <dl className="mt-3 divide-y divide-border border-t border-border">
        <Line label="Сумма долга">
          <MoneyText minor={state.principalMinor} currency={cur} tone="none" />
        </Line>
        <Line label="Оплачено">
          <MoneyText minor={state.paidMinor} currency={cur} tone="none" />
        </Line>
        {state.overpaidMinor > 0 && (
          <Line label="Переплата" strong>
            <span className="text-warning">
              <MoneyText minor={state.overpaidMinor} currency={cur} tone="none" />
            </span>
          </Line>
        )}
        <Line label="Срок возврата">
          {debt.dueOn === null ? (
            'Без срока'
          ) : (
            <>
              <span className="money">{ruDateShort(debt.dueOn)}</span>
              {due.text !== '' && (
                <span
                  className={cn(
                    'block text-sm',
                    due.tone === 'overdue' ? 'font-semibold text-danger' : due.tone === 'soon' || due.tone === 'today' ? 'font-semibold text-warning' : 'text-muted',
                  )}
                >
                  {due.tone === 'overdue' && <Icon name="alert" size={14} className="mr-1 inline align-[-2px]" />}
                  {due.text.charAt(0).toUpperCase() + due.text.slice(1)}
                </span>
              )}
            </>
          )}
        </Line>
        <Line label="Дата долга">{formatDayLabel(debt.openedOn, today)}</Line>
        <Line label={debt.direction === 'lent' ? 'Выдано деньгами' : 'Получено деньгами'}>
          {state.issuedMinor > 0 ? (
            <span className="money">{formatMinor(state.issuedMinor, cur)}</span>
          ) : (
            <span className="text-muted">Деньги не двигались (долг «на бумаге»)</span>
          )}
        </Line>
        {debt.note.trim() !== '' && (
          <Line label="Заметка">
            <span className="whitespace-pre-wrap break-words text-left">{debt.note}</span>
          </Line>
        )}
      </dl>
    </Card>
  );
}
