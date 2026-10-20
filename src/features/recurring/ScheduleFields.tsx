import { useState } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { inputClasses } from '@/components/Field';
import { Icon } from '@/components/Icon';
import type { Frequency, IsoDate } from '@/domain/types';
import { MAX_DATE, MIN_DATE } from '@/features/transactions/txForm';
import { cn } from '@/lib/cn';
import { isValidIsoDate } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { describeSchedule, shortMonthHint } from '@/recurring/describe';
import { historyNote, parseInterval, previewDates, type RuleFormErrors, type RuleFormState } from '@/recurring/ruleForm';
import { whenText } from '@/recurring/upcoming';
import { RulePill } from './RulePill';
import { ToggleRow } from '@/components/ToggleRow';

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

/** «Раз в 2 недели»: единица после числа (винительный падеж: «раз в 1 неделю»). */
function unitText(f: Frequency, n: number | null): string {
  const k = n ?? 1;
  switch (f) {
    case 'daily':
      return pluralRu(k, 'день', 'дня', 'дней');
    case 'weekly':
      return pluralRu(k, 'неделю', 'недели', 'недель');
    case 'monthly':
      return pluralRu(k, 'месяц', 'месяца', 'месяцев');
    case 'yearly':
      return pluralRu(k, 'год', 'года', 'лет');
  }
}

export interface ScheduleFieldsProps {
  form: RuleFormState;
  errors: RuleFormErrors;
  today: IsoDate;
  onChange: (patch: Partial<RuleFormState>) => void;
}

const dateClass = (invalid: boolean) => `${inputClasses(invalid)} min-h-[44px] min-w-0 flex-1 !px-2.5`;

/**
 * Расписание в двух строках: «Раз в [1] [месяц ▾]» и «с [дата] · до [дата / бессрочно]», затем «Проводить само»
 * и живой предпросмотр ближайших дат.
 */
export function ScheduleFields({ form, errors, today, onChange }: ScheduleFieldsProps) {
  const [freqOpen, setFreqOpen] = useState(false);
  const intervalN = parseInterval(form.intervalText);
  const startOk = isValidIsoDate(form.startOn);
  const schedule = intervalN !== null && startOk ? describeSchedule({ frequency: form.frequency, intervalN, startOn: form.startOn }) : null;
  const monthHint = startOk ? shortMonthHint(form) : null;
  const dates = previewDates(form, today);
  const history = historyNote(form, today);
  const unit = unitText(form.frequency, intervalN);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base text-text">Раз в</span>
          <input
            aria-label={INTERVAL_LABEL[form.frequency]}
            aria-invalid={errors.interval ? true : undefined}
            value={form.intervalText}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => onChange({ intervalText: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })}
            className={`${inputClasses(!!errors.interval)} min-h-[44px] !w-16 shrink-0 !px-2 text-center`}
          />
          <RulePill label={unit} ariaLabel={`Периодичность: ${unit}`} open={freqOpen} onClick={() => setFreqOpen((o) => !o)} />
        </div>
        {freqOpen && (
          <ChipPicker
            ariaLabel="Периодичность"
            options={FREQUENCIES}
            value={form.frequency}
            onChange={(v) => {
              onChange({ frequency: v as Frequency });
              setFreqOpen(false);
            }}
          />
        )}
        {errors.interval && (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.interval}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex min-w-[10.5rem] flex-1 items-center gap-2 text-base text-text">
            <span className="shrink-0">с</span>
            <input
              id="rule-start"
              type="date"
              aria-label="Первый платёж"
              min={MIN_DATE}
              max={MAX_DATE}
              value={form.startOn}
              aria-invalid={errors.startOn ? true : undefined}
              onChange={(e) => onChange({ startOn: e.target.value })}
              className={dateClass(!!errors.startOn)}
            />
          </label>
          <div className={cn('flex min-w-[10.5rem] items-center gap-2 text-base text-text', form.hasEnd ? 'basis-full' : 'flex-1')}>
            <span className="shrink-0">до</span>
            {form.hasEnd && (
              <input
                id="rule-end"
                type="date"
                aria-label="Последний платёж не позже"
                min={MIN_DATE}
                max={MAX_DATE}
                value={form.endOn}
                aria-invalid={errors.endOn ? true : undefined}
                onChange={(e) => onChange({ endOn: e.target.value })}
                className={dateClass(!!errors.endOn)}
              />
            )}
            <button
              type="button"
              role="switch"
              aria-checked={form.hasEnd}
              aria-label="Закончить в определённую дату"
              title={form.hasEnd ? 'Платёж без конца' : 'Закончить в определённую дату'}
              onClick={() => onChange({ hasEnd: !form.hasEnd, endOn: !form.hasEnd && form.endOn === '' ? form.startOn : form.endOn })}
              className={cn(
                'inline-flex min-h-[44px] items-center justify-center rounded-full border border-border bg-surface text-base font-medium text-text transition-colors hover:bg-surface-2',
                form.hasEnd ? 'w-11 shrink-0 text-muted' : 'min-w-0 flex-1 px-3',
              )}
            >
              {form.hasEnd ? <Icon name="close" size={16} /> : 'Бессрочно'}
            </button>
          </div>
        </div>
        {errors.startOn && (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.startOn}
          </p>
        )}
        {errors.endOn && (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.endOn}
          </p>
        )}
      </div>

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
      {schedule && <p className="-mt-1.5 px-1 text-sm text-muted">Получится: {schedule}</p>}

      {monthHint && (
        <p className="flex items-start gap-2 text-sm text-muted">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>{monthHint}</span>
        </p>
      )}

      <ToggleRow
        compact
        label="Проводить само"
        hint={form.autoPost ? 'Запишется сама в день платежа' : 'Нужно подтвердить кнопкой «Провести»'}
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
