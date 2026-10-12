import { useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { itemTitle, type ItemView } from '@/domain/shopping';
import type { CurrencyCode, Minor } from '@/domain/types';
import { priceText, rememberedText } from './shoppingText';

export interface PriceSheetProps {
  view: ItemView;
  currency: CurrencyCode;
  /** Сохранить цену (кладёт позицию в корзину). Бросает — окно остаётся и показывает ошибку. */
  onSave: (priceMinor: Minor) => Promise<void>;
  onClose: () => void;
}

/** «Цена в магазине»: цена за всю позицию, заранее подставлена ожидаемая (если она известна). */
export function PriceSheet({ view, currency, onSave, onClose }: PriceSheetProps) {
  const { item, priceMinor, lastUnitMinor } = view;
  const [amount, setAmount] = useState<Minor | null>(priceMinor);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const save = async () => {
    if (busy.current) return;
    if (amount === null) return setError('Впишите цену с ценника');
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(amount);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить цену. Попробуйте ещё раз.');
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
      title="Цена в магазине"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()}>
            В корзину
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-center text-muted">
          За всю позицию: <span className="font-semibold text-text">{itemTitle(item.name, item.qtyMilli, item.unit)}</span>
        </p>
        <AmountInput label="Цена за всю позицию" currency={currency} value={amount} onChange={(v) => { setAmount(v); setError(null); }} tone="expense" calculator />
        {lastUnitMinor !== null && (
          <p className="text-center text-sm text-muted">
            Обычно {rememberedText(lastUnitMinor, item.unit, currency)}
            {priceMinor !== null ? `, ожидалось ${priceText(priceMinor, currency)}` : ''}
          </p>
        )}
      </div>
    </Sheet>
  );
}
