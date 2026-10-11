import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import { formatMinor } from '@/domain/money';
import { FieldGroup } from './FieldGroup';
import { NO_FEE, type FeeMode } from './txForm';
import type { TxFormController } from './useTxFormController';

const MODES: readonly SegmentOption<FeeMode>[] = [
  { value: 'amount', label: 'Сумма' },
  { value: 'percent', label: 'Проценты' },
];

/** Мельче крупной суммы: это второе поле на экране. */
const SMALL = '[&_.money]:!text-3xl';

/**
 * Комиссия: суммой или процентом от суммы операции (процент пересчитывается сам, пока человек меняет сумму).
 * Расход: комиссия добавляется к списанию. Перевод между своими кошельками: вычитается из зачисления.
 */
export function FeeField({ c }: { c: TxFormController }) {
  const { form, errors, fee } = c;
  const isTransfer = form.kind === 'transfer';
  const percent = form.feeMode === 'percent';

  return (
    <FieldGroup label="Комиссия" error={errors.fee ?? null}>
      <Segmented ariaLabel="Как указать комиссию" options={MODES} value={form.feeMode} onChange={(feeMode) => c.set({ feeMode })} />
      {percent ? (
        <div className="flex items-center gap-2">
          <input
            aria-label="Комиссия в процентах"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="Например, 1,5"
            value={form.feePct}
            onChange={(e) => c.set({ feePct: e.target.value.replace(/[^\d.,\s]/g, '').slice(0, 8) })}
            className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-xl font-semibold outline-none focus:border-brand"
          />
          <span className="text-xl font-semibold text-muted" aria-hidden="true">
            %
          </span>
        </div>
      ) : (
        <AmountInput
          currency={c.currency}
          value={form.feeAmount}
          onChange={(feeAmount) => c.set({ feeAmount })}
          label="Комиссия"
          showKeypad={false}
          className={SMALL}
        />
      )}
      <div className="flex flex-col gap-0.5 text-sm text-muted" aria-live="polite">
        {percent && fee.minor !== null && fee.minor > 0 && <span>Комиссия: {formatMinor(fee.minor, c.currency)}</span>}
        {!isTransfer && fee.minor !== null && fee.minor > 0 && fee.total !== null && (
          <span className="font-semibold text-text">Итого спишется: {formatMinor(fee.total, c.currency)}</span>
        )}
        {isTransfer && c.received?.value != null && c.received.value > 0 && fee.minor !== null && fee.minor > 0 && (
          <span className="font-semibold text-text">Получит: {formatMinor(c.received.value, c.received.to)}</span>
        )}
      </div>
      <div>
        <Button variant="ghost" onClick={() => c.set({ ...NO_FEE })}>
          Без комиссии
        </Button>
      </div>
    </FieldGroup>
  );
}
