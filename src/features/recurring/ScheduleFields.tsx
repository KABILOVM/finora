import { ChipPicker } from '@/components/ChipPicker';
import { Field, inputClasses, TextInput } from '@/components/Field';
import { Icon } from '@/components/Icon';
import type { Frequency, IsoDate } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { MAX_DATE, MIN_DATE } from '@/features/transactions/txForm';
import { isValidIsoDate } from '@/lib/dates';
import { describeSchedule, shortMonthHint } from '@/recurring/describe';
import { historyNote, parseInterval, previewDates, type RuleFormErrors, type RuleFormState } from '@/recurring/ruleForm';
import { whenText } from '@/recurring/upcoming';
import { ToggleRow } from './ToggleRow';

const FREQUENCIES: readonly { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'День' },
  { value: 'weekly', label: 'Неделя' },
  { value: 'monthly', label: 'Месяц' },
  { value: 'yearly', label: 'Год' },
];

const INTERVAL_LABEL: Record<Frequency, string> = {
  daily: 'Каждые сколько дней',
  weekly: 'Каждые сколько недель',
  monthly: 'Каждые сколько месяцев',
  yearly: 'Каждые сколько лет',
};

export interface ScheduleFieldsProps {
  form: RuleFormState;
  errors: RuleFormErrors;
  today: IsoDate;
  onChange: (patch: Partial<RuleFormState>) => void;
}

/** Расписание: периодичность, «каждые N», даты начала и конца, «Проводить само» и живой предпросмотр ближайших дат. */
export function ScheduleFields({ form, errors, today, onChange }: ScheduleFieldsProps) {
  const intervalN = parseInterval(form.intervalText);
  const startOk = isValidIsoDate(form.startOn);
  const schedule = intervalN !== null && startOk ? describeSchedule({ frequency: form.frequency, intervalN, startOn: form.startOn }) : null;
  const monthHint = startOk ? shortMonthHint(form) : null;
  const dates = previewDates(form, today);
  const history = historyNote(form, today);

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup label="Как часто повторять">
        <ChipPicker
          ariaLabel="Периодичность"
          options={FREQUENCIES}
          value={form.frequency}
          onChange={(v) => onChange({ frequency: v as Frequency })}
        />
      </FieldGroup>

      <TextInput
        label={INTERVAL_LABEL[form.frequency]}
        hint={schedule ? `Получится: ${schedule}` : '1 — без пропусков, 2 — через один период'}
        value={form.intervalText}
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => onChange({ intervalText: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })}
        error={errors.interval}
      />

      <Field id="rule-start" label="Первый платёж" error={errors.startOn}>
        <input
          id="rule-start"
          type="date"
          min={MIN_DATE}
          max={MAX_DATE}
          value={form.startOn}
          aria-invalid={errors.startOn ? true : undefined}
          onChange={(e) => onChange({ startOn: e.target.value })}
          className={`${inputClasses(!!errors.startOn)} min-h-[48px]`}
        />
      </Field>

      <ToggleRow
        label="Закончить в определённую дату"
        hint={form.hasEnd ? undefined : 'Сейчас платёж повторяется без конца'}
        checked={form.hasEnd}
        onChange={(hasEnd) => onChange({ hasEnd, endOn: hasEnd && form.endOn === '' ? form.startOn : form.endOn })}
      />
      {form.hasEnd && (
        <Field id="rule-end" label="Последний платёж не позже" error={errors.endOn}>
          <input
            id="rule-end"
            type="date"
            min={MIN_DATE}
            max={MAX_DATE}
            value={form.endOn}
            aria-invalid={errors.endOn ? true : undefined}
            onChange={(e) => onChange({ endOn: e.target.value })}
            className={`${inputClasses(!!errors.endOn)} min-h-[48px]`}
          />
        </Field>
      )}

      {monthHint && (
        <p className="flex items-start gap-2 text-sm text-muted">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>{monthHint}</span>
        </p>
      )}

      <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm" data-testid="rule-preview">
        {dates.length > 0 ? (
          <p>
            <span className="font-semibold text-text">Ближайшие даты:</span>{' '}
            <span className="text-muted">{dates.map((d) => whenText(d, today)).join('; ')}</span>
          </p>
        ) : (
          <p className="text-muted">Ближайших дат нет: проверьте расписание и даты.</p>
        )}
      </div>

      <ToggleRow
        label="Проводить само"
        hint={
          form.autoPost
            ? 'В день платежа операция запишется сама, когда вы откроете приложение'
            : 'Платёж появится в «Сегодня», и вы подтвердите его кнопкой «Провести»'
        }
        checked={form.autoPost}
        onChange={(autoPost) => onChange({ autoPost })}
      />
      {history && (
        <p role="status" className="flex items-start gap-2 text-sm text-warning">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>{history}</span>
        </p>
      )}
    </div>
  );
}
