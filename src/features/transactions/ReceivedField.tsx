import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { currencyInfo } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import type { Minor } from '@/domain/types';
import type { ReceivedView } from './useTxFormController';
import { FieldGroup } from './FieldGroup';
import { formatRate } from './txForm';

export interface ReceivedFieldProps {
  view: ReceivedView;
  /** Сумма списания (нужна, чтобы показать комиссию). */
  amountMinor: Minor | null;
  onChange: (value: Minor | null) => void;
  /** Вернуть сумму, которую предлагает курс. */
  onUseSuggested: () => void;
  onFeeOpen: (open: boolean) => void;
  error?: string | null;
}

/** Мельче крупной суммы: это второе поле на экране. */
const SMALL = '[&_.money]:!text-3xl';

/**
 * «Получено» у перевода. Разные валюты — сумма предлагается по курсу и правится руками.
 * Одна валюта — зачисление равно списанию; комиссию можно указать меньшей суммой зачисления.
 */
export function ReceivedField({ view, amountMinor, onChange, onUseSuggested, onFeeOpen, error }: ReceivedFieldProps) {
  const toSymbol = currencyInfo(view.to).symbol;

  if (view.mode === 'fee' && !view.show) {
    return (
      <div>
        <Button variant="ghost" onClick={() => onFeeOpen(true)}>
          Указать комиссию
        </Button>
      </div>
    );
  }

  const differs = view.suggested !== null && view.value !== view.suggested;
  const fee =
    view.mode === 'fee' && amountMinor !== null && view.value !== null && view.value > 0 && amountMinor > view.value
      ? amountMinor - view.value
      : null;

  return (
    <FieldGroup label={view.mode === 'fee' ? 'Получено (с учётом комиссии)' : `Получено, ${toSymbol}`}>
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
          По курсу 1&nbsp;{currencyInfo(view.from).symbol} = {formatRate(view.lookup.rate)}&nbsp;{toSymbol}
          {view.suggested !== null && <> получится ≈ {formatMinor(view.suggested, view.to)}</>}. Сумму можно изменить.
        </p>
      )}
      {view.mode === 'cross' && !view.lookup && (
        <p className="text-sm font-medium text-warning">
          Курса {currencyInfo(view.from).symbol} → {toSymbol} нет. Введите, сколько денег пришло на второй кошелёк.
        </p>
      )}
      {fee !== null && <p className="text-sm text-muted">Комиссия: {formatMinor(fee, view.from)}</p>}
      <div className="flex flex-wrap gap-2">
        {view.mode === 'cross' && differs && (
          <Button variant="ghost" onClick={onUseSuggested}>
            Подставить по курсу
          </Button>
        )}
        {view.mode === 'fee' && (
          <Button variant="ghost" onClick={() => onFeeOpen(false)}>
            Без комиссии
          </Button>
        )}
      </div>
    </FieldGroup>
  );
}
