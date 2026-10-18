import { useEffect, useRef, type MutableRefObject } from 'react';
import { AmountInput, isCoarsePointer } from '@/components/AmountInput';
import type { KeypadKey } from '@/components/Keypad';
import { Icon } from '@/components/Icon';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import { formatMinor } from '@/domain/money';
import { NO_FEE, type FeeMode } from './txForm';
import type { TxFormController } from './useTxFormController';

// Видно «Сумма | %», а скринридер и тесты слышат прежнее «Проценты».
const MODES: readonly SegmentOption<FeeMode>[] = [
  { value: 'amount', label: 'Сумма' },
  { value: 'percent', label: '%', ariaLabel: 'Проценты' },
];

/** Поле суммы комиссии: тот же AmountInput (те же правила денег), только без крупной подписи и клавиш. */
const AMOUNT_BOX =
  '!gap-0 [&_.items-baseline]:!justify-start [&_.items-baseline]:!py-0 [&_.money]:!text-lg [&_span[aria-hidden]:last-child]:!text-base';

/**
 * Комиссия одной узкой строкой (≤ 48 px): [Сумма | %] [поле] [мелкая подсказка] [×].
 * Процент пересчитывается сам, пока человек меняет сумму операции.
 * Расход: комиссия добавляется к списанию. Перевод между своими кошельками: вычитается из зачисления.
 */
/** Клавиша экранной клавиатуры в поле процента: цифры, одна запятая, не длиннее 8 знаков, «стереть». */
export function applyPctKey(text: string, key: KeypadKey): string {
  if (key === 'backspace') return text.slice(0, -1);
  if (key === ',') return text.includes(',') || text.includes('.') ? text : `${text === '' ? '0' : text},`;
  if (/^\d$/.test(key) && text.length < 8) return text + key;
  return text;
}

export function FeeField({
  c,
  active = false,
  onActivate,
  onRemove,
  keyRef,
}: {
  c: TxFormController;
  /** Экранная клавиатура сейчас печатает в комиссию (рамка выделена). */
  active?: boolean;
  onActivate?: () => void;
  /** «Убрать комиссию»: снять комиссию и закрыть панель. */
  onRemove?: () => void;
  /** Сюда поле суммы комиссии отдаёт обработчик клавиш: экранная клавиатура суммы печатает прямо в него (телефон). */
  keyRef?: MutableRefObject<((key: KeypadKey) => void) | null>;
}) {
  const { form, errors, fee } = c;
  const isTransfer = form.kind === 'transfer';
  const percent = form.feeMode === 'percent';
  const pctRef = useRef<HTMLInputElement>(null);

  // Фокус без прокрутки: окно не должно прыгать, когда поле появляется.
  useEffect(() => {
    if (percent) pctRef.current?.focus({ preventScroll: true });
  }, [percent]);

  const hasFee = fee.minor !== null && fee.minor > 0;
  const feeText = hasFee ? formatMinor(fee.minor!, c.currency) : null;
  const totalText = !isTransfer && hasFee && fee.total !== null ? `Итого спишется: ${formatMinor(fee.total, c.currency)}` : null;
  const receivedText =
    isTransfer && hasFee && c.received?.value != null && c.received.value > 0
      ? `Получит: ${formatMinor(c.received.value, c.received.to)}`
      : null;

  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label="Комиссия" className="flex h-12 items-center gap-1.5">
        <Segmented
          compact
          ariaLabel="Как указать комиссию"
          options={MODES}
          value={form.feeMode}
          onChange={(feeMode) => c.set({ feeMode })}
          className="w-[120px] shrink-0"
        />
        {percent ? (
          <div
            className={`flex h-11 w-[68px] shrink-0 items-center rounded-xl border bg-surface pl-2 pr-1.5 focus-within:border-brand ${active ? 'border-brand ring-2 ring-brand/15' : 'border-border'}`}
            onClick={onActivate}
          >
            <input
              ref={pctRef}
              aria-label="Комиссия в процентах"
              // На телефоне вводим экранной клавиатурой: системная закрывала бы её и окно.
              inputMode={isCoarsePointer() ? 'none' : 'decimal'}
              onFocus={onActivate}
              autoComplete="off"
              placeholder="1,5"
              value={form.feePct}
              onChange={(e) => c.set({ feePct: e.target.value.replace(/[^\d.,\s]/g, '').slice(0, 8) })}
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted/60"
            />
            <span className="text-base font-semibold text-muted" aria-hidden="true">
              %
            </span>
          </div>
        ) : (
          <div
            className={`flex h-11 w-[96px] shrink-0 items-center overflow-hidden rounded-xl border bg-surface px-2 focus-within:border-brand ${active ? 'border-brand ring-2 ring-brand/15' : 'border-border'}`}
            onClick={onActivate}
          >
            <AmountInput
              currency={c.currency}
              value={form.feeAmount}
              onChange={(feeAmount) => c.set({ feeAmount })}
              label="Комиссия"
              showKeypad={false}
              noSystemKeyboard
              onActivate={onActivate}
              keyRef={keyRef}
              bare
              className={`w-full ${AMOUNT_BOX}`}
            />
          </div>
        )}
        <div
          className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden text-[11px] leading-[12px] text-muted"
          aria-live="polite"
        >
          {percent && feeText && <span aria-hidden="true">= {feeText}</span>}
          {percent && feeText && <span className="sr-only">Комиссия: {feeText}</span>}
          {totalText && (
            <>
              <span aria-hidden="true" className="font-semibold text-text">
                {totalText.replace('Итого спишется:', 'Итого')}
              </span>
              <span className="sr-only">{totalText}</span>
            </>
          )}
          {receivedText && (
            <>
              <span aria-hidden="true" className="font-semibold text-text">
                {receivedText.replace('Получит:', 'Получит')}
              </span>
              <span className="sr-only">{receivedText}</span>
            </>
          )}
        </div>
        <button
          type="button"
          aria-label="Убрать комиссию"
          title="Убрать комиссию"
          onClick={onRemove ?? (() => c.set({ ...NO_FEE }))}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      {errors.fee && (
        <p role="alert" className="text-sm font-medium text-danger">
          {errors.fee}
        </p>
      )}
    </div>
  );
}
