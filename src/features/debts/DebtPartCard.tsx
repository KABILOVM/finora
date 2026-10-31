import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { MoneyText } from '@/components/MoneyText';
import { DEBT_OVERFLOW_MESSAGE } from '@/db';
import { isLivePlanOf } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { IsoDate, LocalRow, RecurringRule } from '@/domain/types';
import { describeSchedule } from '@/recurring/describe';
import { DebtBar } from './DebtRow';
import type { DebtItem } from './debtSummary';
import { dueInfo, interestTermsLine, progressPercent, repaidWord, ruDateShort } from './debtText';
import { normName } from './debtMatch';

export interface DebtPartCardProps {
  /** Свой долг составляющей (не итог): у неё свои сумма, проценты, срок, даты. */
  item: DebtItem;
  /** Имя главного долга: если у составляющей оно другое, показываем его. */
  rootName: string;
  today: IsoDate;
  /** Планы платежей всех долгов: берутся те, что относятся к этой составляющей. */
  rules: readonly LocalRow<RecurringRule>[];
  /**
   * «Открыть» ведёт на страницу самой составляющей. У главного долга адрес с «?own=1»: без него откроется весь объединённый долг.
   * Адрес собирается тут (фиксированное начало «/debts/»): статический аудит не пропускает ссылку, адрес которой пришёл переменной.
   */
  own?: boolean;
  disabled?: boolean;
  onPay: () => void;
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/**
 * Название составляющей в объединённом долге: «Долг от 05.03.2026 · 5 000 с.» (своё имя впереди, если оно другое). Сумма в названии
 * нужна, чтобы отличить части, взятые в один день.
 */
export function partTitle(item: DebtItem, rootName: string): string {
  const d = item.debt;
  const amount = formatMinor(d.principalMinor, d.currency);
  return normName(d.counterparty) !== normName(rootName)
    ? `${d.counterparty} · от ${ruDateShort(d.openedOn)} · ${amount}`
    : `Долг от ${ruDateShort(d.openedOn)} · ${amount}`;
}

/**
 * Одна составляющая объединённого долга со СВОИМИ условиями: сумма, проценты со ставкой и сроком, срок возврата, даты, сколько оплачено
 * и осталось, плановые платежи. «Платёж» записывает платёж именно по этой составляющей, «Открыть» ведёт на её страницу (правка,
 * «Взял ещё», план «Платить частями», все платежи).
 */
export function DebtPartCard({ item, rootName, today, rules, own = false, disabled = false, onPay }: DebtPartCardProps) {
  const { debt, state } = item;
  const title = partTitle(item, rootName);
  const closed = debt.closedAt !== null;
  const plans = rules.filter((r) => isLivePlanOf(r, debt));
  const terms = interestTermsLine(debt.interestRateBp, debt.termMonths);

  if (state === null) {
    return (
      <Card data-testid="debt-part">
        <p className="font-semibold">{title}</p>
        <p role="alert" className="mt-1 text-sm font-medium text-danger">
          {DEBT_OVERFLOW_MESSAGE}
        </p>
        <Link to={`/debts/${debt.id}${own ? '?own=1' : ''}`} className={`${buttonClasses('secondary')} mt-3`}>
          Открыть
        </Link>
      </Card>
    );
  }

  const cur = debt.currency;
  const percent = progressPercent(state.paidMinor, state.totalMinor);
  const word = repaidWord(debt.direction, percent);
  const due = dueInfo(debt.dueOn, today, !closed && !state.settled);
  const canPay = !closed && state.remainingMinor > 0;
  return (
    <Card data-testid="debt-part" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words font-semibold">{title}</p>
        <span className="flex gap-1">
          {closed && <Badge tone="neutral">Закрыт</Badge>}
          {!closed && state.settled && <Badge tone="income">Погашен</Badge>}
        </span>
      </div>
      <p className="mt-1 text-lg font-bold" data-testid="debt-part-remaining">
        <span className="sr-only">Остаток: </span>
        <MoneyText minor={state.remainingMinor} currency={cur} tone="none" />
      </p>
      <DebtBar percent={percent} label={`${title}: ${word}`} className="mt-2" />
      <p className="mt-1 text-sm text-muted">{word}</p>

      <dl className="mt-2 divide-y divide-border border-t border-border text-sm">
        <Line label="Сумма долга">
          <MoneyText minor={state.principalMinor} currency={cur} tone="none" />
        </Line>
        {state.interestMinor > 0 && (
          <Line label="Проценты">
            <span data-testid="debt-part-interest">
              <MoneyText minor={state.interestMinor} currency={cur} tone="none" />
            </span>
            {terms !== '' && <span className="block text-muted">{terms}</span>}
          </Line>
        )}
        <Line label="Оплачено">
          <MoneyText minor={state.paidMinor} currency={cur} tone="none" />
          {state.payments.length > 0 && <span className="block text-muted">платежей: {state.payments.length}</span>}
        </Line>
        <Line label="Срок возврата">
          {debt.dueOn === null ? (
            'Без срока'
          ) : (
            <>
              <span className="money">{ruDateShort(debt.dueOn)}</span>
              {due.text !== '' && (
                <span className={due.tone === 'overdue' ? 'block font-semibold text-danger' : due.tone === 'soon' || due.tone === 'today' ? 'block font-semibold text-warning' : 'block text-muted'}>
                  {due.text.charAt(0).toUpperCase() + due.text.slice(1)}
                </span>
              )}
            </>
          )}
        </Line>
        <Line label="Дата долга">{ruDateShort(debt.openedOn)}</Line>
        {(debt.category ?? '') !== '' && <Line label="Категория">{debt.category}</Line>}
        {plans.map((r) => (
          <Line key={r.id} label="План платежей">
            <span className="money">{formatMinor(r.amountMinor, cur)}</span>
            <span className="block text-muted">
              {describeSchedule(r).toLowerCase()}
              {r.endOn ? `, до ${ruDateShort(r.endOn)}` : ''}
            </span>
          </Line>
        ))}
      </dl>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="primary" icon="plus" disabled={disabled || !canPay} onClick={onPay} aria-label={`Платёж: ${title}`}>
          Платёж
        </Button>
        <Link to={`/debts/${debt.id}${own ? '?own=1' : ''}`} className={buttonClasses('secondary')} aria-label={`Открыть: ${title}`}>
          Открыть
        </Link>
      </div>
    </Card>
  );
}
