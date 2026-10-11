import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Field, inputClasses, TextInput } from '@/components/Field';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, useSettings, useStore, useWallets, type DebtPatch } from '@/db';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, Debt, DebtDirection, LocalRow, Minor } from '@/domain/types';
import { endSentence } from '@/features/transactions/txDisplay';
import { NOTE_MAX } from '@/features/transactions/txForm';
import { addDays, todayLocal } from '@/lib/dates';
import { freshPlanIds, saveNewDebt } from './debtActions';
import { emptyDebtForm, validateDebtForm, type DebtFormErrors, type DebtFormState } from './debtForm';
import { DIRECTION_ACTION, DIRECTION_LABEL, DIRECTION_NAME_LABEL } from './debtText';
import { DayField, DueField } from './DebtDates';
import { DebtMoneySection } from './DebtMoneySection';
import { useWalletFx } from './useWalletFx';

export interface DebtSheetProps {
  /** null — новый долг; иначе правка. */
  debt: LocalRow<Debt> | null;
  /** Сколько по долгу уже оплачено (для подсказки при правке суммы). */
  paidMinor?: Minor;
  /** Направление нового долга по умолчанию — то, что открыто на экране. */
  defaultDirection?: DebtDirection;
  base: CurrencyCode;
  onClose: () => void;
  /** Долг создан: экран переключается на его направление. */
  onCreated?: (debt: LocalRow<Debt>) => void;
}

const DIRECTIONS = [
  { value: 'lent', label: DIRECTION_ACTION.lent, tone: 'brand' },
  { value: 'borrowed', label: DIRECTION_ACTION.borrowed, tone: 'brand' },
] as const;

/** К какому полю относится сообщение репозитория; неясно — к форме целиком. */
export function errorKey(message: string): keyof DebtFormErrors {
  const m = message.trim();
  if (/^Сумма|слишком велика/.test(m)) return 'amount';
  if (/^Кто должен|^Имя/.test(m)) return 'counterparty';
  if (/^Срок/.test(m)) return 'dueOn';
  if (/^Дата долга/.test(m)) return 'openedOn';
  if (/^Заметка/.test(m)) return 'note';
  return 'form';
}

function formFromDebt(d: LocalRow<Debt>): DebtFormState {
  return {
    direction: d.direction,
    counterparty: d.counterparty,
    currency: d.currency,
    amountMinor: d.principalMinor,
    openedOn: d.openedOn,
    hasDue: d.dueOn !== null,
    dueOn: d.dueOn ?? addDays(d.openedOn, 30),
    note: d.note,
  };
}

/** Новый долг (с движением денег по желанию) или правка долга. Деньги вводятся только через AmountInput. */
export function DebtSheet({ debt, paidMinor = 0, defaultDirection = 'lent', base, onClose, onCreated }: DebtSheetProps) {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets();
  const settings = useSettings();
  const editing = debt !== null;

  const [form, setForm] = useState<DebtFormState>(() =>
    debt ? formFromDebt(debt) : emptyDebtForm(defaultDirection, base, todayLocal()),
  );
  const [errors, setErrors] = useState<DebtFormErrors>({});
  const [wanted, setWanted] = useState(true);
  const [walletPick, setWalletPick] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const ids = useRef(freshPlanIds());

  // Направление и валюту репозиторий менять не даёт, когда по долгу есть операции или регулярные платежи: говорим об этом словами
  const linked = useLiveQuery(async () => {
    if (!debt) return false;
    const { db } = store;
    if ((await db.transactions.where('debtId').equals(debt.id).count()) > 0) return true;
    return (await db.recurring_rules.filter((r) => r.debtId === debt.id && r.deletedAt === null).count()) > 0;
  }, [store, debt?.id]);
  const locked = editing && linked !== false;

  const candidates = (wallets ?? []).filter((w) => w.currency === form.currency);
  const defaultWalletId = settings?.defaultWalletId ?? null;
  const walletId =
    candidates.find((w) => w.id === walletPick)?.id ??
    candidates.find((w) => w.id === defaultWalletId)?.id ??
    candidates[0]?.id ??
    null;
  const moneyOn = !editing && wanted && candidates.length > 0 && walletId !== null;
  const wallet = candidates.find((w) => w.id === walletId);
  const fx = useWalletFx(moneyOn ? wallet?.currency : undefined, base);

  if (wallets === undefined || settings === undefined) return null;

  const set = (patch: Partial<DebtFormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      delete next.form;
      if ('counterparty' in patch) delete next.counterparty;
      if ('amountMinor' in patch) delete next.amount;
      if ('openedOn' in patch) delete next.openedOn;
      if ('hasDue' in patch || 'dueOn' in patch) delete next.dueOn;
      if ('note' in patch) delete next.note;
      return next;
    });
  };

  const fail = (e: unknown, fallback: string, nothingSaved: boolean) => {
    if (e instanceof ValidationError) {
      const key = errorKey(e.message);
      const text = key === 'form' && nothingSaved ? `${endSentence(e.message)} Долг не записан: ничего не сохранилось.` : e.message;
      setErrors({ [key]: text } as DebtFormErrors);
    } else {
      console.error(fallback, e);
      setErrors({ form: `${fallback} Данные не изменены, попробуйте ещё раз.` });
    }
  };

  const save = async () => {
    if (busy.current) return;
    const { errors: found, value } = validateDebtForm(form);
    setWalletError(null);
    setRateError(null);
    if (!value) return setErrors(found);
    let resolved: ReturnType<typeof fx.resolve> | null = null;
    if (moneyOn) {
      resolved = fx.resolve();
      if (!resolved.ok) {
        setErrors({});
        return setRateError(resolved.error);
      }
      if (walletId === null) return setWalletError('Выберите кошелёк');
    }
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      if (!debt) {
        const res = await saveNewDebt(store, {
          debtId: ids.current.debtId,
          debt: {
            direction: form.direction,
            counterparty: value.counterparty,
            principalMinor: value.principalMinor,
            currency: form.currency,
            openedOn: value.openedOn,
            dueOn: value.dueOn,
            note: value.note,
          },
          movement:
            moneyOn && walletId !== null
              ? { walletId, txId: ids.current.txId, ...(resolved?.ok && resolved.fx ? { fx: resolved.fx } : {}) }
              : null,
        });
        if (resolved?.ok) resolved.remember();
        toast.success(res.tx ? 'Долг записан, деньги учтены в кошельке' : 'Долг записан «на бумаге»');
        onCreated?.(res.debt);
      } else {
        const patch: DebtPatch = {};
        if (value.counterparty !== debt.counterparty) patch.counterparty = value.counterparty;
        if (value.principalMinor !== debt.principalMinor) patch.principalMinor = value.principalMinor;
        if (value.openedOn !== debt.openedOn) patch.openedOn = value.openedOn;
        if (value.dueOn !== debt.dueOn) patch.dueOn = value.dueOn;
        if (value.note !== debt.note) patch.note = value.note;
        if (!locked && form.direction !== debt.direction) patch.direction = form.direction;
        if (!locked && form.currency !== debt.currency) patch.currency = form.currency;
        if (Object.keys(patch).length > 0) await store.debts.update(debt.id, patch);
        toast.success('Долг сохранён');
      }
      onClose();
    } catch (e) {
      fail(e, editing ? 'Не удалось сохранить долг.' : 'Не удалось записать долг.', !editing);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const currencyOptions = CURRENCIES.some((c) => c.code === form.currency) ? CURRENCIES : [...CURRENCIES, currencyInfo(form.currency)];
  const smaller = editing && form.amountMinor !== null && paidMinor > form.amountMinor;

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={editing ? 'Правка долга' : 'Новый долг'}
      footer={
        <div className="flex flex-col gap-2">
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()}>
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {locked ? (
          <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm" data-testid="debt-locked">
            <p className="font-semibold">
              {DIRECTION_LABEL[form.direction]} · {form.currency}
            </p>
            <p className="text-muted">
              Направление и валюту нельзя менять: по этому долгу уже есть операции. Если ошиблись, заведите новый долг.
            </p>
          </div>
        ) : (
          <Segmented
            ariaLabel="Направление долга"
            options={DIRECTIONS}
            value={form.direction}
            onChange={(direction) => set({ direction })}
          />
        )}

        <TextInput
          label={DIRECTION_NAME_LABEL[form.direction]}
          value={form.counterparty}
          maxLength={120}
          placeholder="Например, Алишер"
          autoComplete="off"
          enterKeyHint="next"
          onChange={(e) => set({ counterparty: e.target.value })}
          error={errors.counterparty}
          data-autofocus
        />

        {!locked && (
          <Field id="debt-currency" label="Валюта" hint={editing ? undefined : 'Деньги по долгу идут в кошелёк этой же валюты'}>
            <select
              id="debt-currency"
              value={form.currency}
              onChange={(e) => {
                setWalletPick(null);
                set({ currency: e.target.value });
              }}
              className={`${inputClasses(false)} min-h-[48px]`}
            >
              {currencyOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="flex flex-col gap-1">
          <AmountInput
            label="Сумма долга"
            currency={form.currency}
            value={form.amountMinor}
            error={errors.amount}
            tone={form.direction === 'lent' ? 'expense' : 'income'}
            onChange={(amountMinor) => set({ amountMinor })}
          />
          {editing && paidMinor > 0 && (
            <p className={`text-center text-sm ${smaller ? 'font-medium text-warning' : 'text-muted'}`}>
              {smaller
                ? `Уже оплачено ${formatMinor(paidMinor, form.currency)} — это больше новой суммы, появится переплата.`
                : `Уже оплачено ${endSentence(formatMinor(paidMinor, form.currency))}`}
            </p>
          )}
        </div>

        <DayField label="Дата долга" value={form.openedOn} onChange={(openedOn) => set({ openedOn })} error={errors.openedOn} />
        <DueField
          hasDue={form.hasDue}
          dueOn={form.dueOn}
          openedOn={form.openedOn}
          error={errors.dueOn}
          onChange={(p) => {
            if (p.hasDue && form.dueOn < form.openedOn) return set({ ...p, dueOn: addDays(form.openedOn, 30) });
            set(p);
          }}
        />

        <TextInput
          label="Заметка"
          hint={form.note.trim().length > NOTE_MAX - 50 ? `${form.note.trim().length} из ${NOTE_MAX}` : 'Необязательно'}
          value={form.note}
          onChange={(e) => set({ note: e.target.value })}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Например, на ремонт машины"
          error={errors.note}
        />

        {!editing && (
          <DebtMoneySection
            direction={form.direction}
            currency={form.currency}
            amountMinor={form.amountMinor}
            candidates={candidates}
            wanted={wanted}
            onWanted={setWanted}
            walletId={walletId}
            onWallet={(id) => {
              setWalletPick(id);
              setWalletError(null);
            }}
            fx={fx}
            fxError={rateError}
            walletError={walletError}
          />
        )}
      </div>
    </Sheet>
  );
}

