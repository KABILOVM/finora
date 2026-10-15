import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { newId, useSettings, useStore, useWallets, ValidationError } from '@/db';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, UUID } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { FxNotice } from '@/features/transactions/FxNotice';
import { rankWallets, usePopularity } from '@/features/transactions/popularity';
import { toastWithUndo } from '@/features/transactions/txActions';
import { endSentence } from '@/features/transactions/txDisplay';
import { todayLocal } from '@/lib/dates';
import { NETTING_NOTE, saveNetting, undoNetting } from './debtActions';
import { validateNetting, type NettingFormErrors } from './debtForm';
import type { DebtItem } from './debtSummary';
import { DIRECTION_LABEL, ruDateShort } from './debtText';
import { DayField } from './DebtDates';
import { planNetting } from './netting';
import { useWalletFx } from './useWalletFx';

export interface NettingSheetProps {
  /** Открытые долги человека. */
  items: readonly DebtItem[];
  currency: CurrencyCode;
  base: CurrencyCode;
  onClose: () => void;
}

/**
 * Взаимозачёт: человек должен мне, а я ему — вычитаем меньшую сумму из обеих сторон. Записываются два платежа на одну сумму через один
 * кошелёк в один день (доход по долгу «мне должны», расход по долгу «я должен»): деньги в кошельке не меняются, долги уменьшаются,
 * история остаётся. После записи — «Отменить».
 */
export function NettingSheet({ items, currency, base, onClose }: NettingSheetProps) {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets();
  const settings = useSettings();
  const pop = usePopularity();
  const plan = useMemo(() => planNetting(items, currency), [items, currency]);

  const [walletPick, setWalletPick] = useState<string | null>(null);
  const [date, setDate] = useState<IsoDate>(() => todayLocal());
  const [errors, setErrors] = useState<NettingFormErrors & { form?: string; rate?: string }>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  // id платежей заранее и на всё время, пока окно открыто: повтор (двойное нажатие, повтор после ошибки) не даст дубля
  const ids = useRef(new Map<string, { lentTxId: UUID; borrowedTxId: UUID }>());

  const candidates = (wallets ?? []).filter((w) => w.currency === currency);
  const defaultWalletId = settings?.defaultWalletId ?? null;
  const walletId =
    candidates.find((w) => w.id === walletPick)?.id ?? candidates.find((w) => w.id === defaultWalletId)?.id ?? candidates[0]?.id ?? null;
  const wallet = candidates.find((w) => w.id === walletId);
  const walletChips = pop ? rankWallets(candidates, pop) : candidates;
  const fx = useWalletFx(wallet?.currency, base);

  if (wallets === undefined || settings === undefined || pop === undefined) return null;

  const involved = plan ? items.filter((it) => plan.after.has(it.debt.id)) : [];
  const lent = involved.filter((it) => it.debt.direction === 'lent');
  const borrowed = involved.filter((it) => it.debt.direction === 'borrowed');
  const openedOn = involved.reduce<IsoDate>((m, it) => (it.debt.openedOn > m ? it.debt.openedOn : m), '2000-01-01');

  const save = async () => {
    if (busy.current || plan === null) return;
    const v = validateNetting({ walletId, date, openedOn });
    if (!v.ok || walletId === null) return setErrors(v.errors);
    const resolved = fx.resolve();
    if (!resolved.ok) return setErrors({ rate: resolved.error });
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      const steps = plan.steps.map((s) => {
        const key = `${s.lentId}|${s.borrowedId}`;
        let pair = ids.current.get(key);
        if (!pair) {
          pair = { lentTxId: newId(), borrowedTxId: newId() };
          ids.current.set(key, pair);
        }
        return { lentDebtId: s.lentId, borrowedDebtId: s.borrowedId, amountMinor: s.amountMinor, ...pair };
      });
      const txIds = await saveNetting(store, { steps, walletId, occurredOn: date, note: NETTING_NOTE, ...(resolved.fx ? { fx: resolved.fx } : {}) });
      resolved.remember();
      toastWithUndo(toast, `Взаимозачёт: ${endSentence(formatMinor(plan.totalMinor, currency))}`, () => undoNetting(store, txIds), 'Взаимозачёт отменён');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors({ form: e.message });
      else {
        console.error('Не удалось записать взаимозачёт:', e);
        setErrors({ form: 'Не удалось записать взаимозачёт. Данные не изменены, попробуйте ещё раз.' });
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const side = (title: string, list: readonly DebtItem[]) => (
    <section aria-label={title}>
      <h3 className="mb-1 text-sm font-semibold text-muted">{title}</h3>
      <ul className="flex flex-col gap-1">
        {list.map((it) => (
          <li key={it.debt.id} className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-2/70 px-3 py-2 text-sm">
            <span className="min-w-0 text-muted">от {ruDateShort(it.debt.openedOn)}</span>{' '}
            <span className="shrink-0">
              <span className="money">{formatMinor(it.state!.remainingMinor, currency)}</span>
              <span aria-hidden="true"> → </span>
              <span className="sr-only"> станет </span>
              <span className="money font-semibold">{formatMinor(plan!.after.get(it.debt.id) ?? 0, currency)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title="Взаимозачёт"
      footer={
        <div className="flex flex-col gap-2">
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} disabled={plan === null || candidates.length === 0} onClick={() => void save()}>
            Зачесть {plan ? formatMinor(plan.totalMinor, currency) : ''}
          </Button>
        </div>
      }
    >
      {plan === null ? (
        <p className="text-muted">Зачитывать нечего: нужен открытый долг «мне должны» и открытый долг «я должен» в {currency}.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-muted">
            Вычтем <span className="money font-semibold text-text">{formatMinor(plan.totalMinor, currency)}</span> из обоих долгов. Деньги в кошельке не
            изменятся: один платёж придёт, а другой уйдёт на ту же сумму. В доходы и расходы месяца они не попадут.
          </p>
          <div data-testid="netting-preview" className="flex flex-col gap-3">
            {side(DIRECTION_LABEL.lent, lent)}
            {side(DIRECTION_LABEL.borrowed, borrowed)}
          </div>

          {candidates.length === 0 ? (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm font-medium text-warning" role="alert">
              Нет кошелька в валюте {currency}: платежи записываются в кошелёк той же валюты, что и долги. Создайте такой кошелёк на экране
              «Кошельки».{' '}
              <Link to="/wallets" className="inline-flex min-h-[44px] items-center font-semibold text-brand">
                Открыть кошельки
              </Link>
            </p>
          ) : (
            <>
              <FieldGroup label="Через какой кошелёк" error={errors.wallet}>
                <ChipPicker
                  ariaLabel="Кошелёк"
                  value={walletId}
                  onChange={(id) => {
                    setWalletPick(id);
                    setErrors({});
                  }}
                  options={walletChips.map((w) => ({ value: w.id, label: w.name, icon: w.icon }))}
                />
              </FieldGroup>
              <FxNotice fx={fx.view} amountMinor={plan.totalMinor} rateText={fx.rateText} onRateText={fx.setRateText} error={errors.rate} />
              <DayField
                label="Дата зачёта"
                value={date}
                onChange={(d) => {
                  setDate(d);
                  setErrors({});
                }}
                error={errors.date}
              />
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
