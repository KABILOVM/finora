import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AmountInput, isCoarsePointer } from '@/components/AmountInput';
import type { KeypadKey } from '@/components/Keypad';
import { Icon } from '@/components/Icon';
import { isOpKey } from '@/components/amountExpr';
import { cn } from '@/lib/cn';
import type { ChipOption } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import type { LocalRow, TxKind, Wallet } from '@/domain/types';
import { CategoryPicker } from './CategoryPicker';
import { ContextRow } from './ContextRow';
import { FeeField, applyPctKey } from './FeeField';
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
  '[@media(min-height:701px)_and_(max-height:800px)]:[&_button:not([data-op]):not([data-side])]:!min-h-[46px] ' +
  '[@media(min-height:701px)_and_(max-height:800px)]:[&_[data-op]]:!h-8 [@media(min-height:701px)_and_(max-height:800px)]:[&_.items-baseline]:!py-1 [@media(min-height:701px)_and_(max-height:800px)]:!gap-3 ' +
  '[@media(max-height:700px)]:[&_button:not([data-op]):not([data-side])]:!min-h-[44px] [@media(max-height:700px)]:[&_[data-op]]:!h-8 [@media(max-height:700px)]:!gap-1 ' +
  '[@media(max-height:700px)]:[&_.items-baseline]:!py-0 [@media(max-height:700px)]:[&_.money]:!text-4xl';

/**
 * Комиссия открыта: строка в 44–48 px появляется над клавишами, а окно не должно ни расти, ни прокручиваться.
 * Поэтому клавиши и поле суммы чуть ужимаются (на низком экране — до 40 px), на высоком — остаются крупнее.
 * Селекторы те же, что в COMPACT_KEYPAD, но правила целиком заменяют его.
 */
const FEE_KEYPAD =
  '[&_button:not([data-op]):not([data-side])]:!min-h-[44px] [&_[data-amount-card]]:!min-h-[38px] [&_[data-op]]:!h-[30px] [&_[role=group]]:!gap-1 [&_[data-pad]]:!gap-1 !gap-1 [&_.items-baseline]:!py-0 [&_.money]:!text-3xl ' +
  '[@media(min-height:701px)_and_(max-height:800px)]:[&_button:not([data-op]):not([data-side])]:!min-h-[44px] ' +
  '[@media(min-height:801px)]:[&_button:not([data-op]):not([data-side])]:!min-h-[50px] [@media(min-height:801px)]:[&_[role=group]]:!gap-1.5 [@media(min-height:801px)]:[&_[data-pad]]:!gap-1.5 ' +
  '[@media(max-height:700px)]:[&_button:not([data-op]):not([data-side])]:!min-h-[40px]';

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
  dot,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
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
      data-side=""
      onClick={onClick}
      className={cn(
        'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
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

  // Процент комиссии вводится той же экранной клавиатурой, что и сумма: куда печатает клавиатура, показывает рамка поля.
  const [target, setTarget] = useState<'amount' | 'fee'>('amount');
  const percentOpen = feeOpen && form.feeMode === 'percent';
  useEffect(() => setTarget(percentOpen ? 'fee' : 'amount'), [percentOpen]);
  // На телефоне процент печатает экранная клавиатура; на компьютере остаётся физическая, а экранные клавиши — для суммы.
  const [coarse] = useState(isCoarsePointer);
  const pctTyping = coarse && percentOpen && target === 'fee';
  const feeKey = (key: KeypadKey): boolean => {
    if (!pctTyping) return false;
    if (!isOpKey(key) && key !== '=') c.set({ feePct: applyPctKey(form.feePct, key) });
    return true;
  };

  // Высота формы без комиссии запоминается: с комиссией окно не должно становиться ни выше, ни ниже.
  const rootRef = useRef<HTMLDivElement>(null);
  const closedHeight = useRef(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (feeOpen) {
      if (closedHeight.current > 0) el.style.minHeight = `${closedHeight.current}px`;
      return;
    }
    el.style.minHeight = '';
    closedHeight.current = el.offsetHeight;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      closedHeight.current = el.offsetHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [feeOpen]);

  return (
    <div ref={rootRef} className={cn('flex flex-col gap-3 md:gap-5', feeOpen && '[@media(max-height:700px)]:gap-1.5')}>
      <Segmented
        ariaLabel="Вид операции"
        options={KINDS}
        value={form.kind}
        onChange={c.setKind}
        className={feeOpen ? '[@media(max-height:700px)]:[&_button:not([data-op]):not([data-side])]:!min-h-[40px]' : undefined}
      />

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

      {feeOpen && <FeeField c={c} pctActive={pctTyping} onPctActivate={() => setTarget('fee')} />}
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
      <AmountInput
        currency={c.currency}
        value={form.amountMinor}
        onChange={(v) => c.set({ amountMinor: v })}
        label={isTransfer ? 'Сумма списания' : 'Сумма'}
        tone={form.kind === 'expense' ? 'expense' : form.kind === 'income' ? 'income' : 'neutral'}
        error={errors.amount}
        className={feeOpen ? FEE_KEYPAD : COMPACT_KEYPAD}
        calculator
        autoFocus
        start={
          feeAvailable ? (
            <SideButton label="Комиссия" active={feeOpen} onClick={() => c.set(form.feeOpen ? { ...NO_FEE } : { feeOpen: true })}>
              <span className="text-lg font-bold">%</span>
            </SideButton>
          ) : undefined
        }
        end={
          <SideButton label="Заметка" active={showNote} onClick={() => setNoteOpen(true)} dot={form.note !== '' && !showNote}>
            <Icon name="edit" size={20} />
          </SideButton>
        }
        active={pctTyping ? false : undefined}
        onActivate={() => setTarget('amount')}
        onKeyIntercept={feeKey}
      />

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
