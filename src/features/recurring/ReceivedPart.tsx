import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { formatMinor } from '@/domain/money';
import type { Minor } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { ReceivedField } from '@/features/transactions/ReceivedField';
import type { ReceivedView } from '@/features/transactions/useTxFormController';

export interface ReceivedPartProps {
  view: ReceivedView;
  /** Сумма списания: от неё считается комиссия. */
  amountMinor: Minor | null;
  /** Новая сумма зачисления (null — не задана). */
  onChange: (value: Minor | null) => void;
  /** Вернуть сумму, которую предлагает курс (или «без комиссии»). */
  onUseSuggested: () => void;
  onFeeOpen: (open: boolean) => void;
  error?: string | null;
}

/**
 * Вторая половина перевода в форме платежа. Кошельки в разных валютах — поле «Получено» (по курсу, можно поправить).
 * Одна валюта — необязательная комиссия: зачисление = списание − комиссия (как у обычного перевода).
 */
export function ReceivedPart({ view, amountMinor, onChange, onUseSuggested, onFeeOpen, error }: ReceivedPartProps) {
  if (view.mode === 'cross') return <ReceivedField view={view} onChange={onChange} onUseSuggested={onUseSuggested} error={error} />;
  if (!view.show) {
    return (
      <Button variant="ghost" onClick={() => onFeeOpen(true)}>
        Добавить комиссию
      </Button>
    );
  }
  const fee = amountMinor !== null && view.value !== null ? Math.max(0, amountMinor - view.value) : null;
  return (
    <FieldGroup label="Комиссия" error={error ?? null}>
      {fee !== null && fee > 0 && <p className="text-sm text-muted">Комиссия: {formatMinor(fee, view.from)}</p>}
      <AmountInput
        currency={view.from}
        value={fee}
        onChange={(f) => onChange(f === null || amountMinor === null ? null : Math.max(0, amountMinor - f))}
        label="Комиссия"
        showKeypad={false}
        error={error}
      />
      <Button variant="ghost" onClick={() => onFeeOpen(false)}>
        Без комиссии
      </Button>
    </FieldGroup>
  );
}
