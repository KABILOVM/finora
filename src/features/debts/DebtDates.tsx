import { useState } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { inputClasses } from '@/components/Field';
import type { IsoDate } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { MAX_DATE, MIN_DATE } from '@/features/transactions/txForm';
import { addDays, formatDayLabel, isValidIsoDate, todayLocal } from '@/lib/dates';
import { ruDateShort } from './debtText';

export interface DayFieldProps {
  /** Что за дата: «Дата долга», «Дата платежа». Подпись группы и поля-календаря. */
  label: string;
  value: IsoDate;
  onChange: (value: IsoDate) => void;
  error?: string | null;
}

type Key = 'today' | 'yesterday' | 'other';

/** Дата в прошлом: «Сегодня» / «Вчера» одним касанием, для другой даты — поле-календарь. */
export function DayField({ label, value, onChange, error }: DayFieldProps) {
  const today = todayLocal();
  const yesterday = addDays(today, -1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected: Key = value === today ? 'today' : value === yesterday ? 'yesterday' : 'other';
  const showPicker = pickerOpen || selected === 'other';
  const otherLabel = selected === 'other' && isValidIsoDate(value) ? formatDayLabel(value, today) : 'Другая дата';

  const pick = (key: string) => {
    if (key === 'today') {
      setPickerOpen(false);
      onChange(today);
    } else if (key === 'yesterday') {
      setPickerOpen(false);
      onChange(yesterday);
    } else {
      setPickerOpen(true);
    }
  };

  return (
    <FieldGroup label={label} error={error}>
      <ChipPicker
        ariaLabel={label}
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
          aria-label={`${label}: календарь`}
          aria-invalid={error ? true : undefined}
          min={MIN_DATE}
          max={MAX_DATE}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClasses(!!error)} min-h-[48px]`}
        />
      )}
    </FieldGroup>
  );
}

export interface DueFieldProps {
  hasDue: boolean;
  dueOn: IsoDate;
  /** Дата долга: раньше неё срок поставить нельзя. */
  openedOn: IsoDate;
  /** Раньше этой даты срок поставить нельзя (при пополнении — дата пополнения); по умолчанию — openedOn. */
  minDate?: IsoDate;
  /** Только при правке срока у существующего долга: какой срок сейчас (null — срока нет). Меняет подпись и подсказку. */
  current?: IsoDate | null;
  onChange: (patch: { hasDue?: boolean; dueOn?: IsoDate }) => void;
  error?: string | null;
}

/** Срок возврата: необязательный. «Без срока» («Снять срок», если он есть) или «Указать срок» с календарём. */
export function DueField({ hasDue, dueOn, openedOn, minDate, current, onChange, error }: DueFieldProps) {
  const floor = minDate ?? openedOn;
  const known = current !== undefined;
  return (
    <FieldGroup
      label="Срок возврата"
      hint={known ? (current === null ? 'сейчас срока нет' : `сейчас: до ${ruDateShort(current)}`) : 'можно не указывать'}
      error={error}
    >
      <ChipPicker
        ariaLabel="Срок возврата"
        value={hasDue ? 'date' : 'none'}
        onChange={(v) => onChange({ hasDue: v === 'date' })}
        options={[
          { value: 'none', label: known && current !== null ? 'Снять срок' : 'Без срока' },
          { value: 'date', label: 'Указать срок', icon: '📅' },
        ]}
      />
      {hasDue && (
        <input
          type="date"
          aria-label="Срок возврата: календарь"
          aria-invalid={error ? true : undefined}
          min={isValidIsoDate(floor) ? floor : MIN_DATE}
          max={MAX_DATE}
          value={dueOn}
          onChange={(e) => onChange({ dueOn: e.target.value })}
          className={`${inputClasses(!!error)} min-h-[48px]`}
        />
      )}
    </FieldGroup>
  );
}
