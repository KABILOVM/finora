import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { itemTitle, unitPrice, UNIT_LABEL } from '@/domain/shopping';
import { PRODUCT_GROUPS, type Product } from '@/domain/products/catalog';
import { productKeyOf, type PriceBook, type ProductStats } from '@/domain/products/stats';
import type { CurrencyCode, LocalRow, ShoppingItem, ShoppingUnit } from '@/domain/types';
import { averageBasisText, moneyText, purchaseDate } from './productText';

/** Что показать в карточке: продукт каталога или свой (из покупок). */
export interface ProductView {
  key: string;
  name: string;
  unit: ShoppingUnit;
  /** Раздел каталога; у своих продуктов нет. */
  group?: string;
  stats: ProductStats | null;
}

export const viewOfCatalog = (p: Product, stats: ProductStats | null): ProductView => ({
  key: `c:${p.id}`,
  name: p.name,
  unit: p.unit,
  group: PRODUCT_GROUPS.find((g) => g.id === p.group)?.label,
  stats,
});

/** Сколько последних покупок показываем в карточке. */
const HISTORY_MAX = 10;

export interface ProductSheetProps {
  product: ProductView;
  items: readonly LocalRow<ShoppingItem>[];
  currency: CurrencyCode;
  book: PriceBook;
  /** «В список покупок»: добавляет продукт в «Покупки» (1 в его единице). Нет — кнопки нет. */
  onAddToList?: () => Promise<void>;
  onClose: () => void;
}

/** Карточка продукта: последняя и средняя цена, сколько раз покупали и последние покупки (дата, количество, сумма, цена за единицу). */
export function ProductSheet({ product, items, currency, onAddToList, onClose }: ProductSheetProps) {
  const { stats } = product;
  const [adding, setAdding] = useState(false);
  const busy = useRef(false);
  const addToList = async () => {
    if (!onAddToList || busy.current) return; // второе нажатие, пока идёт добавление
    busy.current = true;
    setAdding(true);
    try {
      await onAddToList();
    } finally {
      busy.current = false;
      setAdding(false);
    }
  };
  const purchases = items
    .filter((i) => i.purchasedAt !== null && i.priceMinor !== null && i.priceMinor > 0 && productKeyOf(i.name) === product.key)
    .sort((a, b) => ((a.purchasedAt as string) !== (b.purchasedAt as string) ? ((a.purchasedAt as string) < (b.purchasedAt as string) ? 1 : -1) : a.id < b.id ? 1 : -1))
    .slice(0, HISTORY_MAX);

  return (
    <Sheet
      open
      onClose={onClose}
      title={product.name}
      footer={
        onAddToList && (
          <Button size="lg" fullWidth icon="cart" loading={adding} onClick={() => void addToList()}>
            В список покупок
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {product.group ? `${product.group} · ` : 'Мой продукт · '}цена за {UNIT_LABEL[product.unit]}
        </p>
        {stats === null ? (
          <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">
            Цены пока нет: она появится после первой покупки с ценой (в «Покупках» или по чеку).
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-surface-2 p-3">
              <dt className="text-sm text-muted">Последняя</dt>
              <dd className="money text-lg font-bold">{moneyText(stats.lastUnitMinor, currency)}</dd>
              <dd className="text-xs text-muted">за {UNIT_LABEL[stats.unit]} · {purchaseDate(stats.lastAt)}</dd>
            </div>
            <div className="rounded-2xl bg-surface-2 p-3">
              <dt className="text-sm text-muted">Средняя</dt>
              <dd className="money text-lg font-bold">{moneyText(stats.avgUnitMinor, currency)}</dd>
              <dd className="text-xs text-muted">за {UNIT_LABEL[stats.unit]}</dd>
            </div>
            <p className="col-span-2 text-xs text-muted">
              Средняя — {averageBasisText(stats)}. Покупок с ценой всего: {stats.count}.
            </p>
          </dl>
        )}
        {purchases.length > 0 && (
          <section aria-label="Последние покупки">
            <h3 className="mb-1 text-sm font-bold">Последние покупки</h3>
            <ul className="divide-y divide-border/60">
              {purchases.map((i) => {
                const u = unitPrice(i.priceMinor as number, i.qtyMilli);
                return (
                  <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="text-muted">{purchaseDate(i.purchasedAt as string)} · </span>
                      {itemTitle(i.name, i.qtyMilli, i.unit)}
                    </span>
                    <span className="money shrink-0 text-right">
                      {moneyText(i.priceMinor as number, currency)}
                      {u !== null && <span className="block text-xs text-muted">{moneyText(u, currency)} за {UNIT_LABEL[i.unit]}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
