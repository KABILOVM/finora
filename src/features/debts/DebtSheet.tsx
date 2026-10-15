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
import { freshPlanIds, saveNewDebt, saveTopUp } from './debtActions';
import { emptyDebtForm, validateDebtForm, type DebtFormErrors, type DebtFormState } from './debtForm';
import { findMatchingDebts, normName } from './debtMatch';
import type { DebtItem } from './debtSummary';
import { DIRECTION_ACTION, DIRECTION_LABEL, DIRECTION_NAME_LABEL, ruDateShort, TOP_UP_AMOUNT_LABEL } from './debtText';
import { DayField, DueField } from './DebtDates';
import { DebtMoneySection } from './DebtMoneySection';
import { rankWallets, usePopularity } from '@/features/transactions/popularity';
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
  /** Долг создан (или к существующему добавлено): экран переключается на его направление. */
  onCreated?: (debt: LocalRow<Debt>) => void;
  /**
   * Уже заведённые долги (для нового долга): если человек, направление и валюта совпали с существующим долгом, предлагаем
   * «добавить к нему» вместо второго долга. Не передали — предложения нет.
   */
  existing?: readonly DebtItem[];
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
export function DebtSheet({ debt, paidMinor = 0, defaultDirection = 'lent', base, onClose, onCreated, existing }: DebtSheetProps) {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets();
  const settings = useSettings();
  // Долг запоминается при открытии: форма заполнена им, и с ним же сравниваем при сохранении. Если синхронизация тем временем
  // принесла чужую правку, «живой» долг изменится, а форма — нет: сравнивать с живым значит откатить чужую правку.
  const [orig] = useState(debt);
  const editing = orig !== null;

  const [form, setForm] = useState<DebtFormState>(() =>
    orig ? formFromDebt(orig) : emptyDebtForm(defaultDirection, base, todayLocal()),
  );
  const [errors, setErrors] = useState<DebtFormErrors>({});
  const [wanted, setWanted] = useState(true);
  const [walletPick, setWalletPick] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [joinId, setJoinId] = useState<string | null>(null);
  const [declinedKey, setDeclinedKey] = useState<string | null>(null);
  const busy = useRef(false);
  const ids = useRef(freshPlanIds());

  // Тот же человек, то же направление и валюта: предлагаем добавить к существующему долгу. «Добавить» выбрано — долг не создаётся,
  // сумма идёт как пополнение. Выбор привязан к найденному долгу: сменили имя или валюту — совпадения пересчитались, выбор сам снялся.
  const matches = orig === null && existing ? findMatchingDebts(existing, form) : [];
  const matchKey = `${form.direction}|${form.currency}|${normName(form.counterparty)}`;
  const joined = matches.find((m) => m.debt.id === joinId) ?? null;
  const asking = matches.length > 0 && joined === null && declinedKey !== matchKey;

  // Направление и валюту репозиторий менять не даёт, когда по долгу есть операции или регулярные платежи: говорим об этом словами
  const linked = useLiveQuery(async () => {
    if (!orig) return false;
    const { db } = store;
    if ((await db.transactions.where('debtId').equals(orig.id).count()) > 0) return true;
    return (await db.recurring_rules.filter((r) => r.debtId === orig.id && r.deletedAt === null).count()) > 0;
  }, [store, orig?.id]);
  const locked = editing && linked !== false;

  const pop = usePopularity();
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

  if (wallets === undefined || settings === undefined || pop === undefined) return null;

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
    if (joined && value.openedOn < joined.debt.openedOn) {
      return setErrors({ openedOn: `Пополнение не может быть раньше даты долга (${ruDateShort(joined.debt.openedOn)})` });
    }
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      if (joined) {
        const movement =
          moneyOn && walletId !== null ? { walletId, txId: ids.current.txId, ...(resolved?.ok && resolved.fx ? { fx: resolved.fx } : {}) } : null;
        const res = await saveTopUp(store, {
          debtId: joined.debt.id,
          direction: form.direction,
          amountMinor: value.principalMinor,
          occurredOn: value.openedOn,
          note: value.note,
          ...(value.dueOn !== null ? { dueOn: value.dueOn } : {}),
          movement,
        });
        if (resolved?.ok) resolved.remember();
        toast.success(res.tx ? 'Добавлено к долгу, деньги учтены в кошельке' : 'Добавлено к долгу «на бумаге»');
        onCreated?.(res.debt);
      } else if (!orig) {
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
        // В базу уходит только то, что человек изменил против увиденного при открытии
        const patch: DebtPatch = {};
        if (value.counterparty !== orig.counterparty) patch.counterparty = value.counterparty;
        if (value.principalMinor !== orig.principalMinor) patch.principalMinor = value.principalMinor;
        if (value.openedOn !== orig.openedOn) patch.openedOn = value.openedOn;
        if (value.dueOn !== orig.dueOn) patch.dueOn = value.dueOn;
        if (value.note !== orig.note) patch.note = value.note;
        if (!locked && form.direction !== orig.direction) patch.direction = form.direction;
        if (!locked && form.currency !== orig.currency) patch.currency = form.currency;
        if (Object.keys(patch).length > 0) await store.debts.update(orig.id, patch);
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
      title={editing ? 'Правка долга' : joined ? 'Ещё в долг' : 'Новый долг'}
      footer={
        <div className="flex flex-col gap-2">
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()}>
            {joined ? 'Добавить к долгу' : 'Сохранить'}
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

        {asking && (
          <section aria-label="Такой долг уже есть" data-testid="debt-match" className="flex flex-col gap-2 rounded-2xl border border-brand/40 bg-brand/5 p-3">
            <p className="font-semibold">
              {matches.length === 1 ? `У вас уже есть долг «${matches[0]!.debt.counterparty}»` : `У вас уже есть долги с «${matches[0]!.debt.counterparty}»`}
            </p>
            <p className="text-sm text-muted">Добавьте сумму к нему, чтобы не вести два долга одному человеку.</p>
            <ul className="flex flex-col gap-2">
              {matches.map((m) => (
                <li key={m.debt.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-sm">
                    Остаток <span className="money font-semibold">{formatMinor(m.state?.remainingMinor ?? 0, m.debt.currency)}</span>
                    {m.debt.closedAt !== null && ' · закрыт, откроется снова'}
                  </span>
                  <Button
                    variant="secondary"
                    aria-label={`Добавить к долгу «${m.debt.counterparty}» от ${ruDateShort(m.debt.openedOn)}`}
                    onClick={() => setJoinId(m.debt.id)}
                  >
                    Добавить к этому долгу
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" className="self-start" onClick={() => setDeclinedKey(matchKey)}>
              Создать отдельный долг
            </Button>
          </section>
        )}
        {joined && (
          <section aria-label="Добавление к долгу" data-testid="debt-joined" className="flex flex-col gap-1 rounded-2xl border border-brand/40 bg-brand/5 p-3">
            <p className="font-semibold">Сумма добавится к долгу «{joined.debt.counterparty}»</p>
            <p className="text-sm text-muted">
              Сейчас сумма долга {formatMinor(joined.state?.principalMinor ?? joined.debt.principalMinor, joined.debt.currency)}, остаток{' '}
              {endSentence(formatMinor(joined.state?.remainingMinor ?? 0, joined.debt.currency))} Новый долг не создаётся. Срок поменяется,
              только если вы его укажете; заметка запишется к операции.
            </p>
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => {
                setJoinId(null);
                setDeclinedKey(matchKey);
              }}
            >
              Создать отдельный долг
            </Button>
          </section>
        )}

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
            label={joined ? TOP_UP_AMOUNT_LABEL[form.direction] : 'Сумма долга'}
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

        <DayField label={joined ? 'Дата пополнения' : 'Дата долга'} value={form.openedOn} onChange={(openedOn) => set({ openedOn })} error={errors.openedOn} />
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
            topUp={joined !== null}
            direction={form.direction}
            currency={form.currency}
            amountMinor={form.amountMinor}
            candidates={rankWallets(candidates, pop)}
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

