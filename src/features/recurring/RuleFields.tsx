import { useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { ChipPicker, type ChipOption } from '@/components/ChipPicker';
import { Field, inputClasses } from '@/components/Field';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import type { CurrencyCode, Debt, LocalRow, Minor, TxKind, Wallet } from '@/domain/types';
import { CategoryPicker } from '@/features/transactions/CategoryPicker';
import { walletOptions } from '@/features/transactions/ContextRow';
import { NOTE_MAX } from '@/features/transactions/txForm';
import type { ReceivedView } from '@/features/transactions/useTxFormController';
import type { RuleFormErrors, RuleFormState } from '@/recurring/ruleForm';
import { ReceivedPart } from './ReceivedPart';
import { RulePill } from './RulePill';

const KINDS: readonly SegmentOption<TxKind>[] = [
  { value: 'expense', label: 'Расход', tone: 'expense' },
  { value: 'income', label: 'Доход', tone: 'income' },
  { value: 'transfer', label: 'Перевод', tone: 'brand' },
];

const NO_DEBT = 'none';

/** Ряд категорий в окне платежа никогда не едет вбок: чипы переносятся на новые строки (первые 6 + «Ещё N»). */
const WRAP_CATEGORIES =
  '[&_[role=group]]:!mx-0 [&_[role=group]]:!flex-wrap [&_[role=group]]:!overflow-x-visible [&_[role=group]]:!px-0 [&_[role=group]]:!pb-0 ' +
  '[&_[role=group]_button]:max-w-full [&_[role=group]_button>span:last-child]:min-w-0 [&_[role=group]_button>span:last-child]:truncate';

/** Длинное название (кошелёк, долг) в чипе сокращается многоточием, а не растягивает окно вбок. */
export const FIT_CHIPS = '[&_button]:max-w-full [&_button>span:last-child]:min-w-0 [&_button>span:last-child]:truncate';

/**
 * Невысокий экран: клавиши чуть ниже (не меньше 44 px — минимум для касания), как в окне «Новая операция».
 * Шрифт суммы уменьшает сам AmountInput (проп compact): так длинная сумма по-прежнему мельчает по длине.
 */
const COMPACT_KEYPAD =
  '[@media(min-height:701px)_and_(max-height:800px)]:[&_button]:!min-h-[48px] ' +
  '[@media(max-height:700px)]:[&_button]:!min-h-[44px] [@media(max-height:700px)]:!gap-1 ' +
  '[@media(max-height:700px)]:[&_.items-baseline]:!py-0';

type Panel = 'wallet' | 'toWallet' | 'debt' | null;

export interface RuleFieldsProps {
  form: RuleFormState;
  errors: RuleFormErrors;
  /** Кошельки, которые можно выбрать (без архивных, кроме уже выбранного). */
  wallets: readonly LocalRow<Wallet>[];
  /** Категории нужного вида, уже упорядоченные (порядок задаёт вызывающий код). */
  categories: readonly ChipOption[];
  /** Долги, которые можно выбрать (открытые и не в архиве, плюс уже выбранный). */
  debts: readonly LocalRow<Debt>[];
  received: ReceivedView | null;
  currency: CurrencyCode;
  onChange: (patch: Partial<RuleFormState>) => void;
  onAmount: (value: Minor | null) => void;
  onKind: (kind: TxKind) => void;
  onWallet: (id: string) => void;
  onToWallet: (id: string) => void;
}

/** Поля платежа: вид, кошельки и долг (пилюли со списком), категория, сумма с клавиатурой, «Получено», заметка. */
export function RuleFields(p: RuleFieldsProps) {
  const { form, errors } = p;
  const [panel, setPanel] = useState<Panel>(null);
  const isTransfer = form.kind === 'transfer';
  const options = walletOptions(p.wallets);
  const toOptions = options.filter((o) => o.value !== form.walletId);
  const noteLength = form.note.trim().length;
  const debtOptions: ChipOption[] = [
    { value: NO_DEBT, label: 'Не по долгу' },
    ...p.debts.map((d) => ({ value: d.id, icon: '🤝', label: `${d.counterparty} · ${d.currency}` })),
  ];
  const wallet = p.wallets.find((w) => w.id === form.walletId);
  const toWallet = p.wallets.find((w) => w.id === form.toWalletId);
  const labelOf = (list: readonly ChipOption[], id: string | null) => list.find((o) => o.value === id)?.label ?? 'не выбран';
  const hasDebts = !isTransfer && p.debts.length > 0;
  const debtLabel = form.debtId === null ? 'Не по долгу' : (debtOptions.find((o) => o.value === form.debtId)?.label ?? 'Не по долгу');

  // Ошибка у скрытого списка не должна теряться: список с ошибкой раскрыт сам
  const show: Panel = errors.wallet ? 'wallet' : errors.toWallet ? 'toWallet' : errors.debt && hasDebts ? 'debt' : panel;
  const toggle = (x: Exclude<Panel, null>) => setPanel((cur) => (cur === x ? null : x));
  const walletName = labelOf(options, form.walletId);
  const toName = labelOf(options, form.toWalletId);

  return (
    <div className="flex flex-col gap-3">
      <Segmented ariaLabel="Вид платежа" options={KINDS} value={form.kind} onChange={p.onKind} />

      {options.length === 0 ? (
        <p className="text-sm font-medium text-warning">Сначала создайте кошелёк на экране «Кошельки».</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <RulePill
              icon={wallet?.icon ?? '👛'}
              color={wallet?.color}
              label={walletName}
              ariaLabel={`${isTransfer ? 'Откуда' : 'Кошелёк'}: ${walletName}`}
              open={show === 'wallet'}
              invalid={!!errors.wallet}
              onClick={() => toggle('wallet')}
            />
            {isTransfer && toOptions.length > 0 && (
              <RulePill
                icon={toWallet?.icon ?? '👛'}
                color={toWallet?.color}
                label={toName}
                ariaLabel={`Куда: ${toName}`}
                open={show === 'toWallet'}
                invalid={!!errors.toWallet}
                onClick={() => toggle('toWallet')}
              />
            )}
            {hasDebts && (
              <RulePill
                icon="🤝"
                label={debtLabel}
                ariaLabel={`Платёж по долгу: ${debtLabel}`}
                open={show === 'debt'}
                invalid={!!errors.debt}
                onClick={() => toggle('debt')}
              />
            )}
          </div>
          {isTransfer && toOptions.length === 0 && (
            <p className="text-sm font-medium text-warning">Для перевода нужен второй кошелёк. Создайте его на экране «Кошельки».</p>
          )}
          {show === 'wallet' && (
            <ChipPicker
              className={FIT_CHIPS}
              ariaLabel={isTransfer ? 'Откуда' : 'Кошелёк'}
              options={options}
              value={form.walletId}
              onChange={(id) => {
                p.onWallet(id);
                setPanel(null);
              }}
            />
          )}
          {show === 'toWallet' && (
            <ChipPicker
              className={FIT_CHIPS}
              ariaLabel="Куда"
              options={toOptions}
              value={form.toWalletId}
              onChange={(id) => {
                p.onToWallet(id);
                setPanel(null);
              }}
            />
          )}
          {show === 'debt' && (
            <ChipPicker
              className={FIT_CHIPS}
              ariaLabel="Платёж по долгу"
              options={debtOptions}
              value={form.debtId ?? NO_DEBT}
              onChange={(v) => {
                p.onChange({ debtId: v === NO_DEBT ? null : v });
                setPanel(null);
              }}
            />
          )}
          {[errors.wallet, errors.toWallet, hasDebts ? errors.debt : undefined].map(
            (e, i) =>
              e && (
                <p key={i} role="alert" className="text-sm font-medium text-danger">
                  {e}
                </p>
              ),
          )}
        </div>
      )}

      {!isTransfer && (
        <div className={WRAP_CATEGORIES}>
          <CategoryPicker
            kind={form.kind === 'income' ? 'income' : 'expense'}
            options={p.categories}
            value={form.categoryId}
            onChange={(categoryId) => p.onChange({ categoryId })}
            error={errors.category}
          />
        </div>
      )}

      {isTransfer && p.received && (
        <ReceivedPart
          view={p.received}
          amountMinor={form.amountMinor}
          onChange={(v) => p.onChange({ receivedOverride: v })}
          onUseSuggested={() => p.onChange({ receivedOverride: undefined })}
          onFeeOpen={(open: boolean) => p.onChange({ feeOpen: open, receivedOverride: undefined })}
          error={errors.toAmount}
        />
      )}

      <AmountInput
        currency={p.currency}
        value={form.amountMinor}
        onChange={p.onAmount}
        label={isTransfer ? 'Сумма списания' : 'Сумма'}
        tone={form.kind === 'expense' ? 'expense' : form.kind === 'income' ? 'income' : 'neutral'}
        error={errors.amount}
        className={COMPACT_KEYPAD}
        compact
      />

      <Field
        id="rule-note"
        label="Название или заметка"
        hint={noteLength > NOTE_MAX - 50 && noteLength <= NOTE_MAX ? `${noteLength} из ${NOTE_MAX}` : undefined}
        error={errors.note}
        className="[&>label]:sr-only"
      >
        <input
          id="rule-note"
          value={form.note}
          onChange={(e) => p.onChange({ note: e.target.value })}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Название, например: Аренда"
          aria-invalid={errors.note ? true : undefined}
          className={`${inputClasses(!!errors.note)} min-h-[44px]`}
        />
      </Field>
    </div>
  );
}
