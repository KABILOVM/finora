import { useState } from 'react';
import { TextInput } from '@/components/Field';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { IconSelect } from '@/components/IconSelect';
import { MoneyText } from '@/components/MoneyText';
import { Segmented } from '@/components/Segmented';
import { draftToMinor } from '@/components/amountText';
import type { ChipOption } from '@/components/ChipPicker';
import type { DictCategory } from '@/domain/expensesAi';
import { normName, searchCatalog } from '@/domain/products/catalog';
import type { ReceiptLineDraft } from '@/features/receipt/receiptAi';
import { itemTitle, NAME_MAX, parseQty, UNIT_LABEL } from '@/domain/shopping';
import type { CurrencyCode, ShoppingUnit } from '@/domain/types';
import { suggestGlyph } from '@/features/categories/suggestGlyph';
import { NewCategory } from '@/features/dictation/DraftExpensesEditor';
import { cn } from '@/lib/cn';

const UNITS = (['pcs', 'kg', 'l'] as const).map((u) => ({ value: u, label: UNIT_LABEL[u] }));
const NO_CATEGORY = '__none__';
const NEW_PREFIX = '__new__';
const TAG = suggestGlyph('');

export interface ReceiptLinesEditorProps {
  lines: readonly ReceiptLineDraft[];
  onChange: (lines: ReceiptLineDraft[]) => void;
  categories: readonly DictCategory[];
  currency: CurrencyCode;
  /** Ошибки по номеру строки (поверх проверки самой строки). */
  errors?: ReadonlyMap<number, string>;
  /** Какую строку раскрыть сразу (только что добавленную). */
  openRid?: number | null;
  onOpenChange?: (rid: number | null) => void;
  /** Название — не из каталога и не из ваших покупок: строка помечается «Новый продукт». Нет — пометок нет. */
  isNewProduct?: (name: string) => boolean;
}

/**
 * Позиции чека: строка — значок категории, название, количество и категория, справа цена. Нажатие раскрывает правку (название,
 * количество и единица шт/кг/л, цена за всю позицию, категория значками, «Новая категория»); крестик убирает позицию.
 */
export function ReceiptLinesEditor({ lines, onChange, categories, currency, errors, openRid = null, onOpenChange, isNewProduct }: ReceiptLinesEditorProps) {
  const [openState, setOpenState] = useState<number | null>(null);
  const open = onOpenChange ? openRid : openState;
  const setOpen = onOpenChange ?? setOpenState;
  const patch = (rid: number, p: Partial<ReceiptLineDraft>) => onChange(lines.map((l) => (l.rid === rid ? { ...l, ...p } : l)));
  const choices: ChipOption[] = [{ value: NO_CATEGORY, label: 'Без категории', icon: TAG }, ...categories.map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color }))];

  return (
    <ul className="divide-y divide-border rounded-2xl bg-surface-2/70 px-1" data-testid="receipt-lines">
      {lines.map((l) => {
        const isOpen = open === l.rid;
        const qty = parseQty(l.qtyText, l.unit);
        const price = l.priceText.trim() === '' ? null : draftToMinor(l.priceText.trim(), currency);
        const category = l.categoryId ? categories.find((c) => c.id === l.categoryId) : undefined;
        const fresh = !category && l.newCategory ? l.newCategory : null;
        const label = l.name.trim() || 'Без названия';
        const error = errors?.get(l.rid) ?? null;
        const isNew = l.name.trim() !== '' && isNewProduct?.(l.name) === true;
        // подсказки каталога под названием: пока набранное не совпало с продуктом целиком
        const hints = isOpen && normName(l.name).length >= 2 ? searchCatalog(l.name, { limit: 4 }).filter((p) => normName(p.name) !== normName(l.name)) : [];
        return (
          <li key={l.rid} data-testid="receipt-line" className="py-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`Изменить: ${label}`}
                onClick={() => setOpen(isOpen ? null : l.rid)}
                className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1 text-left active:bg-border/50"
              >
                <Glyph value={category?.icon ?? (fresh ? suggestGlyph(fresh) : TAG)} color={category?.color} size={36} className={fresh ? 'opacity-80' : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{qty !== null && !(l.unit === 'pcs' && qty === 1000) ? itemTitle(label, qty, l.unit) : label}</span>
                  <span className="block truncate text-xs text-muted">
                    {category?.name ?? (fresh ? `${fresh} · новая` : 'Без категории')}
                    {isNew && (
                      <>
                        {' · '}
                        <span className="font-semibold text-brand" data-testid="new-product">
                          Новый продукт
                        </span>
                      </>
                    )}
                  </span>
                  {error && <span className="block text-xs font-semibold text-danger">{error}</span>}
                </span>
                <span className="shrink-0 text-right font-semibold">
                  {price !== null ? <MoneyText minor={price} currency={currency} tone="none" /> : <span className="text-muted">—</span>}
                </span>
                <Icon name="chevron" size={16} className={cn('shrink-0 text-muted transition-transform', isOpen && 'rotate-90')} />
              </button>
              <IconButton icon="close" iconSize={18} label={`Убрать: ${label}`} onClick={() => onChange(lines.filter((x) => x.rid !== l.rid))} />
            </div>
            {isOpen && (
              <div className="flex flex-col gap-2 px-2 pb-3 pt-1">
                <TextInput label="Название" value={l.name} maxLength={NAME_MAX} onChange={(e) => patch(l.rid, { name: e.target.value })} />
                {hints.length > 0 && (
                  <div role="group" aria-label="Из каталога" className="flex flex-wrap gap-1.5">
                    {hints.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => patch(l.rid, { name: p.name })}
                        className="min-h-[44px] rounded-full border border-border bg-surface px-3 text-sm font-medium active:bg-border/50"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <TextInput label="Количество" inputMode="decimal" value={l.qtyText} onChange={(e) => patch(l.rid, { qtyText: e.target.value.replace('.', ',') })} />
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold">Единица</span>
                    <Segmented ariaLabel={`Единица: ${label}`} options={UNITS} value={l.unit} onChange={(unit: ShoppingUnit) => patch(l.rid, { unit })} compact />
                  </div>
                </div>
                <TextInput
                  label="Цена за всю позицию"
                  inputMode="decimal"
                  placeholder="0"
                  value={l.priceText}
                  onChange={(e) => patch(l.rid, { priceText: e.target.value.replace('.', ',') })}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">Категория</span>
                  <IconSelect
                    size="sm"
                    label="Категория"
                    options={[...(l.newCategory ? [{ value: NEW_PREFIX, label: `Новая: ${l.newCategory}`, icon: suggestGlyph(l.newCategory) }] : []), ...choices]}
                    value={l.categoryId || (l.newCategory ? NEW_PREFIX : NO_CATEGORY)}
                    onChange={(v) => {
                      if (v === NEW_PREFIX) return patch(l.rid, { categoryId: '' });
                      patch(l.rid, v === NO_CATEGORY ? { categoryId: '', newCategory: '' } : { categoryId: v, newCategory: '' });
                    }}
                    footer={(close) => (
                      <NewCategory
                        existing={categories}
                        onPick={(id) => {
                          patch(l.rid, { categoryId: id, newCategory: '' });
                          close();
                        }}
                        onCreate={(name) => {
                          patch(l.rid, { categoryId: '', newCategory: name });
                          close();
                        }}
                      />
                    )}
                  />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
