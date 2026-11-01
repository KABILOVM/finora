import { useMemo, useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Field, inputClasses } from '@/components/Field';
import { MoneyText } from '@/components/MoneyText';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, newId, useBalances, useSettings, useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, Minor, SavingsGoal, Wallet } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { useToday } from '@/recurring/useToday';

export interface SaveNowSheetProps {
  goal: LocalRow<SavingsGoal>;
  /** Кошелёк «Накопления», к которому привязана цель: сюда идёт перевод. */
  goalWallet: LocalRow<Wallet>;
  /** Все кошельки не в архиве: из них выбирают, откуда отложить. */
  wallets: readonly LocalRow<Wallet>[];
  /** Предложенная сумма (например, «ещё отложить в этом месяце» или накопившаяся мелочь). */
  suggestedMinor: Minor;
  /** Заметка к переводу (для «Копилки из мелочи» — по ней находится дата последнего сбора). */
  note?: string;
  onClose: () => void;
  /** Перевод записан: вызывающий может обновить своё. */
  onSaved?: () => void;
}

/**
 * «Отложить сейчас»: обычный перевод на кошелёк цели из выбранного кошелька. Валюта цели = валюта её кошелька, источник берётся
 * в той же валюте, поэтому курса и комиссии нет. Приложение допускает отрицательный остаток кошелька, так что нехватку денег
 * на источнике мы не запрещаем, а предупреждаем. Сохранение отменяется кнопкой в уведомлении (операция скрывается, как при удалении).
 */
export function SaveNowSheet({ goal, goalWallet, wallets, suggestedMinor, note, onClose, onSaved }: SaveNowSheetProps) {
  const store = useStore();
  const toast = useToast();
  const today = useToday();
  const settings = useSettings();
  const balances = useBalances();
  const currency = goalWallet.currency;

  const sources = useMemo(
    () => wallets.filter((w) => w.id !== goalWallet.id && w.archivedAt === null && w.deletedAt === null && w.currency === currency),
    [wallets, goalWallet.id, currency],
  );
  const preferred = settings?.defaultWalletId ?? null;
  // Выбор человека; пока его нет (или кошелёк пропал) — кошелёк по умолчанию, если он подходит, иначе первый. Настройки могут
  // догрузиться уже после открытия окна, поэтому «по умолчанию» вычисляется, а не запоминается при первом показе.
  const [picked, setPicked] = useState<string | null>(null);
  const [amount, setAmount] = useState<Minor | null>(suggestedMinor > 0 ? suggestedMinor : null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  // Один id на всё окно: двойное нажатие «Отложить» не заведёт два перевода (создание с тем же id идемпотентно)
  const txId = useRef(newId());

  const source = sources.find((w) => w.id === picked) ?? sources.find((w) => w.id === preferred) ?? sources[0];
  const sourceBalance = source ? (balances?.get(source.id) ?? null) : null;
  const short = amount !== null && amount > 0 && sourceBalance !== null && amount > sourceBalance;

  const save = async () => {
    if (busy.current) return;
    setFormError(null);
    if (!source) return setFormError('Выберите кошелёк, откуда отложить');
    if (amount === null || amount <= 0) return setAmountError('Введите сумму больше нуля');
    busy.current = true;
    setSaving(true);
    try {
      const tx = await store.transactions.create(
        {
          kind: 'transfer',
          walletId: source.id,
          toWalletId: goalWallet.id,
          amountMinor: amount,
          toAmountMinor: amount,
          categoryId: null,
          occurredOn: today,
          note: note ?? '',
        },
        { id: txId.current },
      );
      toastWithUndo(
        toast,
        `Отложено ${formatMinor(amount, currency)} на цель «${goal.name}»`,
        () => store.transactions.softDelete(tx.id),
        'Перевод отменён',
      );
      onSaved?.();
      onClose();
    } catch (e) {
      console.error('Не удалось отложить:', e);
      setFormError(e instanceof ValidationError ? e.message : humanError(e, 'Не удалось отложить. Данные не изменены, попробуйте ещё раз.'));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={`Отложить на «${goal.name}»`}
      footer={
        <div className="flex flex-col gap-2">
          {formError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} disabled={sources.length === 0} onClick={() => void save()}>
            Отложить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5" data-testid="save-now">
        <div className="flex flex-col gap-1">
          <AmountInput
            label="Сколько отложить"
            currency={currency}
            value={amount}
            error={amountError}
            showKeypad={false}
            onChange={(v) => {
              setAmount(v);
              setAmountError(null);
              setFormError(null);
            }}
          />
          <p className="text-center text-sm text-muted">Переведём на «{goalWallet.name}» — кошелёк этой цели.</p>
        </div>

        {sources.length === 0 ? (
          <p role="note" className="text-sm font-medium text-warning" data-testid="save-now-no-source">
            Нет другого кошелька в {currency}, откуда можно отложить. Заведите его на экране «Кошельки».
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Field id="save-now-source" label="Откуда">
              <select
                id="save-now-source"
                value={source?.id ?? ''}
                onChange={(e) => {
                  setPicked(e.target.value);
                  setFormError(null);
                }}
                className={`${inputClasses(false)} min-h-[48px]`}
              >
                {sources.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            {source && sourceBalance !== null && (
              <p className="text-sm text-muted">
                Сейчас на «{source.name}»: <MoneyText minor={sourceBalance} currency={currency} tone="none" className="font-semibold" />
              </p>
            )}
            {short && source && sourceBalance !== null && (
              <p role="note" className="text-sm font-medium text-warning" data-testid="save-now-short">
                На «{source.name}» меньше, чем вы откладываете: после перевода остаток станет отрицательным. Перевод всё равно можно сохранить.
              </p>
            )}
          </div>
        )}

        {note && <p className="text-sm text-muted">В заметке к переводу будет: «{note}».</p>}
      </div>
    </Sheet>
  );
}
