import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, newId, useSettings, useStore, useWallets } from '@/db';
import type { DebtState } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, Debt, IsoDate, LocalRow, Minor } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { FxNotice } from '@/features/transactions/FxNotice';
import { endSentence } from '@/features/transactions/txDisplay';
import { NOTE_MAX } from '@/features/transactions/txForm';
import { todayLocal } from '@/lib/dates';
import { savePayment } from './debtActions';
import { overpayOf, validatePayment, type PaymentFormErrors } from './debtForm';
import { DayField } from './DebtDates';
import { useWalletFx } from './useWalletFx';

export interface PaymentSheetProps {
  debt: LocalRow<Debt>;
  state: DebtState;
  base: CurrencyCode;
  onClose: () => void;
}

/**
 * Платёж по долгу: кошелёк той же валюты, сумма (по умолчанию — весь остаток), дата, заметка. Больше остатка — только после явного
 * подтверждения «Это переплата». Сам платёж — обычная операция с debtId (для «мне должны» доход, для «я должен» расход).
 */
export function PaymentSheet({ debt, state, base, onClose }: PaymentSheetProps) {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets();
  const settings = useSettings();
  const remaining = state.remainingMinor;

  const [amount, setAmount] = useState<Minor | null>(remaining > 0 ? remaining : null);
  const [walletPick, setWalletPick] = useState<string | null>(null);
  const [date, setDate] = useState<IsoDate>(() => todayLocal());
  const [note, setNote] = useState('');
  const [overpayConfirmed, setOverpayConfirmed] = useState(false);
  const [errors, setErrors] = useState<PaymentFormErrors & { form?: string; rate?: string }>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const txId = useRef(newId());

  const candidates = (wallets ?? []).filter((w) => w.currency === debt.currency);
  const defaultWalletId = settings?.defaultWalletId ?? null;
  const walletId =
    candidates.find((w) => w.id === walletPick)?.id ??
    candidates.find((w) => w.id === defaultWalletId)?.id ??
    candidates[0]?.id ??
    null;
  const wallet = candidates.find((w) => w.id === walletId);
  const fx = useWalletFx(wallet?.currency, base);

  if (wallets === undefined || settings === undefined) return null;

  const over = overpayOf(amount, remaining);
  const clear = (...keys: (keyof typeof errors)[]) =>
    setErrors((e) => {
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });

  const save = async () => {
    if (busy.current) return;
    const v = validatePayment({ amountMinor: amount, walletId, date, note, remainingMinor: remaining, openedOn: debt.openedOn, overpayConfirmed });
    if (!v.ok || amount === null || walletId === null) return setErrors(v.errors);
    const resolved = fx.resolve();
    if (!resolved.ok) return setErrors({ rate: resolved.error });
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      await savePayment(store, {
        debtId: debt.id,
        direction: debt.direction,
        txId: txId.current,
        walletId,
        amountMinor: amount,
        occurredOn: date,
        note,
        ...(resolved.fx ? { fx: resolved.fx } : {}),
      });
      resolved.remember();
      toast.success('Платёж записан');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors({ form: e.message });
      else {
        console.error('Не удалось записать платёж:', e);
        setErrors({ form: 'Не удалось записать платёж. Данные не изменены, попробуйте ещё раз.' });
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const left = amount !== null && amount > 0 && over === 0 ? remaining - amount : null;
  const whom = debt.direction === 'lent' ? `${debt.counterparty} вернул вам` : `Вы возвращаете: ${debt.counterparty}`;

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title="Платёж по долгу"
      footer={
        <div className="flex flex-col gap-2">
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} disabled={candidates.length === 0} onClick={() => void save()}>
            Записать платёж
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-muted">
          {whom}. Остаток долга: <span className="money font-semibold text-text">{formatMinor(remaining, debt.currency)}</span>
        </p>

        {candidates.length === 0 ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm font-medium text-warning" role="alert">
            Нет кошелька в валюте {debt.currency}: платёж записывается в кошелёк той же валюты, что и долг. Создайте такой кошелёк на
            экране «Кошельки».{' '}
            <Link to="/wallets" className="inline-flex min-h-[44px] items-center font-semibold text-brand">
              Открыть кошельки
            </Link>
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <AmountInput
                label="Сумма платежа"
                currency={debt.currency}
                value={amount}
                error={errors.amount}
                tone={debt.direction === 'lent' ? 'income' : 'expense'}
                onChange={(v) => {
                  setAmount(v);
                  setOverpayConfirmed(false);
                  clear('amount', 'overpay', 'form');
                }}
              />
              {left !== null && (
                <p className="text-center text-sm text-muted">После платежа останется {endSentence(formatMinor(left, debt.currency))}</p>
              )}
              {remaining > 0 && amount !== remaining && (
                <Button
                  variant="ghost"
                  className="self-center"
                  onClick={() => {
                    setAmount(remaining);
                    setOverpayConfirmed(false);
                    clear('amount', 'overpay', 'form');
                  }}
                >
                  Подставить весь остаток
                </Button>
              )}
            </div>

            {over > 0 && (
              <div role="group" aria-label="Переплата" className="rounded-xl border border-warning/60 bg-warning/10 p-3">
                <p className="font-semibold text-warning">
                  Платёж больше остатка на <span className="money">{formatMinor(over, debt.currency)}</span>
                </p>
                <label className="flex min-h-[44px] cursor-pointer items-start gap-3 pt-1">
                  <input
                    type="checkbox"
                    checked={overpayConfirmed}
                    onChange={(e) => {
                      setOverpayConfirmed(e.target.checked);
                      clear('overpay');
                    }}
                    className="mt-0.5 h-6 w-6 shrink-0 accent-brand"
                  />
                  <span>Это переплата — записать платёж полностью</span>
                </label>
                {errors.overpay && (
                  <p role="alert" className="mt-1 text-sm font-medium text-danger">
                    {errors.overpay}
                  </p>
                )}
              </div>
            )}

            <FieldGroup label={debt.direction === 'lent' ? 'На какой кошелёк' : 'С какого кошелька'} error={errors.wallet}>
              <ChipPicker
                ariaLabel="Кошелёк"
                value={walletId}
                onChange={(id) => {
                  setWalletPick(id);
                  clear('wallet', 'form');
                }}
                options={candidates.map((w) => ({ value: w.id, label: w.name, icon: w.icon }))}
              />
            </FieldGroup>
            <FxNotice fx={fx.view} amountMinor={amount} rateText={fx.rateText} onRateText={fx.setRateText} error={errors.rate} />

            <DayField
              label="Дата платежа"
              value={date}
              onChange={(d) => {
                setDate(d);
                clear('date', 'form');
              }}
              error={errors.date}
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
              error={errors.note}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}
