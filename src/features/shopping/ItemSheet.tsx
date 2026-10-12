import { useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { ValidationError } from '@/db';
import { NAME_MAX, parseQty, qtyToInput, UNIT_LABEL, type ItemView } from '@/domain/shopping';
import type { CurrencyCode, Minor, ShoppingUnit } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';

export interface ItemFormValue {
  name: string;
  qtyMilli: number;
  unit: ShoppingUnit;
  /** Только у отмеченной позиции. */
  priceMinor: Minor | null;
}

export interface ItemSheetProps {
  /** null — новая позиция. */
  view: ItemView | null;
  currency: CurrencyCode;
  /** Прошлые покупки: быстрый выбор названия вместе с единицей. */
  recent: readonly { name: string; unit: ShoppingUnit }[];
  onSave: (value: ItemFormValue) => Promise<void>;
  onRemove?: () => Promise<void>;
  onClose: () => void;
}

const UNIT_OPTIONS = (['pcs', 'kg', 'l'] as const).map((u) => ({ value: u, label: UNIT_LABEL[u] }));

/** Добавить или изменить позицию: название, количество, единица (шт / кг / л); у отмеченной ещё и цена. */
export function ItemSheet({ view, currency, recent, onSave, onRemove, onClose }: ItemSheetProps) {
  const item = view?.item ?? null;
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<ShoppingUnit>(item?.unit ?? 'pcs');
  const [qty, setQty] = useState(item ? qtyToInput(item.qtyMilli) : '1');
  const [price, setPrice] = useState<Minor | null>(item?.priceMinor ?? null);
  const [errors, setErrors] = useState<{ name?: string; qty?: string; price?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const checked = view?.checked === true;

  const changeUnit = (next: ShoppingUnit) => {
    setUnit(next);
    // штуки — только целые: «1,5» при переходе на «шт» округляется вниз до целого
    if (next === 'pcs') {
      const m = parseQty(qty, 'kg');
      if (m !== null && m % 1000 !== 0) setQty(String(Math.max(1, Math.floor(m / 1000))));
    }
    setErrors((e) => ({ ...e, qty: undefined }));
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await fn();
      onClose();
    } catch (e) {
      if (!(e instanceof ValidationError)) console.error('Не удалось сохранить позицию:', e);
      setErrors({ form: e instanceof ValidationError ? e.message : 'Не удалось сохранить. Данные не изменены, попробуйте ещё раз.' });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const save = () => {
    const trimmed = name.trim();
    const next: typeof errors = {};
    if (trimmed === '') next.name = 'Впишите название товара';
    else if ([...trimmed].length > NAME_MAX) next.name = `Название не длиннее ${NAME_MAX} символов`;
    const qtyMilli = parseQty(qty, unit);
    if (qtyMilli === null) next.qty = unit === 'pcs' ? 'Штуки — целое число, например 3' : 'Количество — число до трёх знаков после запятой, например 1,4';
    if (checked && price === null) next.price = 'Впишите цену или достаньте позицию из корзины';
    setErrors(next);
    if (Object.keys(next).length > 0 || qtyMilli === null) return;
    void run(() => onSave({ name: trimmed, qtyMilli, unit, priceMinor: checked ? price : null }));
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={item ? 'Позиция' : 'Новая позиция'}
      footer={
        <div className="flex flex-col gap-2">
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <div className={onRemove ? 'grid grid-cols-[auto_1fr] gap-2' : ''}>
            {onRemove && (
              <Button variant="ghost" size="lg" icon="trash" aria-label="Удалить позицию" className="!text-danger hover:!bg-danger/10" disabled={saving} onClick={() => void run(onRemove)}>
                Удалить
              </Button>
            )}
            <Button size="lg" fullWidth loading={saving} onClick={save}>
              {item ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextInput
          label="Название"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((x) => ({ ...x, name: undefined, form: undefined }));
          }}
          error={errors.name}
          autoComplete="off"
          enterKeyHint="done"
          data-autofocus
        />
        {!item && name.trim() === '' && recent.length > 0 && (
          <FieldGroup label="Покупали раньше">
            <ChipPicker
              ariaLabel="Покупали раньше"
              value={null}
              onChange={(v) => {
                const hit = recent[Number(v)];
                if (!hit) return;
                setName(hit.name);
                changeUnit(hit.unit);
              }}
              options={recent.map((r, i) => ({ value: String(i), label: r.name }))}
            />
          </FieldGroup>
        )}
        <FieldGroup label="Единица">
          <Segmented ariaLabel="Единица" options={UNIT_OPTIONS} value={unit} onChange={changeUnit} />
        </FieldGroup>
        <TextInput
          label={`Количество, ${UNIT_LABEL[unit]}`}
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            setErrors((x) => ({ ...x, qty: undefined, form: undefined }));
          }}
          inputMode={unit === 'pcs' ? 'numeric' : 'decimal'}
          error={errors.qty}
          autoComplete="off"
          enterKeyHint="done"
        />
        {checked && (
          <FieldGroup label="Цена в магазине (за всю позицию)" error={errors.price}>
            <AmountInput label="Цена в магазине" currency={currency} value={price} onChange={(v) => { setPrice(v); setErrors((x) => ({ ...x, price: undefined })); }} tone="expense" showKeypad={false} />
          </FieldGroup>
        )}
      </form>
    </Sheet>
  );
}
