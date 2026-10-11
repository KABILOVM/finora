import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { MoneyText } from '@/components/MoneyText';
import type { UpcomingItem } from '@/db';
import type { IsoDate } from '@/domain/types';
import type { AutoPostFailure } from '@/recurring/autoPostState';
import { viewRule } from '@/recurring/ruleView';
import { overdueText, whenText } from '@/recurring/upcoming';
import { FailureNote } from './FailureNote';
import { RuleIcon } from './RuleIcon';
import type { RecurringLookups } from './useRecurringData';

export interface UpcomingRowProps {
  item: UpcomingItem;
  today: IsoDate;
  lookups: RecurringLookups;
  failure?: AutoPostFailure;
  onPost: () => void;
  onSkip: () => void;
}

/** Предстоящий платёж: название, когда, сумма и две кнопки — «Провести» и «Пропустить» (по ≥ 44 px, на телефоне в ряд). */
export function UpcomingRow({ item, today, lookups, failure, onPost, onSkip }: UpcomingRowProps) {
  const { rule, date, status } = item;
  const v = viewRule(rule, lookups.wallets, lookups.categories, lookups.base);
  const debt = rule.debtId === null ? undefined : lookups.debts.get(rule.debtId);
  const when = whenText(date, today);
  const label = `${v.title}, ${when}`;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <RuleIcon view={v} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-text">{v.title}</p>
          <p className="text-sm">
            {status === 'overdue' ? (
              <>
                <span className="font-semibold text-danger">{overdueText(date, today)}</span>
                <span className="text-muted"> · {when}</span>
              </>
            ) : (
              <span className={status === 'due' ? 'font-semibold text-text' : 'text-muted'}>{when}</span>
            )}
          </p>
          {v.subtitle && <p className="truncate text-sm text-muted">{v.subtitle}</p>}
          {debt && <p className="truncate text-sm text-muted">Платёж по долгу: {debt.counterparty}</p>}
          {rule.autoPost === 1 && status !== 'overdue' && !failure && (
            <Badge tone="brand" className="mt-1">
              Проведётся само
            </Badge>
          )}
          {failure && <FailureNote failure={failure} />}
        </div>
        <div className="shrink-0 text-right">
          <MoneyText
            minor={v.signedMinor}
            currency={v.currency}
            tone={v.tone}
            sign={v.tone === 'income' ? 'always' : 'auto'}
            className="text-base font-semibold"
          />
          {v.second && <p className="money text-xs text-muted">{v.second}</p>}
        </div>
      </div>
      <div className="mt-2 flex gap-2 pl-[3.25rem]">
        <Button className="flex-1" aria-label={`Провести: ${label}`} onClick={onPost}>
          Провести
        </Button>
        <Button variant="secondary" className="flex-1" aria-label={`Пропустить: ${label}`} onClick={onSkip}>
          Пропустить
        </Button>
      </div>
    </li>
  );
}
