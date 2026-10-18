import { Icon } from '@/components/Icon';
import { useReceipt } from '@/db';
import { formatMinor } from '@/domain/money';
import { itemTitle, unitPrice } from '@/domain/shopping';
import type { CurrencyCode } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { perUnitText, priceText } from './shoppingText';

/**
 * «Чек» расхода: из чего состояла покупка из списка. Нет позиций (обычный расход) — ничего не показывает.
 * Состав не меняется, даже если сумму расхода поправили позже.
 */
export function Receipt({ txId, currency }: { txId: string; currency: CurrencyCode }) {
  const items = useReceipt(txId);
  if (!items || items.length === 0) return null;
  let total = 0;
  for (const i of items) total += i.priceMinor ?? 0;
  return (
    <section aria-label="Чек" data-testid="receipt" className="mb-3 rounded-2xl bg-surface-2 p-3">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
        <Icon name="cart" size={16} className="text-brand" />
        Чек · {items.length} {pluralRu(items.length, 'позиция', 'позиции', 'позиций')}
      </h3>
      <ul className="divide-y divide-border/60">
        {items.map((i) => {
          const u = i.priceMinor === null ? null : unitPrice(i.priceMinor, i.qtyMilli);
          return (
            <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">{itemTitle(i.name, i.qtyMilli, i.unit)}</span>
              <span className="money shrink-0 text-right">
                {i.priceMinor === null ? '—' : priceText(i.priceMinor, currency)}
                {u !== null && <span className="block text-xs text-muted">{perUnitText(u, i.unit, currency)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 flex justify-between border-t border-border/60 pt-1.5 text-sm font-semibold">
        <span>Итого по чеку</span>
        <span className="money">{formatMinor(total, currency, { fraction: 'always' })}</span>
      </p>
    </section>
  );
}
