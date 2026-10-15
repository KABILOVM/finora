import { useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, newId, useSettings, useStore, useWallets } from '@/db';
import type { DebtState } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, Debt, IsoDate, LocalRow, Minor } from '@/domain/types';
import { rankWallets, usePopularity } from '@/features/transactions/popularity';
import { endSentence } from '@/features/transactions/txDisplay';
import { NOTE_MAX } from '@/features/transactions/txForm';
import { addDays, todayLocal } from '@/lib/dates';
import { saveTopUp } from './debtActions';
import { validateTopUp, type TopUpFormErrors } from './debtForm';
import { TOP_UP_ACTION, TOP_UP_AMOUNT_LABEL } from './debtText';
import { DayField, DueField } from './DebtDates';
import { DebtMoneySection } from './DebtMoneySection';
import { useWalletFx } from './useWalletFx';

export interface TopUpSheetProps {
  debt: LocalRow<Debt>;
  state: DebtState;
  base: CurrencyCode;
  onClose: () => void;
}

/**
 * «Добавить ещё в долг»: тому же человеку дали (или у него взяли) ещё. Сумма долга растёт, а деньги по желанию проходят через кошелёк
 * той же валюты — как обычная выдача или получение (в доходы и расходы месяца они не входят). Закрытый долг после этого открывается снова.
 */
export function TopUpSheet({ debt, state, base, onClose }: TopUpSheetProps) {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets();
  const settings = useSettings();

  const [amount, setAmount] = useState<Minor | null>(null);
  const [wanted, setWanted] = useState(true);
  const [walletPick, setWalletPick] = useState<string | null>(null);
  const [date, setDate] = useState<IsoDate>(() => todayLocal());
  const [hasDue, setHasDue] = useState(debt.dueOn !== null);
  const [dueOn, setDueOn] = useState<IsoDate>(() => debt.dueOn ?? addDays(todayLocal(), 30));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<TopUpFormErrors & { form?: string; rate?: string }>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const txId = useRef(newId());

  const pop = usePopularity();
  const candidates = (wallets ?? []).filter((w) => w.currency === debt.currency);
  const defaultWalletId = settings?.defaultWalletId ?? null;
  const walletId =
    candidates.find((w) => w.id === walletPick)?.id ??
    candidates.find((w) => w.id === defaultWalletId)?.id ??
    candidates[0]?.id ??
    null;
  const moneyOn = wanted && candidates.length > 0 && walletId !== null;
  const wallet = candidates.find((w) => w.id === walletId);
  const fx = useWalletFx(moneyOn ? wallet?.currency : undefined, base);

  if (wallets === undefined || settings === undefined || pop === undefined) return null;

  const clear = (...keys: (keyof typeof errors)[]) =>
    setErrors((e) => {
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });

  const save = async () => {
    if (busy.current) return;
    // Срок меняем, только если человек его тронул: «Без срока» у долга со сроком снимает срок, указанный — переносит.
    // Прежний срок (даже просроченный) с датой пополнения не сверяем: он не менялся.
    const newDue = hasDue ? dueOn : null;
    const dueChanged = newDue !== debt.dueOn;
    const v = validateTopUp({ amountMinor: amount, moneyOn, walletId, date, note, openedOn: debt.openedOn, hasDue: hasDue && dueChanged, dueOn });
    if (!v.ok || amount === null) return setErrors(v.errors);
    let resolved: ReturnType<typeof fx.resolve> | null = null;
    if (moneyOn) {
      resolved = fx.resolve();
      if (!resolved.ok) return setErrors({ rate: resolved.error });
    }
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      await saveTopUp(store, {
        debtId: debt.id,
        direction: debt.direction,
        amountMinor: amount,
        occurredOn: date,
        note,
        ...(dueChanged ? { dueOn: newDue } : {}),
        movement:
          moneyOn && walletId !== null
            ? { walletId, txId: txId.current, ...(resolved?.ok && resolved.fx ? { fx: resolved.fx } : {}) }
            : null,
      });
      if (resolved?.ok) resolved.remember();
      toast.success(moneyOn ? 'Добавлено к долгу, деньги учтены в кошельке' : 'Добавлено к долгу «на бумаге»');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors({ form: e.message });
      else {
        console.error('Не удалось добавить к долгу:', e);
        setErrors({ form: 'Не удалось добавить к долгу. Данные не изменены, попробуйте ещё раз.' });
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const grown = amount !== null && amount > 0 && Number.isSafeInteger(state.principalMinor + amount) ? state.principalMinor + amount : null;

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={TOP_UP_ACTION[debt.direction]}
      footer={
        <div className="flex flex-col gap-2">
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()}>
            Добавить к долгу
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-muted">
          {debt.counterparty}: сумма долга сейчас <span className="money font-semibold text-text">{formatMinor(state.principalMinor, debt.currency)}</span>, остаток{' '}
          <span className="money font-semibold text-text">{formatMinor(state.remainingMinor, debt.currency)}</span>.
          {debt.closedAt !== null && ' Долг закрыт — после пополнения он откроется снова.'}
        </p>

        <div className="flex flex-col gap-1">
          <AmountInput
            label={TOP_UP_AMOUNT_LABEL[debt.direction]}
            currency={debt.currency}
            value={amount}
            error={errors.amount}
            tone={debt.direction === 'lent' ? 'expense' : 'income'}
            onChange={(v) => {
              setAmount(v);
              clear('amount', 'form');
            }}
          />
          {grown !== null && (
            <p className="text-center text-sm text-muted">Сумма долга станет {endSentence(formatMinor(grown, debt.currency))}</p>
          )}
        </div>

        <DayField
          label="Дата пополнения"
          value={date}
          onChange={(d) => {
            setDate(d);
            clear('date', 'dueOn', 'form');
          }}
          error={errors.date}
        />
        <DueField
          hasDue={hasDue}
          dueOn={dueOn}
          openedOn={debt.openedOn}
          error={errors.dueOn}
          onChange={(p) => {
            if (p.hasDue !== undefined) {
              setHasDue(p.hasDue);
              if (p.hasDue && dueOn < date) setDueOn(addDays(date, 30)); // срок не раньше пополнения
            }
            if (p.dueOn !== undefined) setDueOn(p.dueOn);
            clear('dueOn', 'form');
          }}
        />
        <TextInput
          label="Заметка"
          hint={note.trim().length > NOTE_MAX - 50 ? `${note.trim().length} из ${NOTE_MAX}` : 'Необязательно'}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            clear('note');
          }}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Например, ещё на запчасти"
          error={errors.note}
        />

        <DebtMoneySection
          topUp
          direction={debt.direction}
          currency={debt.currency}
          amountMinor={amount}
          candidates={rankWallets(candidates, pop)}
          wanted={wanted}
          onWanted={setWanted}
          walletId={walletId}
          onWallet={(id) => {
            setWalletPick(id);
            clear('wallet', 'form');
          }}
          fx={fx}
          fxError={errors.rate}
          walletError={errors.wallet}
        />
      </div>
    </Sheet>
  );
}
