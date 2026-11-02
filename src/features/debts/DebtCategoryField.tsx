import { useState } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { DEBT_CATEGORY_MAX, debtCategoryKey } from '@/domain/debtCategory';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { canAutoFocusText } from '@/lib/pointer';

/** Служебное значение чипа «Другая…»: настоящей категорией быть не может (в чипах категории — их названия). */
const OTHER = '__other__';

export interface DebtCategoryFieldProps {
  /** Категория сейчас, как в форме; '' — без категории. */
  value: string;
  /** Что предложить чипами: категории уже заведённых долгов и готовые подсказки (domain/debtCategory.ts). */
  options: readonly string[];
  onChange: (value: string) => void;
  error?: string | null;
}

/**
 * Категория долга: чипы «Без категории» · уже встречавшиеся и готовые названия · «Другая…» (своё слово в поле ввода).
 * Необязательное поле. Категория — просто слово: отдельного справочника у долгов нет, она появляется в списке выбора и фильтра,
 * как только записана у какого-нибудь долга.
 */
export function DebtCategoryField({ value, options, onChange, error }: DebtCategoryFieldProps) {
  const known = options.find((o) => debtCategoryKey(o) === debtCategoryKey(value)) ?? null;
  // Своё слово: в поле уже есть категория, которой нет среди чипов, или человек сам нажал «Другая…»
  const [typing, setTyping] = useState(() => value.trim() !== '' && known === null);
  const selected = typing ? OTHER : (known ?? '');

  const pick = (v: string) => {
    if (v === OTHER) {
      setTyping(true);
      if (known !== null) onChange(''); // чип выбран — поле своего слова начинается с пустого
      return;
    }
    setTyping(false);
    onChange(v);
  };

  return (
    <FieldGroup label="Категория" hint="Необязательно" error={typing ? null : error}>
      <ChipPicker
        ariaLabel="Категория долга"
        value={selected}
        onChange={pick}
        options={[
          { value: '', label: 'Без категории' },
          ...options.map((o) => ({ value: o, label: o })),
          { value: OTHER, label: 'Другая…' },
        ]}
      />
      {typing && (
        <TextInput
          label="Своя категория"
          value={value}
          maxLength={DEBT_CATEGORY_MAX}
          placeholder="Например, Сосед"
          autoComplete="off"
          enterKeyHint="next"
          onChange={(e) => onChange(e.target.value)}
          error={error}
          autoFocus={canAutoFocusText()}
        />
      )}
    </FieldGroup>
  );
}
