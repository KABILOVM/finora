import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { DEBT_OVERFLOW_MESSAGE } from '@/db';
import { formatMinor } from '@/domain/money';
import type { IsoDate } from '@/domain/types';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import { debtCategoriesOf } from './debtFilters';
import type { DebtItem } from './debtSummary';
import { dueInfo, dueLine, progressPercent, repaidWord } from './debtText';
import { DebtCategoryBadges } from './DebtCategoryBadges';
import { PersonAvatar } from './personAvatar';

export interface DebtBarProps {
  percent: number;
  /** Подпись для скринридера: чей это долг и сколько погашено. */
  label: string;
  /** Цвет заполнения: у просроченного долга — красный, у горящего срока — жёлтый; рядом всегда слова, цвет не единственный признак. */
  tone?: 'brand' | 'warning' | 'danger';
  className?: string;
}

const BAR_TONE = { brand: 'bg-brand', warning: 'bg-warning', danger: 'bg-danger' } as const;

/** Полоса «сколько уже погашено»: доступная (role="progressbar"), заполнение не выходит за 100%. Рядом всегда слова, цвет не единственный признак. */
export function DebtBar({ percent, label, tone = 'brand', className }: DebtBarProps) {
  const shown = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      aria-valuetext={`${shown}%`}
      className={cn('h-2.5 overflow-hidden rounded-full bg-border/70', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', BAR_TONE[tone])} style={{ width: `${shown > 0 ? Math.max(shown, 2) : 0}%` }} />
    </div>
  );
}

export interface DebtRowProps {
  item: DebtItem;
  today: IsoDate;
}

const TONE_CLASS = { none: 'text-muted', ok: 'text-muted', soon: 'font-semibold text-warning', today: 'font-semibold text-warning', overdue: 'font-semibold text-danger' } as const;
/** Цвет полосы слева и заполнения: просрочка красная, горящий срок жёлтый, остальное — обычное. */
const EDGE = { none: 'border-transparent', ok: 'border-transparent', soon: 'border-warning', today: 'border-warning', overdue: 'border-danger' } as const;
const BAR = { none: 'brand', ok: 'brand', soon: 'warning', today: 'warning', overdue: 'danger' } as const;

/**
 * Строка долга в списке: кружок человека, имя, остаток, полоса погашения, срок словами (просрочка — красным и текстом). Слева у строки
 * с горящим сроком цветная полоска. Вся строка — ссылка на страницу долга.
 */
export function DebtRow({ item, today }: DebtRowProps) {
  const { debt, state } = item;
  const base = 'block min-h-[56px] border-l-4 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-border/60';

  if (state === null) {
    return (
      <Link to={`/debts/${debt.id}`} className={cn(base, 'border-transparent')}>
        <span className="flex items-center gap-3">
          <PersonAvatar name={debt.counterparty} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{debt.counterparty}</span>
            <span role="alert" className="mt-1 block text-sm font-medium text-danger">
              {DEBT_OVERFLOW_MESSAGE}
            </span>
          </span>
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
    <Link to={`/debts/${debt.id}`} className={cn(base, EDGE[due.tone], closed && 'opacity-80')}>
      <span className="flex items-start gap-3">
        <PersonAvatar name={debt.counterparty} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="line-clamp-2 min-w-0 break-words font-semibold">{debt.counterparty}</span>
            <span className="shrink-0 text-right">
              <span className="sr-only">Остаток: </span>
              <MoneyText minor={state.remainingMinor} currency={debt.currency} tone="none" className="text-lg font-bold" />
            </span>
          </span>
          <DebtBar percent={percent} tone={BAR[due.tone]} label={`${debt.counterparty}: ${word}`} className="mt-2" />
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
              <DebtCategoryBadges categories={debtCategoriesOf(item)} className="ml-2" />
              {closed && <Badge tone="neutral" className="ml-2">Закрыт</Badge>}
              {!closed && state.settled && <Badge tone="income" className="ml-2">Погашен</Badge>}
            </span>
            <span className="text-muted">
              {word}
              <span className="money"> · из {formatMinor(state.totalMinor, debt.currency)}</span>
              {state.interestMinor > 0 && <span> с процентами</span>}
            </span>
          </span>
        </span>
      </span>
    </Link>
  );
}
