import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AmountInput, isCoarsePointer } from '@/components/AmountInput';
import type { KeypadKey } from '@/components/Keypad';
import { Button } from '@/components/Button';
import { Floating, useDismiss } from '@/components/Floating';
import { Icon } from '@/components/Icon';
import { isOpKey } from '@/components/amountExpr';
import { applyKey, draftToMinor, minorToDraft, type AmountKey } from '@/components/amountText';
import { cn } from '@/lib/cn';
import type { ChipOption } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import type { LocalRow, TxKind, Wallet } from '@/domain/types';
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
  // Комиссия и заметка живут во всплывающих панелях над суммой: в форме не появляется ни новых полей, ни прокрутки
  const [noteOpen, setNoteOpen] = useState(false);
  const showNote = noteOpen || !!errors.note;
  const [feePanel, setFeePanel] = useState(false);
  // Комиссия: у расхода (новый) и у перевода в одной валюте; у перевода между валютами сумма зачисления задаётся курсом
  const feeAvailable = (form.kind === 'expense' && !c.editing) || (isTransfer && c.received?.mode === 'fee');
  const feeShown = feeAvailable && ((feePanel && form.feeOpen) || !!errors.fee);
  const hasFee = feeAvailable && form.feeOpen && c.fee.minor !== null && c.fee.minor > 0;

  const closeFee = () => {
    setFeePanel(false);
    // пустую комиссию не оставляем: иначе она тихо останется «включённой»
    if (form.feeOpen && !hasFee && !errors.fee) c.set({ ...NO_FEE });
  };
  const removeFee = () => {
    setFeePanel(false);
    c.set({ ...NO_FEE });
  };
  const toggleFee = () => {
    if (feeShown) return closeFee();
    setNoteOpen(false);
    if (!form.feeOpen) c.set({ feeOpen: true });
    setFeePanel(true);
  };
  const toggleNote = () => {
    if (showNote) return setNoteOpen(false);
    if (feeShown) closeFee();
    setNoteOpen(true);
  };
  // Тап мимо закрывает панель; клавиатура суммы и сама сумма «свои»: тапы по ним панель не закрывают
  const amountBoxRef = useRef<HTMLDivElement>(null);
  useDismiss(feeShown && !errors.fee, closeFee, amountBoxRef);
  useDismiss(noteOpen && !errors.note, () => setNoteOpen(false), amountBoxRef);

  // Процент комиссии вводится той же экранной клавиатурой, что и сумма: куда печатает клавиатура, показывает рамка поля.
  const [target, setTarget] = useState<'amount' | 'fee'>('amount');
  const percentOpen = feeShown && form.feeMode === 'percent';
  // Поле комиссии (и сумма, и процент) при открытии получает экранную клавиатуру; к основной сумме возвращает нажатие на неё.
  useEffect(() => setTarget(feeShown ? 'fee' : 'amount'), [feeShown, form.feeMode]);
  // На телефоне комиссию печатает экранная клавиатура; на компьютере остаётся физическая, а экранные клавиши — для суммы.
  const [coarse] = useState(isCoarsePointer);
  const feeTyping = coarse && feeShown && target === 'fee';
  const feeKey = (key: KeypadKey): boolean => {
    if (!feeTyping) return false;
    if (isOpKey(key) || key === '=') return true;
    if (percentOpen) c.set({ feePct: applyPctKey(form.feePct, key) });
    else {
      const next = applyKey(minorToDraft(form.feeAmount, c.currency), key as AmountKey, c.currency);
      c.set({ feeAmount: draftToMinor(next, c.currency) });
    }
    return true;
  };

  return (
    <div className="flex flex-col gap-3 md:gap-5">
      <Segmented ariaLabel="Вид операции" options={KINDS} value={form.kind} onChange={c.setKind} />

      {/* Кошелёк и дата видны над клавиатурой: человек всегда знает, куда запишется операция */}
      <div className="flex flex-col gap-3">
        <ContextRow c={c} wallets={wallets} categories={isTransfer ? [] : categories} />
        <FxNotice
          fx={c.fx}
          amountMinor={form.amountMinor}
          rateText={form.rateText}
          onRateText={(rateText) => c.set({ rateText })}
          error={errors.rate}
        />
      </div>

      {/* Комиссия и заметка — за кнопками по краям суммы и всплывают поверх формы */}
      <div ref={amountBoxRef}>
        <AmountInput
          currency={c.currency}
          value={form.amountMinor}
          onChange={(v) => c.set({ amountMinor: v })}
          label={isTransfer ? 'Сумма списания' : 'Сумма'}
          tone={form.kind === 'expense' ? 'expense' : form.kind === 'income' ? 'income' : 'neutral'}
          error={errors.amount}
          className={COMPACT_KEYPAD}
          calculator
          autoFocus
          start={
            feeAvailable ? (
              <SideButton label="Комиссия" active={feeShown || hasFee} onClick={toggleFee} dot={hasFee && !feeShown}>
                <span className="text-lg font-bold">%</span>
              </SideButton>
            ) : undefined
          }
          end={
            <SideButton label="Заметка" active={showNote} onClick={toggleNote} dot={form.note !== '' && !showNote}>
              <Icon name="edit" size={20} />
            </SideButton>
          }
          overlay={
            feeShown ? (
              <Floating side="above">
                <FeeField c={c} active={feeTyping} onActivate={() => setTarget('fee')} onRemove={removeFee} />
              </Floating>
            ) : showNote ? (
              <Floating side="above">
                <div className="flex flex-col gap-2 p-1">
                  <TextInput
                    label="Заметка"
                    hint={noteLength > NOTE_MAX - 50 && noteLength <= NOTE_MAX ? `${noteLength} из ${NOTE_MAX}` : undefined}
                    value={form.note}
                    onChange={(e) => c.set({ note: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setNoteOpen(false);
                      }
                    }}
                    autoComplete="off"
                    enterKeyHint="done"
                    autoFocus
                    placeholder="Например, хлеб и молоко"
                    error={errors.note}
                  />
                  <Button size="md" fullWidth onClick={() => setNoteOpen(false)}>
                    Готово
                  </Button>
                </div>
              </Floating>
            ) : undefined
          }
          active={feeTyping ? false : undefined}
          onActivate={() => setTarget('amount')}
          onKeyIntercept={feeKey}
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
