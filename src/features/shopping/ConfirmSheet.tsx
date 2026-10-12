import { useMemo, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Field, TextInput, inputClasses } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useCategories, useSettings, useStore, useWallets, uuidV5 } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, Minor, ShoppingItem, ShoppingList, UUID } from '@/domain/types';
import { humanError } from '@/features/transactions/txActions';
import { useToday } from '@/recurring/useToday';
import { boughtTotals, itemsWord, leftoverItems, purchaseNote } from './shoppingText';

export interface ConfirmSheetProps {
  list: LocalRow<ShoppingList>;
  items: readonly ShoppingItem[];
  onDone: (leftoverListId: UUID | null) => void;
  onClose: () => void;
}

/**
 * Подтверждение покупки: итог (по ценам отмеченных товаров или вписанный вручную), кошелёк, категория, дата и судьба не купленного.
 * Расход получает id v5(список, 'shopping-confirm'): повторное нажатие и вторая вкладка не задвоят расход.
 */
export function ConfirmSheet({ list, items, onDone, onClose }: ConfirmSheetProps) {
  const store = useStore();
  const today = useToday();
  const settings = useSettings();
  const wallets = useWallets();
  const categories = useCategories('expense');

  const bought = useMemo(() => items.filter((i) => i.checked), [items]);
  const left = useMemo(() => items.filter((i) => !i.checked), [items]);
  const sums = useMemo(() => boughtTotals(items), [items]);

  const [total, setTotal] = useState<Minor | null>(sums.sum !== null && sums.sum > 0 ? sums.sum : null);
  const [walletId, setWalletId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(today);
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // кошельки той же валюты, что и цены списка (расход в другой валюте потребовал бы курс — это не для быстрой покупки)
  const usable = (wallets ?? []).filter((w) => w.currency === list.currency && w.kind !== 'savings');
  const walletValue = walletId !== '' ? walletId : (usable.find((w) => w.id === settings?.defaultWalletId)?.id ?? usable[0]?.id ?? '');
  const categoryValue = categoryId !== undefined ? categoryId : (list.categoryId ?? '');

  const confirm = async () => {
    if (saving) return;
    setError(null);
    if (total === null || total <= 0) return setError('Введите итог покупки: сумму больше нуля');
    if (walletValue === '') return setError(`Нужен кошелёк в валюте ${list.currency}: создайте его в разделе «Кошельки»`);
    setSaving(true);
    try {
      const transactionId = await uuidV5(list.id, 'shopping-confirm');
      await store.transactions.create(
        {
          kind: 'expense',
          walletId: walletValue,
          amountMinor: total,
          categoryId: categoryValue === '' ? null : categoryValue,
          occurredOn: date,
          note: purchaseNote(list.name, bought),
        },
        { id: transactionId },
      );
      await store.shopping.confirm(list.id, {
        totalMinor: total,
        doneOn: date,
        transactionId,
        items: bought,
        categoryId: categoryValue === '' ? null : categoryValue,
      });
      let leftId: UUID | null = null;
      if (keep && left.length > 0) {
        const next = await store.shopping.create({ name: `${list.name} (остаток)`.slice(0, 60), items: leftoverItems(left), categoryId: categoryValue === '' ? null : categoryValue });
        leftId = next.id;
      }
      onDone(leftId);
    } catch (e) {
      console.error('Не удалось подтвердить покупку:', e);
      setError(humanError(e, 'Не удалось подтвердить покупку. Данные не изменены, попробуйте ещё раз.'));
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title="Подтвердить покупку"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void confirm()}>
            Записать расход
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          Куплено: {itemsWord(bought.length)}
          {sums.sum !== null && sums.sum > 0 && ` · по ценам ${formatMinor(sums.sum, list.currency)}`}
          {sums.unpriced > 0 && bought.length > 0 && ` · у ${sums.unpriced} цены нет`}
        </p>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-text">Итог по чеку</p>
          <AmountInput label="Итог покупки" currency={list.currency} value={total} onChange={setTotal} tone="expense" calculator />
        </div>
        <Field id="shop-wallet" label="Из какого кошелька">
          <select
            id="shop-wallet"
            value={walletValue}
            onChange={(e) => setWalletId(e.target.value)}
            className={`${inputClasses(false)} min-h-[48px]`}
          >
            {usable.length === 0 && <option value="">Нет кошелька в {list.currency}</option>}
            {usable.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="shop-category" label="Категория">
          <select
            id="shop-category"
            value={categoryValue}
            onChange={(e) => setCategoryId(e.target.value)}
            className={`${inputClasses(false)} min-h-[48px]`}
          >
            <option value="">Без категории</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <TextInput label="Дата" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        {left.length > 0 && (
          <label className="flex min-h-[48px] items-start gap-3 rounded-2xl bg-surface-2 p-3">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="mt-1 h-5 w-5 accent-brand" />
            <span>
              <span className="block font-semibold">Не купили: {itemsWord(left.length)}</span>
              <span className="block text-sm text-muted">{keep ? 'Оставим в новом списке на следующий раз.' : 'Уберём из списка.'}</span>
            </span>
          </label>
        )}
      </div>
    </Sheet>
  );
}
