import { useState } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { inputClasses } from '@/components/Field';
import { addDays, formatDayLabel, isValidIsoDate, todayLocal } from '@/lib/dates';
import { FieldGroup } from './FieldGroup';
import { MAX_DATE, MIN_DATE, resolveDate, type DateChoice } from './txForm';

export interface DateChipsProps {
  value: DateChoice;
  onChange: (value: DateChoice) => void;
  /** «Сегодня»/«Вчера» выбраны — выбор даты закончен (панель можно свернуть). Для «Другой даты» не вызывается. */
  onDone?: () => void;
  error?: string | null;
}

type Key = 'today' | 'yesterday' | 'other';

/** Дата операции: «Сегодня» / «Вчера» одним касанием, для другой даты — поле-календарь. */
export function DateChips({ value, onChange, onDone, error }: DateChipsProps) {
  const today = todayLocal();
  const yesterday = addDays(today, -1);
  const resolved = resolveDate(value);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selected: Key =
    value.mode === 'today' || resolved === today ? 'today' : resolved === yesterday ? 'yesterday' : 'other';
  const showPicker = pickerOpen || selected === 'other';
  const otherLabel = selected === 'other' && isValidIsoDate(resolved) ? formatDayLabel(resolved, today) : 'Другая дата';

  const pick = (key: string) => {
    if (key === 'today') {
      setPickerOpen(false);
      onChange({ mode: 'today' });
      onDone?.();
    } else if (key === 'yesterday') {
      setPickerOpen(false);
      onChange({ mode: 'date', value: yesterday }); // конкретный день: после полуночи «вчера» не съедет
      onDone?.();
    } else {
      setPickerOpen(true);
      if (selected !== 'other') onChange({ mode: 'date', value: resolved });
    }
  };

  return (
    <FieldGroup label="Дата" error={error}>
      <ChipPicker
        ariaLabel="Дата"
        value={selected}
        onChange={pick}
        options={[
          { value: 'today', label: 'Сегодня' },
          { value: 'yesterday', label: 'Вчера' },
          { value: 'other', label: otherLabel, icon: '📅' },
        ]}
      />
      {showPicker && (
        <input
          type="date"
          aria-label="Дата операции"
          aria-invalid={error ? true : undefined}
          min={MIN_DATE}
          max={MAX_DATE}
          value={resolved}
          onChange={(e) => onChange({ mode: 'date', value: e.target.value })}
          className={`${inputClasses(!!error)} min-h-[48px]`}
        />
      )}
    </FieldGroup>
  );
}
