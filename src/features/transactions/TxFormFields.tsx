import { useState, type ReactNode } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import type { ChipOption } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import type { LocalRow, TxKind, Wallet } from '@/domain/types';
import { CategoryPicker } from './CategoryPicker';
import { ContextRow } from './ContextRow';
import { FeeField } from './FeeField';
import { FxNotice } from './FxNotice';
import { ReceivedField } from './ReceivedField';
import { NO_FEE, NOTE_MAX } from './txForm';
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

/** Круглая кнопка у края суммы (комиссия слева, заметка справа). */
function SideButton({
  label,
  active,
  side,
  dot,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  side: 'left' | 'right';
  dot?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={active}
      onClick={onClick}
      className={cn(
        'absolute top-0 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors',
        side === 'left' ? 'left-0' : 'right-0',
        active ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-muted hover:bg-surface-2',
      )}
    >
      {children}
      {dot && <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand" />}
    </button>
  );
}

/** Поля операции: вид, сумма, категория или перевод, кошелёк, дата, заметка. Состояние — в контроллере. */
export function TxFormFields({ c, wallets, categories }: TxFormFieldsProps) {
  const { form, errors } = c;
  const isTransfer = form.kind === 'transfer';
  const noteLength = form.note.trim().length;
  // Заметка скрыта, пока не понадобится: без неё операция целиком помещается в одно окно без прокрутки
  const [noteOpen, setNoteOpen] = useState(form.note !== '');
  const showNote = noteOpen || !!errors.note;
  // Комиссия: у расхода (новый) и у перевода в одной валюте; у перевода между валютами сумма зачисления задаётся курсом
  const feeAvailable = (form.kind === 'expense' && !c.editing) || (isTransfer && c.received?.mode === 'fee');
  const feeOpen = feeAvailable && (form.feeOpen || !!errors.fee);

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
          kind={form.kind === 'income' ? 'income' : 'expense'}
          value={form.categoryId}
          onChange={(categoryId) => c.set({ categoryId })}
          error={errors.category}
        />
      )}

      {feeOpen && <FeeField c={c} />}
      {showNote && (
        <TextInput
          label="Заметка"
          hint={noteLength > NOTE_MAX - 50 && noteLength <= NOTE_MAX ? `${noteLength} из ${NOTE_MAX}` : undefined}
          value={form.note}
          onChange={(e) => c.set({ note: e.target.value })}
          autoComplete="off"
          enterKeyHint="done"
          autoFocus={noteOpen && form.note === ''}
          placeholder="Например, хлеб и молоко"
          error={errors.note}
        />
      )}

      {/* Комиссия и заметка скрыты за кнопками по краям суммы: так всё окно помещается без прокрутки */}
      <div className="relative">
        {feeAvailable && (
          <SideButton
            label="Комиссия"
            active={feeOpen}
            side="left"
            onClick={() => c.set(form.feeOpen ? { ...NO_FEE } : { feeOpen: true })}
          >
            <span className="text-lg font-bold">%</span>
          </SideButton>
        )}
        <SideButton
          label="Заметка"
          active={showNote}
          side="right"
          onClick={() => setNoteOpen(true)}
          dot={form.note !== '' && !showNote}
        >
          <Icon name="edit" size={20} />
        </SideButton>
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
      </div>

      {isTransfer && c.received && c.received.mode === 'cross' && (
        <ReceivedField
          view={c.received}
          onChange={(v) => c.set({ toAmountOverride: v })}
          onUseSuggested={() => c.set({ toAmountOverride: undefined })}
          error={errors.toAmount}
        />
      )}
    </div>
  );
}
