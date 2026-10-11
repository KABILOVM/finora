import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { currencyInfo } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import { enteredLabel } from '@/rates/enteredText';
import type { ReceivedView } from './useTxFormController';
import { FieldGroup } from './FieldGroup';
import type { Minor } from '@/domain/types';
import { endSentence } from './txDisplay';
import { formatRate } from './txForm';

export interface ReceivedFieldProps {
  view: ReceivedView;
  onChange: (value: Minor | null) => void;
  /** Вернуть сумму, которую предлагает курс. */
  onUseSuggested: () => void;
  error?: string | null;
}

/** Мельче крупной суммы: это второе поле на экране. */
const SMALL = '[&_.money]:!text-3xl';

/**
 * «Получено» у перевода между кошельками в разных валютах: сумма предлагается по курсу и правится руками.
 * Комиссия при переводе в одной валюте — отдельное поле (FeeField).
 */
export function ReceivedField({ view, onChange, onUseSuggested, error }: ReceivedFieldProps) {
  const toSymbol = currencyInfo(view.to).symbol;

  const differs = view.suggested !== null && view.value !== view.suggested;
  return (
    <FieldGroup label={`Получено, ${toSymbol}`}>
      <AmountInput
        currency={view.to}
        value={view.value}
        onChange={onChange}
        label="Получено"
        showKeypad={false}
        error={error}
        className={SMALL}
      />
      {view.mode === 'cross' && view.lookup && (
        <p className="text-sm text-muted">
          {endSentence(
            `По курсу 1\u00a0${currencyInfo(view.from).symbol} = ${formatRate(view.lookup.rate)}\u00a0${toSymbol}` +
              (view.lookup.entered ? ` (${enteredLabel(view.lookup.asOf)})` : '') +
              (view.suggested !== null ? ` получится ≈ ${formatMinor(view.suggested, view.to)}` : ''),
          )}{' '}
          Сумму можно изменить.
        </p>
      )}
      {view.mode === 'cross' && !view.lookup && (
        <p className="text-sm font-medium text-warning">
          Курса {currencyInfo(view.from).symbol} → {toSymbol} нет. Введите, сколько денег пришло на второй кошелёк.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {view.mode === 'cross' && differs && (
          <Button variant="ghost" onClick={onUseSuggested}>
            Подставить по курсу
          </Button>
        )}
      </div>
    </FieldGroup>
  );
}
