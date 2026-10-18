import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MoneyText } from '@/components/MoneyText';
import { DEBT_PLAN_STOP_TEXT, debtPlanStop, planFinished, type DebtState } from '@/domain/debts';
import type { Debt, IsoDate, LocalRow, RecurringRule } from '@/domain/types';
import { describeSchedule } from '@/recurring/describe';
import { ruDateShort } from './debtText';

export interface DebtPlanCardProps {
  debt: LocalRow<Debt>;
  state: DebtState;
  /** Живые планы долга (isLivePlanOf); обычно один — несколько бывает после объединения или правок с двух устройств. */
  plans: readonly LocalRow<RecurringRule>[];
  today: IsoDate;
  busy: boolean;
  onEdit: (rule: LocalRow<RecurringRule>) => void;
  onStop: (rule: LocalRow<RecurringRule>) => void;
}

/** План «Платить частями» на странице долга: сумма, расписание, до какой даты, идёт ли он; «Изменить» и «Остановить». */
export function DebtPlanCard({ debt, state, plans, today, busy, onEdit, onStop }: DebtPlanCardProps) {
  if (plans.length === 0) return null;
  const many = plans.length > 1;
  return (
    <section aria-labelledby="debt-plan" className="mt-4">
      <h2 id="debt-plan" className="mb-2 px-1 text-base font-semibold text-muted">
        {many ? `Планы платежей (${plans.length})` : 'План платежей'}
      </h2>
      {many && (
        <p role="status" className="mb-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
          У долга несколько планов: платежи по ним складываются. Оставьте один, остальные остановите.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {plans.map((rule) => {
          const stop = debtPlanStop(rule, debt, state);
          return (
            <Card key={rule.id} data-testid="debt-plan">
              <p className="font-semibold">
                <MoneyText minor={rule.amountMinor} currency={debt.currency} /> — {describeSchedule(rule).toLowerCase()}
                {rule.endOn ? `, до ${ruDateShort(rule.endOn)}` : ''}
              </p>
              <p className="mt-1">
                {stop !== null ? (
                  <span className="text-sm text-muted">{DEBT_PLAN_STOP_TEXT[stop]}</span>
                ) : planFinished(rule, today) ? (
                  <span className="text-sm text-warning">
                    План закончился {ruDateShort(rule.endOn ?? '')}, а долг не погашен: продлите план («Изменить») или остановите его, чтобы
                    составить новый.
                  </span>
                ) : (
                  <Badge tone={rule.autoPost === 1 ? 'brand' : 'neutral'}>{rule.autoPost === 1 ? 'Проводится само' : 'Ждёт подтверждения'}</Badge>
                )}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" icon="edit" disabled={busy} onClick={() => onEdit(rule)}>
                  Изменить
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => onStop(rule)}>
                  Остановить
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
