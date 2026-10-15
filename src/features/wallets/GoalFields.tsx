import { AmountInput } from '@/components/AmountInput';
import { ChipPicker } from '@/components/ChipPicker';
import { inputClasses } from '@/components/Field';
import type { CurrencyCode, IsoDate, Minor } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { MAX_DATE, MIN_DATE } from '@/features/transactions/txForm';

export interface GoalFieldsProps {
  currency: CurrencyCode;
  goal: Minor | null;
  onGoal: (value: Minor | null) => void;
  hasDue: boolean;
  dueOn: IsoDate;
  onDue: (patch: { hasDue?: boolean; dueOn?: IsoDate }) => void;
  goalError?: string | null;
  dueError?: string | null;
}

/** Цель накопления у кошелька вида «Накопления»: сумма и необязательный срок. Срок спрашиваем, только когда сумма задана. */
export function GoalFields({ currency, goal, onGoal, hasDue, dueOn, onDue, goalError, dueError }: GoalFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Цель накопления</span>
          <span className="text-sm text-muted">можно не указывать</span>
        </div>
        <AmountInput label="Цель накопления" currency={currency} value={goal} showKeypad={false} error={goalError} onChange={onGoal} />
        <p className="text-center text-sm text-muted">Сколько хотите накопить. Накоплено — это остаток кошелька, пополняйте его переводом или доходом.</p>
      </div>

      {goal !== null && (
        <FieldGroup label="Накопить к дате" hint="можно не указывать" error={dueError}>
          <ChipPicker
            ariaLabel="Накопить к дате"
            value={hasDue ? 'date' : 'none'}
            onChange={(v) => onDue({ hasDue: v === 'date' })}
            options={[
              { value: 'none', label: 'Без срока' },
              { value: 'date', label: 'Указать срок', icon: '📅' },
            ]}
          />
          {hasDue && (
            <input
              type="date"
              aria-label="Накопить к дате: календарь"
              aria-invalid={dueError ? true : undefined}
              min={MIN_DATE}
              max={MAX_DATE}
              value={dueOn}
              onChange={(e) => onDue({ dueOn: e.target.value })}
              className={`${inputClasses(!!dueError)} min-h-[48px]`}
            />
          )}
        </FieldGroup>
      )}
    </>
  );
}
