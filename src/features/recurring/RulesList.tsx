import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { MoneyText } from '@/components/MoneyText';
import { DEBT_PLAN_STOP_TEXT, type DebtPlanStop } from '@/domain/debts';
import type { IsoDate, LocalRow, RecurringRule } from '@/domain/types';
import { ruDate } from '@/features/transactions/txForm';
import { addDays } from '@/lib/dates';
import { nextOccurrence } from '@/domain/schedule';
import type { AutoPostFailure } from '@/recurring/autoPostState';
import { describeSchedule } from '@/recurring/describe';
import { viewRule } from '@/recurring/ruleView';
import { whenText } from '@/recurring/upcoming';
import { FailureNote } from './FailureNote';
import { RuleIcon } from './RuleIcon';
import type { RecurringLookups } from './useRecurringData';

/**
 * Когда ближайший платёж: не раньше сегодняшнего дня и без уже проведённых или пропущенных дат (`done`).
 * null — больше платежей не будет.
 */
export function nextDue(rule: LocalRow<RecurringRule>, today: IsoDate, done: ReadonlySet<IsoDate> = new Set()): IsoDate | null {
  let next = nextOccurrence(rule, addDays(today, -1));
  // защита от бесконечного перебора: проведённых дат подряд не бывает больше, чем окно «Предстоящих»
  for (let i = 0; next !== null && done.has(next) && i < 400; i++) next = nextOccurrence(rule, next);
  return next;
}

function nextText(rule: LocalRow<RecurringRule>, today: IsoDate, done?: ReadonlySet<IsoDate>): string {
  const next = nextDue(rule, today, done);
  // дату не рвём посреди («ср, 11 / ноя»): пробелы внутри неё неразрывные
  return next === null ? 'Больше платежей не будет' : `Следующий платёж: ${whenText(next, today).toLowerCase().replace(/ /g, '\u00a0')}`;
}

export interface RuleRowProps {
  rule: LocalRow<RecurringRule>;
  lookups: RecurringLookups;
  today: IsoDate;
  failure?: AutoPostFailure;
  /** План по долгу стоит (долг погашен, закрыт, в архиве или удалён): платежей по нему нет, пока долг снова не откроют. */
  stop?: DebtPlanStop;
  /** Даты этого правила, по которым платёж уже проведён или пропущен (в окне «Предстоящих»). */
  done?: ReadonlySet<IsoDate>;
  onOpen: () => void;
}

/** Правило в списке «Все правила»: название, расписание словами, сумма, кошелёк, категория и как проводится. Касание — правка. */
export function RuleRow({ rule, lookups, today, failure, stop, done, onOpen }: RuleRowProps) {
  const v = viewRule(rule, lookups.wallets, lookups.categories, lookups.base);
  const debt = rule.debtId === null ? undefined : lookups.debts.get(rule.debtId);
  const schedule = `${describeSchedule(rule)}${rule.endOn ? `, до ${ruDate(rule.endOn)}` : ''}`;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[64px] w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-border/60"
      >
        <RuleIcon view={v} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-text">{v.title}</span>
          <span className="block text-sm text-muted">{schedule}</span>
          {v.subtitle && <span className="block truncate text-sm text-muted">{v.subtitle}</span>}
          {debt && <span className="block truncate text-sm text-muted">Платёж по долгу: {debt.counterparty}</span>}
          <span className="block text-sm text-muted">{stop ? DEBT_PLAN_STOP_TEXT[stop] : nextText(rule, today, done)}</span>
          <span className="mt-1 block">
            {stop ? (
              <Badge tone="neutral">Остановлен</Badge>
            ) : (
              <Badge tone={rule.autoPost === 1 ? 'brand' : 'neutral'}>{rule.autoPost === 1 ? 'Проводится само' : 'Ждёт подтверждения'}</Badge>
            )}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <MoneyText
            minor={v.signedMinor}
            currency={v.currency}
            tone={v.tone}
            sign={v.tone === 'income' ? 'always' : 'auto'}
            className="text-base font-semibold"
          />
          {v.second && <span className="money block text-xs text-muted">{v.second}</span>}
        </span>
      </button>
      {failure && (
        <div className="px-4 pb-3 pl-[4.25rem]">
          <FailureNote failure={failure} />
        </div>
      )}
    </li>
  );
}

export interface ArchivedRowProps {
  rule: LocalRow<RecurringRule>;
  lookups: RecurringLookups;
  busy: boolean;
  onRestore: () => void;
}

/** Правило в архиве: платежей по нему нет; кнопка возвращает его в работу. */
export function ArchivedRow({ rule, lookups, busy, onRestore }: ArchivedRowProps) {
  const v = viewRule(rule, lookups.wallets, lookups.categories, lookups.base);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <RuleIcon view={v} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-text">{v.title}</p>
        <p className="text-sm text-muted">{describeSchedule(rule)}</p>
      </div>
      <MoneyText minor={v.signedMinor} currency={v.currency} tone="none" className="shrink-0 font-semibold" />
      <Button variant="secondary" disabled={busy} aria-label={`Вернуть из архива: ${v.title}`} onClick={onRestore}>
        Вернуть
      </Button>
    </li>
  );
}
