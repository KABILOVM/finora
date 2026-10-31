import { Card } from '@/components/Card';
import { itemTitle } from '@/domain/shopping';
import type { CurrencyCode, ShoppingItem } from '@/domain/types';
import { formatDayInline, todayLocal } from '@/lib/dates';
import { priceText } from './shoppingText';

export interface PurchasedListProps {
  /** Купленные позиции, свежие первыми. */
  items: readonly ShoppingItem[];
  currency: CurrencyCode;
}

/** Прошлые покупки (фильтр «Куплено»): название с количеством, цена и день покупки. Только чтение: купленное уже не меняется. */
export function PurchasedList({ items, currency }: PurchasedListProps) {
  return (
    <Card padding="none" className="mb-4">
      <ul className="divide-y divide-border" aria-label="Купленное">
        {items.map((it) => (
          <li key={it.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2" data-testid="shopping-bought-item">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold">{itemTitle(it.name, it.qtyMilli, it.unit)}</span>
              <span className="block truncate text-sm text-muted">
                {it.purchasedAt === null ? 'куплено' : `куплено ${formatDayInline(todayLocal(new Date(it.purchasedAt)))}`}
              </span>
            </span>
            {it.priceMinor !== null && <span className="money shrink-0 text-base font-semibold">{priceText(it.priceMinor, currency)}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
