import { Button } from '@/components/Button';
import { MoneyText } from '@/components/MoneyText';
import type { IsoDate, LocalRow, RecurringRule } from '@/domain/types';
import { formatDayLabel } from '@/lib/dates';
import { viewRule } from '@/recurring/ruleView';
import type { SkippedItem } from '@/recurring/useSkipped';
import { RuleIcon } from './RuleIcon';
import type { RecurringLookups } from './useRecurringData';

export interface SkippedRowProps {
  item: SkippedItem;
  rule: LocalRow<RecurringRule>;
  lookups: RecurringLookups;
  today: IsoDate;
  busy: boolean;
  onRestore: () => void;
}

/**
 * Пропущенный платёж. «Вернуть» оживляет ту же операцию: платёж записывается в операции с суммой и курсом на момент пропуска.
 * Дату плана по долгу, которую закрыл отдельный платёж, вернуть нельзя: деньги уже записаны.
 */
export function SkippedRow({ item, rule, lookups, today, busy, onRestore }: SkippedRowProps) {
  const { tx } = item;
  const v = viewRule(rule, lookups.wallets, lookups.categories, lookups.base);
  const when = formatDayLabel(tx.occurredOn, today);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <RuleIcon view={v} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-text">{v.title}</p>
          <p className="text-sm text-muted">
            {item.paidSeparately ? 'Оплачен отдельным платежом' : item.skipped ? 'Пропущен' : 'Удалён из операций'} · {when}
          </p>
        </div>
        <MoneyText minor={tx.amountMinor} currency={v.currency} tone="none" className="shrink-0 text-base font-semibold" />
      </div>
      {!item.paidSeparately && (
        <div className="mt-2 pl-[3.25rem]">
          <Button variant="secondary" fullWidth disabled={busy} aria-label={`Вернуть платёж: ${v.title}, ${when}`} onClick={onRestore}>
            Вернуть
          </Button>
        </div>
      )}
    </li>
  );
}
