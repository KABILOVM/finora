import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { DEBT_OVERFLOW_MESSAGE } from '@/db';
import { formatMinor } from '@/domain/money';
import type { IsoDate } from '@/domain/types';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import type { DebtItem } from './debtSummary';
import { dueInfo, dueLine, progressPercent, repaidWord } from './debtText';

export interface DebtBarProps {
  percent: number;
  /** Подпись для скринридера: чей это долг и сколько погашено. */
  label: string;
  className?: string;
}

/** Полоса «сколько уже погашено»: доступная (role="progressbar"), заполнение не выходит за 100%. Рядом всегда слова, цвет не единственный признак. */
export function DebtBar({ percent, label, className }: DebtBarProps) {
  const shown = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      aria-valuetext={`${shown}%`}
      className={cn('h-2.5 overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div className="h-full rounded-full bg-brand" style={{ width: `${shown > 0 ? Math.max(shown, 2) : 0}%` }} />
    </div>
  );
}

export interface DebtRowProps {
  item: DebtItem;
  today: IsoDate;
}

const TONE_CLASS = { none: 'text-muted', ok: 'text-muted', soon: 'font-semibold text-warning', today: 'font-semibold text-warning', overdue: 'font-semibold text-danger' } as const;

/** Строка долга в списке: имя, остаток, полоса погашения, срок словами (просрочка — красным и текстом). Вся строка — ссылка на страницу долга. */
export function DebtRow({ item, today }: DebtRowProps) {
  const { debt, state } = item;
  const base = 'block min-h-[56px] px-4 py-3 transition-colors hover:bg-surface-2 active:bg-border/60';

  if (state === null) {
    return (
      <Link to={`/debts/${debt.id}`} className={base}>
        <span className="block truncate font-semibold">{debt.counterparty}</span>
        <span role="alert" className="mt-1 block text-sm font-medium text-danger">
          {DEBT_OVERFLOW_MESSAGE}
        </span>
      </Link>
    );
  }

  const closed = debt.closedAt !== null;
  const active = !closed && !state.settled;
  const due = dueInfo(debt.dueOn, today, active);
  const percent = progressPercent(state.paidMinor, state.totalMinor);
  const word = repaidWord(debt.direction, percent);
  return (
    <Link to={`/debts/${debt.id}`} className={cn(base, closed && 'opacity-80')}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="line-clamp-2 min-w-0 break-words font-semibold">{debt.counterparty}</span>
        <span className="shrink-0 text-right">
          <span className="sr-only">Остаток: </span>
          <MoneyText minor={state.remainingMinor} currency={debt.currency} tone="none" className="font-semibold" />
        </span>
      </span>
      <DebtBar percent={percent} label={`${debt.counterparty}: ${word}`} className="mt-2" />
      <span className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className={cn('min-w-0', TONE_CLASS[due.tone])}>
          <span>
            {due.tone === 'overdue' && <Icon name="alert" size={16} className="mr-1 inline align-[-3px]" />}
            {dueLine(debt.dueOn, due)}
          </span>
          {item.parts && (
            <Badge tone="neutral" className="ml-2">
              {item.parts.length} {pluralRu(item.parts.length, 'долг', 'долга', 'долгов')}
            </Badge>
          )}
          {closed && <Badge tone="neutral" className="ml-2">Закрыт</Badge>}
          {!closed && state.settled && <Badge tone="income" className="ml-2">Погашен</Badge>}
        </span>
        <span className="text-muted">
          {word}
          <span className="money"> · из {formatMinor(state.totalMinor, debt.currency)}</span>
          {state.interestMinor > 0 && <span> с процентами</span>}
        </span>
      </span>
    </Link>
  );
}
