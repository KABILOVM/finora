import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { newId, useSettings, useStore, useWallets, ValidationError } from '@/db';
import type { DebtState } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { Debt, IsoDate, LocalRow, Minor } from '@/domain/types';
import { longDate } from '@/features/budgets/budgetText';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { rankWallets, usePopularity } from '@/features/transactions/popularity';
import { todayLocal } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { savePayInParts } from './debtActions';
import { validatePayInParts, type PayInPartsFormErrors } from './debtForm';
import { PARTS_ACTION } from './debtText';
import { DayField } from './DebtDates';
import { payoffPlan } from './payoff';

export interface PayInPartsSheetProps {
  debt: LocalRow<Debt>;
  state: DebtState;
  onClose: () => void;
}

/** Быстрые варианты: «на 3 / 6 / 12 месяцев» — сумма в месяц округляется вверх, чтобы уложиться в срок. */
const QUICK_MONTHS = [3, 6, 12] as const;
const ceilDiv = (a: Minor, b: number): Minor => Math.floor((a - 1) / b) + 1;

/**
 * «Платить частями»: регулярный платёж «раз в месяц» по долгу с датой окончания. Окно считает, сколько платежей понадобится и когда долг
 * закроется. Сами платежи появляются в «Платежах» и проводятся по одному (или сами — по желанию). Последний платёж может оказаться
 * меньше обычного: он записывается на остаток долга (createFromRule с fitToDebt). Второй план тому же долгу не создаётся.
 */
export function PayInPartsSheet({ debt, state, onClose }: PayInPartsSheetProps) {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets();
  const settings = useSettings();
  const pop = usePopularity();
  const remaining = state.remainingMinor;

  const [amount, setAmount] = useState<Minor | null>(null);
  const [walletPick, setWalletPick] = useState<string | null>(null);
  const [startOn, setStartOn] = useState<IsoDate>(() => todayLocal());
  const [autoPost, setAutoPost] = useState(false);
  const [errors, setErrors] = useState<PayInPartsFormErrors & { form?: string }>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const ruleId = useRef(newId());

  const candidates = (wallets ?? []).filter((w) => w.currency === debt.currency);
  const defaultWalletId = settings?.defaultWalletId ?? null;
  const walletId =
    candidates.find((w) => w.id === walletPick)?.id ?? candidates.find((w) => w.id === defaultWalletId)?.id ?? candidates[0]?.id ?? null;
  const walletChips = pop ? rankWallets(candidates, pop) : candidates;

  if (wallets === undefined || settings === undefined || pop === undefined) return null;

  const clear = () => setErrors({});
  const result = amount !== null && amount > 0 ? payoffPlan(remaining, amount, startOn) : null;
  const payoff = result?.ok ? result.payoff : null;
  const today = todayLocal();

  const save = async () => {
    if (busy.current) return;
    const v = validatePayInParts({ amountMinor: amount, walletId, startOn, today, openedOn: debt.openedOn, remainingMinor: remaining });
    if (!v.ok || amount === null || walletId === null) return setErrors(v.errors);
    if (payoff === null) return setErrors({ amount: result && !result.ok && result.reason === 'too-long' ? 'Слишком мелкие платежи: больше 50 лет. Увеличьте сумму.' : 'Проверьте сумму и дату первого платежа' });
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      await savePayInParts(
        store,
        { debtId: debt.id, direction: debt.direction, counterparty: debt.counterparty, walletId, amountMinor: amount, startOn, endOn: payoff.lastOn, autoPost },
        ruleId.current,
      );
      toast.success(`Платежи по долгу добавлены в «Платежи»: ${payoff.payments} ${pluralRu(payoff.payments, 'платёж', 'платежа', 'платежей')}`);
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors({ form: e.message });
      else {
        console.error('Не удалось создать регулярный платёж по долгу:', e);
        setErrors({ form: 'Не удалось создать платежи. Данные не изменены, попробуйте ещё раз.' });
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const lent = debt.direction === 'lent';
  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={PARTS_ACTION[debt.direction]}
      footer={
        <div className="flex flex-col gap-2">
          {amount !== null && amount > 0 && remaining > 0 && candidates.length > 0 && (
            <div data-testid="payoff-preview" className="rounded-2xl bg-surface-2/70 px-3 py-2 text-sm">
              {payoff ? (
                <>
                  <p className="font-semibold">
                    Долг закроется {longDate(payoff.lastOn)}: {payoff.payments} {pluralRu(payoff.payments, 'платёж', 'платежа', 'платежей')}
                  </p>
                  {payoff.lastAmountMinor < amount && (
                    <p className="text-muted">
                      Последний платёж — {formatMinor(payoff.lastAmountMinor, debt.currency)}: запишется на остаток долга.
                    </p>
                  )}
                </>
              ) : result && !result.ok && result.reason === 'too-long' ? (
                <p className="font-medium text-warning">Так мелко больше 50 лет. Увеличьте сумму платежа.</p>
              ) : (
                <p className="font-medium text-warning">Не удалось посчитать срок: проверьте дату первого платежа.</p>
              )}
            </div>
          )}
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} disabled={candidates.length === 0 || remaining <= 0} onClick={() => void save()}>
            Создать платежи
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-muted">
          {lent ? `${debt.counterparty} вернёт` : `Вы вернёте: ${debt.counterparty}`}. Остаток долга:{' '}
          <span className="money font-semibold text-text">{formatMinor(remaining, debt.currency)}</span>
        </p>

        {remaining <= 0 ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm font-medium text-muted">Долг уже погашен: платить нечего.</p>
        ) : candidates.length === 0 ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm font-medium text-warning" role="alert">
            Нет кошелька в валюте {debt.currency}: платёж записывается в кошелёк той же валюты, что и долг. Создайте такой кошелёк на экране
            «Кошельки».{' '}
            <Link to="/wallets" className="inline-flex min-h-[44px] items-center font-semibold text-brand">
              Открыть кошельки
            </Link>
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <AmountInput
                label="Сумма в месяц"
                currency={debt.currency}
                value={amount}
                error={errors.amount}
                tone={lent ? 'income' : 'expense'}
                onChange={(v) => {
                  setAmount(v);
                  clear();
                }}
              />
              <div role="group" aria-label="Быстрый выбор срока" className="flex flex-wrap justify-center gap-2">
                {QUICK_MONTHS.map((m) => (
                  <Button
                    key={m}
                    variant="secondary"
                    onClick={() => {
                      setAmount(ceilDiv(remaining, m));
                      clear();
                    }}
                  >
                    На {m} мес.
                  </Button>
                ))}
              </div>
            </div>

            <FieldGroup label={lent ? 'На какой кошелёк' : 'С какого кошелька'} error={errors.wallet}>
              <ChipPicker
                ariaLabel="Кошелёк"
                value={walletId}
                onChange={(id) => {
                  setWalletPick(id);
                  clear();
                }}
                options={walletChips.map((w) => ({ value: w.id, label: w.name, icon: w.icon }))}
              />
            </FieldGroup>
            <DayField
              label="Первый платёж"
              value={startOn}
              onChange={(d) => {
                setStartOn(d);
                clear();
              }}
              error={errors.startOn}
            />
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
              <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-brand" />
              <span>
                <span className="block font-medium">Проводить само</span>
                <span className="block text-sm text-muted">Платёж запишется в день срока, когда вы откроете приложение. Иначе он будет ждать в «Платежах».</span>
              </span>
            </label>
          </>
        )}
      </div>
    </Sheet>
  );
}
