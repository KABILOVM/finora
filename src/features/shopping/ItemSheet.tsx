import { useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Field, TextInput, inputClasses } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { SHOPPING_TITLE_MAX } from '@/db/validateShopping';
import type { CurrencyCode, Minor, ShoppingItem, ShoppingUnit } from '@/domain/types';
import { UNIT_OPTIONS, parseQty, qtyNumber } from './shoppingText';

export interface ItemSheetProps {
  item: ShoppingItem;
  currency: CurrencyCode;
  onSave: (item: ShoppingItem) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Правка одного товара: название, количество с единицей, цена всей строки (с калькулятором). */
export function ItemSheet({ item, currency, onSave, onDelete, onClose }: ItemSheetProps) {
  const [title, setTitle] = useState(item.title);
  const [qty, setQty] = useState(qtyNumber(item.qty));
  const [unit, setUnit] = useState<ShoppingUnit>(item.unit);
  const [price, setPrice] = useState<Minor | null>(item.priceMinor);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const name = title.trim();
    if (name === '') return setError('Введите название товара');
    const q = parseQty(qty);
    if (q === null) return setError('Количество: число больше нуля, до трёх знаков после запятой');
    onSave({ ...item, title: name, qty: q, unit, priceMinor: price === null || price <= 0 ? null : price });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Товар"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <Button size="lg" fullWidth onClick={save}>
            Сохранить
          </Button>
          <Button variant="ghost" fullWidth onClick={onDelete}>
            Убрать из списка
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <TextInput label="Название" value={title} maxLength={SHOPPING_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <TextInput label="Количество" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Field id="shopping-unit" label="Единица">
            <select
              id="shopping-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value as ShoppingUnit)}
              className={`${inputClasses(false)} min-h-[48px]`}
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-text">Цена за всё количество</p>
          <AmountInput label="Цена товара" currency={currency} value={price} onChange={setPrice} calculator />
        </div>
      </div>
    </Sheet>
  );
}
