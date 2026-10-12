import { useState } from 'react';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Segmented } from '@/components/Segmented';
import { expectedPrice, itemTitle, NAME_MAX, parseQty, priceKey, qtyToInput, UNIT_LABEL } from '@/domain/shopping';
import type { ParsedItem } from '@/domain/shoppingAi';
import { findInCatalog, suggestFromCatalog, type CatalogEntry } from '@/domain/shoppingCatalog';
import type { CurrencyCode, Minor, ShoppingUnit } from '@/domain/types';
import { cn } from '@/lib/cn';
import { priceText } from './shoppingText';

export interface EditableItem extends ParsedItem {
  /** Номер строки: не меняется при правке и удалении других строк. */
  rid: number;
}

export interface ParsedItemsEditorProps {
  items: readonly EditableItem[];
  onChange: (items: EditableItem[]) => void;
  catalog: readonly CatalogEntry[];
  /** Память цен: цена за единицу по «название|единица». */
  memory: ReadonlyMap<string, Minor>;
  currency: CurrencyCode;
}

const UNIT_OPTIONS = (['pcs', 'kg', 'l'] as const).map((u) => ({ value: u, label: UNIT_LABEL[u] }));

const amount = (i: ParsedItem): string =>
  i.unit === 'pcs' && i.qtyMilli === 1000 ? '1 шт' : itemTitle('', i.qtyMilli, i.unit).trim() || UNIT_LABEL[i.unit];

/** Ожидаемая цена позиции из памяти цен или null. */
function guess(i: ParsedItem, memory: ReadonlyMap<string, Minor>): Minor | null {
  const last = memory.get(priceKey(i.name, i.unit));
  return last === undefined ? null : expectedPrice(last, i.qtyMilli);
}

/**
 * Строки результата разбора: каждую можно нажать и поправить (название, количество, единица шт/кг/л) или убрать.
 * Под названием видно, найдена ли позиция в каталоге (то, что уже покупали) и сколько она примерно стоит.
 */
export function ParsedItemsEditor({ items, onChange, catalog, memory, currency }: ParsedItemsEditorProps) {
  const [open, setOpen] = useState<number | null>(null);
  const patch = (rid: number, p: Partial<ParsedItem>) => onChange(items.map((i) => (i.rid === rid ? { ...i, ...p } : i)));

  return (
    <ul className="divide-y divide-border rounded-2xl bg-surface-2 px-1">
      {items.map((i) => {
        const isOpen = open === i.rid;
        const linked = findInCatalog(i.name, catalog) !== null;
        const price = guess(i, memory);
        return (
          <li key={i.rid} className="py-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`Изменить: ${i.name}`}
                onClick={() => setOpen(isOpen ? null : i.rid)}
                className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left active:bg-border/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.name}</span>
                  {(linked || price !== null) && (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      {linked && (
                        <>
                          <Icon name="check" size={12} className="text-brand" />
                          <span>в каталоге</span>
                        </>
                      )}
                      {linked && price !== null && <span aria-hidden="true">·</span>}
                      {price !== null && <span className="money">≈ {priceText(price, currency)}</span>}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted">{amount(i)}</span>
                <Icon name="chevron" size={16} className={cn('shrink-0 text-muted transition-transform', isOpen && 'rotate-90')} />
              </button>
              <IconButton
                icon="close"
                iconSize={18}
                label={`Убрать: ${i.name}`}
                onClick={() => onChange(items.filter((x) => x.rid !== i.rid))}
              />
            </div>
            {isOpen && (
              <RowEditor
                item={i}
                catalog={catalog}
                onPatch={(p) => patch(i.rid, p)}
                onDone={() => setOpen(null)}
                onRemove={() => {
                  setOpen(null);
                  onChange(items.filter((x) => x.rid !== i.rid));
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RowEditor({
  item,
  catalog,
  onPatch,
  onDone,
  onRemove,
}: {
  item: EditableItem;
  catalog: readonly CatalogEntry[];
  onPatch: (p: Partial<ParsedItem>) => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  // Поля хранят набранный текст; в позицию попадает только то, что можно сохранить (название не пустое, количество — число).
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(qtyToInput(item.qtyMilli));
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const suggestions = suggestFromCatalog(name, catalog);

  const changeName = (v: string) => {
    setName(v);
    const t = v.trim();
    if (t === '') return setNameError('Впишите название товара');
    if ([...t].length > NAME_MAX) return setNameError(`Название не длиннее ${NAME_MAX} символов`);
    setNameError(null);
    onPatch({ name: t });
  };
  const changeQty = (v: string, unit: ShoppingUnit = item.unit) => {
    setQty(v);
    const m = parseQty(v, unit);
    if (m === null)
      return setQtyError(unit === 'pcs' ? 'Штуки — целое число, например 3' : 'Число до трёх знаков после запятой, например 1,5');
    setQtyError(null);
    onPatch({ qtyMilli: m, unit });
  };
  const changeUnit = (unit: ShoppingUnit) => {
    // штуки — только целые: «1,5» при переходе на «шт» округляется вниз
    const before = parseQty(qty, 'kg');
    const next = unit === 'pcs' && before !== null && before % 1000 !== 0 ? String(Math.max(1, Math.floor(before / 1000))) : qty;
    setQty(next);
    const m = parseQty(next, unit);
    setQtyError(
      m === null ? (unit === 'pcs' ? 'Штуки — целое число, например 3' : 'Число до трёх знаков после запятой, например 1,5') : null,
    );
    onPatch(m === null ? { unit } : { unit, qtyMilli: m });
  };
  const pick = (c: CatalogEntry) => {
    setName(c.name);
    setNameError(null);
    onPatch({ name: c.name, unit: c.unit, ...(c.unit === 'pcs' && item.qtyMilli % 1000 !== 0 ? { qtyMilli: 1000 } : {}) });
    if (c.unit === 'pcs' && item.qtyMilli % 1000 !== 0) setQty('1');
  };

  return (
    <div className="flex flex-col gap-3 px-2 pb-3 pt-1" data-testid="row-editor">
      <TextInput
        label="Название"
        value={name}
        onChange={(e) => changeName(e.target.value)}
        error={nameError}
        autoComplete="off"
        enterKeyHint="done"
      />
      {suggestions.length > 0 && (
        <div role="group" aria-label="Из каталога" className="flex flex-wrap gap-1.5">
          {suggestions.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => pick(c)}
              className="min-h-[36px] rounded-full border border-border bg-surface px-3 text-sm font-medium active:bg-border/50"
            >
              {c.name} · {UNIT_LABEL[c.unit]}
            </button>
          ))}
        </div>
      )}
      <Segmented ariaLabel="Единица" options={UNIT_OPTIONS} value={item.unit} onChange={changeUnit} />
      <TextInput
        label={`Количество, ${UNIT_LABEL[item.unit]}`}
        value={qty}
        onChange={(e) => changeQty(e.target.value)}
        inputMode={item.unit === 'pcs' ? 'numeric' : 'decimal'}
        error={qtyError}
        autoComplete="off"
        enterKeyHint="done"
      />
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button
          variant="ghost"
          icon="trash"
          aria-label={`Убрать позицию: ${item.name}`}
          className="!text-danger hover:!bg-danger/10"
          onClick={onRemove}
        >
          Убрать
        </Button>
        <Button onClick={onDone}>Готово</Button>
      </div>
    </div>
  );
}
