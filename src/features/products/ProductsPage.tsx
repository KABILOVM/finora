import { useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import { ChipPicker, type ChipOption } from '@/components/ChipPicker';
import { EmptyState } from '@/components/EmptyState';
import { inputClasses } from '@/components/Field';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { CATALOG, PRODUCT_GROUPS, normName, searchCatalog, type ProductGroupId } from '@/domain/products/catalog';
import { ownProducts, statsForProduct, type PriceBook, type ProductStats } from '@/domain/products/stats';
import type { CurrencyCode } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { priceLine } from './productText';
import { ProductSheet, viewOfCatalog, type ProductView } from './ProductSheet';
import { useProductsData } from './useProductsData';

type Filter = 'all' | 'bought' | 'mine' | ProductGroupId;

/** Сколько результатов поиска показываем. */
const SEARCH_MAX = 60;

const viewOfOwn = (s: ProductStats): ProductView => ({ key: s.key, name: s.name, unit: s.unit, stats: s });

function Rows({ views, currency, onOpen }: { views: readonly ProductView[]; currency: CurrencyCode; onOpen: (v: ProductView) => void }) {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {views.map((v) => (
          <li key={v.key}>
            <ListRow title={v.name} subtitle={priceLine(v.stats, v.unit, currency)} chevron onClick={() => onOpen(v)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Продукты каталога вместе с их ценами из книги цен. */
function catalogViews(book: PriceBook, group?: ProductGroupId): ProductView[] {
  return CATALOG.filter((p) => group === undefined || p.group === group).map((p) => viewOfCatalog(p, statsForProduct(book, p)));
}

/**
 * Продукты: единый каталог (разделы, поиск) и личные цены — последняя и средняя по вашим покупкам. Свои продукты — названия из ваших
 * покупок, которых нет в каталоге. Цен на старте нет: они появляются из покупок (список «Покупки», чек).
 */
export default function ProductsPage() {
  const data = useProductsData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<ProductView | null>(null);

  const own = useMemo(() => (data ? ownProducts(data.book) : []), [data]);

  if (data === undefined) {
    return (
      <>
        <PageHeader title="Продукты" />
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      </>
    );
  }
  if (data === null) {
    return (
      <>
        <PageHeader title="Продукты" />
        <EmptyState icon="cloud" title="Данные ещё загружаются" text="Подождите немного: после первой загрузки здесь появится каталог." />
      </>
    );
  }
  const { book, base, items } = data;

  const searching = normName(query) !== '';
  const options: ChipOption[] = [
    { value: 'all', label: 'Все' },
    { value: 'bought', label: 'Покупал' },
    ...(own.length > 0 ? [{ value: 'mine', label: `Мои · ${own.length}` }] : []),
    ...PRODUCT_GROUPS.map((g) => ({ value: g.id, label: g.label })),
  ];

  let body;
  if (searching) {
    const q = normName(query);
    const found = [
      ...searchCatalog(query, { limit: SEARCH_MAX }).map((p) => viewOfCatalog(p, statsForProduct(book, p))),
      ...own.filter((s) => normName(s.name).includes(q)).map(viewOfOwn),
    ];
    body =
      found.length === 0 ? (
        <EmptyState
          icon="search"
          title="Ничего не найдено"
          text="Такого продукта нет в каталоге. Свой продукт появится здесь, когда вы купите его и впишете название в «Покупках» или в чеке."
        />
      ) : (
        <Rows views={found} currency={base} onOpen={setOpen} />
      );
  } else if (filter === 'bought') {
    const bought = [...catalogViews(book).filter((v) => v.stats !== null), ...own.map(viewOfOwn)].sort((a, b) =>
      (a.stats?.lastAt ?? '') < (b.stats?.lastAt ?? '') ? 1 : -1,
    );
    body =
      bought.length === 0 ? (
        <EmptyState icon="cart" title="Покупок с ценой пока нет" text="Цены появятся после первой покупки: отметьте цену в «Покупках» или внесите чек." />
      ) : (
        <Rows views={bought} currency={base} onOpen={setOpen} />
      );
  } else if (filter === 'mine') {
    body = <Rows views={own.map(viewOfOwn)} currency={base} onOpen={setOpen} />;
  } else if (filter === 'all') {
    body = (
      <div className="flex flex-col gap-5">
        {own.length > 0 && (
          <section aria-label="Мои продукты">
            <h2 className="mb-1 px-1 text-sm font-bold text-muted">
              Мои продукты · {own.length} {pluralRu(own.length, 'продукт', 'продукта', 'продуктов')}
            </h2>
            <Rows views={own.map(viewOfOwn)} currency={base} onOpen={setOpen} />
          </section>
        )}
        {PRODUCT_GROUPS.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h2 className="mb-1 px-1 text-sm font-bold text-muted">{g.label}</h2>
            <Rows views={catalogViews(book, g.id)} currency={base} onOpen={setOpen} />
          </section>
        ))}
      </div>
    );
  } else {
    body = <Rows views={catalogViews(book, filter)} currency={base} onOpen={setOpen} />;
  }

  return (
    <>
      <PageHeader title="Продукты" subtitle={`${CATALOG.length} в каталоге${own.length > 0 ? ` · ${own.length} своих` : ''}`} />
      <div className="mb-3 flex flex-col gap-3">
        <input
          type="search"
          inputMode="search"
          aria-label="Поиск продукта"
          placeholder="Найти продукт: картошка, молоко…"
          autoComplete="off"
          value={query}
          maxLength={60}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputClasses(false)} min-h-[48px]`}
        />
        {!searching && <ChipPicker ariaLabel="Раздел" layout="scroll" options={options} value={filter} onChange={(v) => setFilter(v as Filter)} />}
      </div>
      {body}
      {open && <ProductSheet product={open} items={items} currency={base} book={book} onClose={() => setOpen(null)} />}
    </>
  );
}
