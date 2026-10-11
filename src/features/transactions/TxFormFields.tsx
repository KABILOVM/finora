import { AmountInput } from '@/components/AmountInput';
import type { ChipOption } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import type { LocalRow, TxKind, Wallet } from '@/domain/types';
import { CategoryPicker } from './CategoryPicker';
import { ContextRow } from './ContextRow';
import { FxNotice } from './FxNotice';
import { ReceivedField } from './ReceivedField';
import { NOTE_MAX } from './txForm';
import type { TxFormController } from './useTxFormController';

const KINDS: readonly SegmentOption<TxKind>[] = [
  { value: 'expense', label: 'Расход', tone: 'expense' },
  { value: 'income', label: 'Доход', tone: 'income' },
  { value: 'transfer', label: 'Перевод', tone: 'brand' },
];

/**
 * Невысокий экран (iPhone в Safari с панелями): клавиши и поле суммы чуть компактнее, чтобы цифры и категории помещались
 * без прокрутки. Высота клавиш не меньше 44 px — это минимум для касания. Диапазоны высоты не пересекаются.
 */
const COMPACT_KEYPAD =
  '[@media(min-height:701px)_and_(max-height:800px)]:[&_button]:!min-h-[48px] ' +
  '[@media(max-height:700px)]:[&_button]:!min-h-[44px] [@media(max-height:700px)]:!gap-1 ' +
  '[@media(max-height:700px)]:[&_.items-baseline]:!py-0 [@media(max-height:700px)]:[&_.money]:!text-4xl';

export interface TxFormFieldsProps {
  c: TxFormController;
  /** Кошельки для выбора (в правке — вместе с текущим архивным). */
  wallets: readonly LocalRow<Wallet>[];
  /** Категории нужного вида, уже упорядоченные: самые частые первыми. */
  categories: readonly ChipOption[];
}

/** Поля операции: вид, сумма, категория или перевод, кошелёк, дата, заметка. Состояние — в контроллере. */
export function TxFormFields({ c, wallets, categories }: TxFormFieldsProps) {
  const { form, errors } = c;
  const isTransfer = form.kind === 'transfer';
  const noteLength = form.note.trim().length;

  return (
    <div className="flex flex-col gap-3 md:gap-5">
      <Segmented ariaLabel="Вид операции" options={KINDS} value={form.kind} onChange={c.setKind} />

      {/* Кошелёк и дата видны над клавиатурой: человек всегда знает, куда запишется операция */}
      <div className="flex flex-col gap-3">
        <ContextRow c={c} wallets={wallets} />
        <FxNotice
          fx={c.fx}
          amountMinor={form.amountMinor}
          rateText={form.rateText}
          onRateText={(rateText) => c.set({ rateText })}
          error={errors.rate}
        />
      </div>

      {/* Категории — тоже над клавиатурой: чипы и цифры помещаются на одном экране телефона */}
      {!isTransfer && (
        <CategoryPicker
          options={categories}
          value={form.categoryId}
          onChange={(categoryId) => c.set({ categoryId })}
          error={errors.category}
        />
      )}

      <AmountInput
        currency={c.currency}
        value={form.amountMinor}
        onChange={(v) => c.set({ amountMinor: v })}
        label={isTransfer ? 'Сумма списания' : 'Сумма'}
        tone={form.kind === 'expense' ? 'expense' : form.kind === 'income' ? 'income' : 'neutral'}
        error={errors.amount}
        className={COMPACT_KEYPAD}
        autoFocus
      />

      {isTransfer && c.received && (
        <ReceivedField
          view={c.received}
          amountMinor={form.amountMinor}
          onChange={(v) => c.set({ toAmountOverride: v })}
          onUseSuggested={() => c.set({ toAmountOverride: undefined })}
          onFeeOpen={(open) => c.set({ feeOpen: open, toAmountOverride: undefined })}
          error={errors.toAmount}
        />
      )}

      <TextInput
        label="Заметка"
        hint={noteLength > NOTE_MAX - 50 && noteLength <= NOTE_MAX ? `${noteLength} из ${NOTE_MAX}` : 'Необязательно'}
        value={form.note}
        onChange={(e) => c.set({ note: e.target.value })}
        autoComplete="off"
        enterKeyHint="done"
        placeholder="Например, хлеб и молоко"
        error={errors.note}
      />
    </div>
  );
}
