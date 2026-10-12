import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { TextArea } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { itemTitle, UNIT_LABEL } from '@/domain/shopping';
import { parseShoppingText, MAX_PARSED_ITEMS, type ParsedItem } from '@/domain/shoppingText';
import { pluralRu } from '@/lib/plural';

export interface ListTextSheetProps {
  /** Добавить позиции по порядку. Бросает — окно остаётся и показывает ошибку. */
  onAdd: (items: ParsedItem[]) => Promise<void>;
  onClose: () => void;
}

/**
 * «Добавить списком»: человек диктует (значок микрофона на клавиатуре телефона) или набирает весь список одним текстом, приложение
 * разбирает его на позиции (domain/shoppingText.ts) и показывает результат ДО добавления: ошибки видно и правятся прямо в тексте.
 */
export function ListTextSheet({ onAdd, onClose }: ListTextSheetProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const items = useMemo(() => parseShoppingText(text), [text]);

  const add = async () => {
    if (busy.current || items.length === 0) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await onAdd(items);
      onClose();
    } catch (e) {
      console.error('Не удалось добавить список:', e);
      setError(e instanceof Error && e.message ? e.message : 'Не удалось добавить список. Попробуйте ещё раз.');
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
      title="Добавить списком"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} disabled={items.length === 0} onClick={() => void add()}>
            {items.length === 0 ? 'Добавить' : `Добавить ${items.length} ${pluralRu(items.length, 'позицию', 'позиции', 'позиций')}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <TextArea
          label="Что купить"
          hint="Нажмите значок микрофона на клавиатуре телефона и скажите, например: «молоко два литра, хлеб три штуки, яблоки полтора килограмма»"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoComplete="off"
          data-autofocus
        />
        {text.trim() !== '' && items.length === 0 && (
          <p role="status" className="text-sm text-muted">
            Пока не вижу товаров. Назовите товар и, если нужно, количество: «молоко два литра».
          </p>
        )}
        {items.length > 0 && (
          <section aria-label="Что будет добавлено" data-testid="parsed-items">
            <h3 className="mb-1 text-sm font-semibold text-muted">Будет добавлено · проверьте</h3>
            <ul className="divide-y divide-border rounded-2xl bg-surface-2 px-3">
              {items.map((i, n) => (
                <li key={`${i.name}-${n}`} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate font-medium">{i.name}</span>
                  <span className="shrink-0 text-muted">
                    {i.unit === 'pcs' && i.qtyMilli === 1000 ? '1 шт' : itemTitle('', i.qtyMilli, i.unit).trim() || UNIT_LABEL[i.unit]}
                  </span>
                </li>
              ))}
            </ul>
            {items.length >= MAX_PARSED_ITEMS && <p className="mt-1 text-sm text-warning">За один раз добавляется не больше {MAX_PARSED_ITEMS} позиций.</p>}
          </section>
        )}
      </div>
    </Sheet>
  );
}
