import { AmountInput } from '@/components/AmountInput';
import { ChipPicker, type ChipOption } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import type { CurrencyCode, Debt, LocalRow, Minor, TxKind, Wallet } from '@/domain/types';
import { CategoryPicker } from '@/features/transactions/CategoryPicker';
import { walletOptions } from '@/features/transactions/ContextRow';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { NOTE_MAX } from '@/features/transactions/txForm';
import type { ReceivedView } from '@/features/transactions/useTxFormController';
import type { RuleFormErrors, RuleFormState } from '@/recurring/ruleForm';
import { ReceivedPart } from './ReceivedPart';

const KINDS: readonly SegmentOption<TxKind>[] = [
  { value: 'expense', label: 'Расход', tone: 'expense' },
  { value: 'income', label: 'Доход', tone: 'income' },
  { value: 'transfer', label: 'Перевод', tone: 'brand' },
];

const NO_DEBT = 'none';

export interface RuleFieldsProps {
  form: RuleFormState;
  errors: RuleFormErrors;
  /** Кошельки, которые можно выбрать (без архивных, кроме уже выбранного). */
  wallets: readonly LocalRow<Wallet>[];
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

/** Поля платежа: вид, кошельки, сумма, «Получено», категория, платёж по долгу, заметка. */
export function RuleFields(p: RuleFieldsProps) {
  const { form, errors } = p;
  const isTransfer = form.kind === 'transfer';
  const options = walletOptions(p.wallets);
  const toOptions = options.filter((o) => o.value !== form.walletId);
  const noteLength = form.note.trim().length;
  const debtOptions: ChipOption[] = [
    { value: NO_DEBT, label: 'Не по долгу' },
    ...p.debts.map((d) => ({ value: d.id, icon: '🤝', label: `${d.counterparty} · ${d.currency}` })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Segmented ariaLabel="Вид платежа" options={KINDS} value={form.kind} onChange={p.onKind} />

      <FieldGroup label={isTransfer ? 'Откуда' : 'Кошелёк'} error={errors.wallet}>
        {options.length > 0 ? (
          <ChipPicker
            ariaLabel={isTransfer ? 'Откуда' : 'Кошелёк'}
            options={options}
            value={form.walletId}
            onChange={p.onWallet}
          />
        ) : (
          <p className="text-sm font-medium text-warning">Сначала создайте кошелёк на экране «Кошельки».</p>
        )}
      </FieldGroup>

      {isTransfer && (
        <FieldGroup label="Куда" error={errors.toWallet}>
          {toOptions.length > 0 ? (
            <ChipPicker ariaLabel="Куда" options={toOptions} value={form.toWalletId} onChange={p.onToWallet} />
          ) : (
            <p className="text-sm font-medium text-warning">Для перевода нужен второй кошелёк. Создайте его на экране «Кошельки».</p>
          )}
        </FieldGroup>
      )}

      <FieldGroup label={isTransfer ? 'Сумма списания' : 'Сумма'}>
        <AmountInput
          currency={p.currency}
          value={form.amountMinor}
          onChange={p.onAmount}
          label={isTransfer ? 'Сумма списания' : 'Сумма'}
          tone={form.kind === 'expense' ? 'expense' : form.kind === 'income' ? 'income' : 'neutral'}
          showKeypad={false}
          error={errors.amount}
        />
      </FieldGroup>

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

      {!isTransfer && (
        <CategoryPicker kind={form.kind === 'income' ? 'income' : 'expense'} options={p.categories} value={form.categoryId} onChange={(categoryId) => p.onChange({ categoryId })} error={errors.category} />
      )}

      {!isTransfer && p.debts.length > 0 && (
        <FieldGroup label="Платёж по долгу" hint="можно не выбирать" error={errors.debt}>
          <ChipPicker
            ariaLabel="Платёж по долгу"
            options={debtOptions}
            value={form.debtId ?? NO_DEBT}
            onChange={(v) => p.onChange({ debtId: v === NO_DEBT ? null : v })}
          />
        </FieldGroup>
      )}

      <TextInput
        label="Название или заметка"
        hint={noteLength > NOTE_MAX - 50 && noteLength <= NOTE_MAX ? `${noteLength} из ${NOTE_MAX}` : 'Так платёж подписан в списке. Например: Аренда'}
        value={form.note}
        onChange={(e) => p.onChange({ note: e.target.value })}
        autoComplete="off"
        enterKeyHint="done"
        error={errors.note}
      />
    </div>
  );
}
