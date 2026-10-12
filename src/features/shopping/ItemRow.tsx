import { Icon } from '@/components/Icon';
import { itemTitle, type ItemView } from '@/domain/shopping';
import type { CurrencyCode } from '@/domain/types';
import { cn } from '@/lib/cn';
import { approxText, perUnitText, priceText, rememberedText } from './shoppingText';

export interface ItemRowProps {
  view: ItemView;
  currency: CurrencyCode;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

/**
 * Строка позиции: флажок, название с количеством, справа цена.
 * Отмеченная: цена из магазина и «13,00 за л»; под названием «раньше …». Неотмеченная: «≈ …» и «обычно …».
 */
export function ItemRow({ view, currency, busy, onToggle, onOpen }: ItemRowProps) {
  const { item, checked, priceMinor, approx, unitMinor, lastUnitMinor } = view;
  const title = itemTitle(item.name, item.qtyMilli, item.unit);
  const note =
    lastUnitMinor === null
      ? checked
        ? 'цена запомнится'
        : 'цены ещё нет'
      : `${checked ? 'раньше' : 'обычно'} ${rememberedText(lastUnitMinor, item.unit, currency)}`;
  return (
    <li className="flex items-center gap-1 pl-1 pr-3" data-testid="shopping-item">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? `Достать из корзины: ${item.name}` : `Положить в корзину: ${item.name}`}
        disabled={busy}
        onClick={onToggle}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg border-2 transition-colors',
            checked ? 'border-brand bg-brand text-brand-fg' : 'border-border-strong bg-surface/70',
          )}
        >
          {checked && <Icon name="check" size={16} />}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Изменить: ${title}`}
        className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-base font-semibold', checked && 'text-text')}>{title}</span>
          <span className="block truncate text-sm text-muted">{note}</span>
        </span>
        <span className="shrink-0 text-right">
          {priceMinor === null ? (
            <span className="money text-base text-muted" aria-label="Цена неизвестна">
              —
            </span>
          ) : (
            <span className={cn('money block text-base', approx ? 'text-muted' : 'font-semibold text-text')}>
              {approx ? approxText(priceMinor, currency) : priceText(priceMinor, currency)}
            </span>
          )}
          {unitMinor !== null && <span className="money block text-sm text-muted">{perUnitText(unitMinor, item.unit, currency)}</span>}
        </span>
      </button>
    </li>
  );
}
