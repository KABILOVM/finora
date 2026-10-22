import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Field, inputClasses, TextInput } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useCategories, useSettings, useStore, useWallets } from '@/db';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { todayLocal } from '@/lib/dates';
import { freshSplitIds, MAX_FRIENDS, saveSplitBill, splitEven, undoSplitBill, validateSplit, type SplitErrors, type SplitIds } from './splitBill';
import { useWalletFx } from './useWalletFx';

export interface SplitBillSheetProps {
  base: CurrencyCode;
  onClose: () => void;
}

/**
 * «Разделить счёт»: заплатили за всех — вносите общую сумму и имена друзей, а приложение запишет вашу долю расходом, а на каждого друга
 * заведёт долг «мне должны» (деньги из кошелька при этом уходят одной суммой, как в жизни). Делится поровну; «Отменить» убирает всё сразу.
 */
export function SplitBillSheet({ base, onClose }: SplitBillSheetProps) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const wallets = useWallets();
  const categories = useCategories('expense');
  const people = useLiveQuery(
    async () => [...new Set((await store.db.debts.toArray()).filter((d) => d.deletedAt === null && d.direction === 'lent').map((d) => d.counterparty))].sort((a, b) => a.localeCompare(b, 'ru')),
    [store],
  );

  const [total, setTotal] = useState<number | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(() => todayLocal());
  const [note, setNote] = useState('');
  const [names, setNames] = useState<string[]>(['']);
  const [errors, setErrors] = useState<SplitErrors>({});
  const [busy, setBusy] = useState(false);
  const ids = useRef<SplitIds>(freshSplitIds(1));

  const wallet = useMemo(() => {
    if (!wallets || wallets.length === 0) return null;
    return wallets.find((w) => w.id === walletId) ?? wallets.find((w) => w.id === settings?.defaultWalletId) ?? wallets[0] ?? null;
  }, [wallets, walletId, settings?.defaultWalletId]);
  const currency = wallet?.currency ?? base;
  const fx = useWalletFx(wallet?.currency, base);

  const preview = total !== null && total >= names.length + 1 ? splitEven(total, names.length) : null;
  const dirty = total !== null || note.trim() !== '' || names.some((n) => n.trim() !== '');

  const setName = (i: number, value: string) => setNames((cur) => cur.map((n, j) => (j === i ? value : n)));
  const addName = () => {
    if (names.length >= MAX_FRIENDS) return;
    setNames((cur) => [...cur, '']);
    ids.current = { ...ids.current, friends: [...ids.current.friends, ...freshSplitIds(1).friends] };
  };
  const removeName = (i: number) => {
    setNames((cur) => cur.filter((_, j) => j !== i));
    ids.current = { ...ids.current, friends: ids.current.friends.filter((_, j) => j !== i) };
  };

  const submit = async () => {
    if (busy || !wallet) return;
    const { errors: found, value } = validateSplit({ totalMinor: total, names, note });
    setErrors(found);
    if (!value) return;
    const resolved = fx.resolve();
    if (!resolved.ok) {
      setErrors({ form: resolved.error });
      return;
    }
    setBusy(true);
    try {
      const result = await saveSplitBill(
        store,
        { walletId: wallet.id, currency: wallet.currency, categoryId: categoryId === '' ? null : categoryId, occurredOn: date, value, ...(resolved.fx ? { fx: resolved.fx } : {}) },
        ids.current,
      );
      resolved.remember();
      toastWithUndo(toast, `Счёт разделён: ${value.names.length === 1 ? value.names[0] : `${value.names.length} чел.`} должны вам ${formatMinor(value.shareMinor, wallet.currency)}`, () => undoSplitBill(store, result), 'Разделение отменено');
      onClose();
    } catch (e) {
      setErrors({ form: humanError(e, 'Не удалось записать. Попробуйте ещё раз.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Разделить счёт"
      isDirty={dirty}
      footer={
        <Button fullWidth loading={busy} disabled={!wallet} onClick={() => void submit()}>
          Записать
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">Вы заплатили за всех. Ваша доля запишется расходом, а друзья будут вам должны свои доли.</p>
      {errors.form && (
        <Notice tone="danger" role="alert" className="mb-3">
          {errors.form}
        </Notice>
      )}
      <AmountInput currency={currency} value={total} onChange={setTotal} label="Сумма счёта" error={errors.amount ?? null} showKeypad={false} compact />

      <div className="mt-4 flex flex-col gap-3">
        <Field id="split-wallet" label="Чем заплатили">
          <select id="split-wallet" value={wallet?.id ?? ''} onChange={(e) => setWalletId(e.target.value)} className={`${inputClasses(false)} min-h-[48px]`}>
            {(wallets ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {w.currency}
              </option>
            ))}
          </select>
        </Field>
        {fx.view.kind === 'missing' && (
          <TextInput
            label={`Курс ${fx.view.from} к ${fx.view.to}`}
            inputMode="decimal"
            value={fx.rateText}
            onChange={(e) => fx.setRateText(e.target.value)}
            hint="Курса пока нет: введите его, чтобы пересчитать расход в основную валюту"
          />
        )}
        <Field id="split-category" label="Категория вашей доли">
          <select id="split-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputClasses(false)} min-h-[48px]`}>
            <option value="">Без категории</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <TextInput label="На что" value={note} placeholder="Ужин в кафе" maxLength={200} onChange={(e) => setNote(e.target.value)} error={errors.note ?? null} />
        <TextInput label="Дата" type="date" value={date} max={todayLocal()} onChange={(e) => e.target.value !== '' && setDate(e.target.value)} />
      </div>

      <section aria-label="С кем делим" className="mt-4">
        <h3 className="mb-1 text-sm font-semibold">С кем делим</h3>
        <datalist id="split-people">
          {(people ?? []).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <ul className="flex flex-col gap-2">
          {names.map((n, i) => (
            <li key={i} className="flex items-end gap-2">
              <TextInput
                label={`Друг ${i + 1}`}
                list="split-people"
                autoComplete="off"
                value={n}
                placeholder="Имя"
                onChange={(e) => setName(i, e.target.value)}
                error={errors.names?.[i] ?? null}
                wrapperClassName="min-w-0 flex-1"
              />
              {names.length > 1 && <IconButton icon="close" label={`Убрать: ${n.trim() !== '' ? n.trim() : `друг ${i + 1}`}`} onClick={() => removeName(i)} />}
            </li>
          ))}
        </ul>
        <Button variant="ghost" icon="plus" className="mt-1" disabled={names.length >= MAX_FRIENDS} onClick={addName}>
          Добавить человека
        </Button>
      </section>

      {preview && (
        <p className="mt-3 rounded-2xl bg-surface-2/70 px-3 py-2 text-sm" data-testid="split-preview">
          Каждый друг: <b className="money">{formatMinor(preview.shareMinor, currency)}</b> · ваша доля: <b className="money">{formatMinor(preview.mineMinor, currency)}</b>
        </p>
      )}
    </Sheet>
  );
}
