import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { formatMinor } from '@/domain/money';
import { priceKey, UNIT_LABEL, type ItemView } from '@/domain/shopping';
import { buildCatalog } from '@/domain/shoppingCatalog';
import type { Minor, ShoppingUnit } from '@/domain/types';
import { useStore, ValidationError } from '@/db';
import { ItemRow } from './ItemRow';
import { ItemSheet, type ItemFormValue } from './ItemSheet';
import { listenToListWithAi, parseListWithAi } from './aiList';
import { ListTextSheet } from './ListTextSheet';
import { PriceSheet } from './PriceSheet';
import { PurchaseSheet } from './PurchaseSheet';
import { approxText, priceText } from './shoppingText';
import { useShoppingData } from './useShoppingData';

type Sheet = { kind: 'new' } | { kind: 'list' } | { kind: 'edit'; id: string } | { kind: 'price'; id: string } | { kind: 'purchase' };

/** Сколько прошлых названий предлагаем при добавлении позиции. */
const RECENT_MAX = 8;

/**
 * Покупки: список с флажками. Неотмеченное показывает ожидаемую цену («≈», по прошлой покупке), отмеченное — цену из магазина.
 * «Подтвердить покупку» записывает ОДИН расход на сумму отмеченного с чеком (состав виден в расходе).
 */
export default function ShoppingPage() {
  const store = useStore();
  const toast = useToast();
  const data = useShoppingData();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());

  if (data === undefined) {
    return (
      <>
        <PageHeader title="Покупки" />
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      </>
    );
  }
  if (data === null) {
    return (
      <>
        <PageHeader title="Покупки" />
        <EmptyState
          icon="cloud"
          title="Данные ещё загружаются"
          text="Подождите немного: после первой загрузки здесь появится список покупок."
        />
      </>
    );
  }

  const { base, views, totals, budget } = data;
  const viewById = new Map(views.map((v) => [v.item.id, v]));
  const current = (id: string): ItemView | undefined => viewById.get(id);

  const fail = (e: unknown, fallback: string) => {
    if (!(e instanceof ValidationError)) console.error(fallback, e);
    toast.error(e instanceof ValidationError ? e.message : fallback);
  };

  /** Действие по одной позиции с защитой от повторного нажатия. */
  const guarded = async (id: string, fn: () => Promise<void>) => {
    if (busyRef.current.has(id)) return;
    busyRef.current.add(id);
    setBusyIds(new Set(busyRef.current));
    try {
      await fn();
    } finally {
      busyRef.current.delete(id);
      setBusyIds(new Set(busyRef.current));
    }
  };

  const toggle = (v: ItemView) => {
    if (!v.checked) return setSheet({ kind: 'price', id: v.item.id });
    const { id } = v.item;
    const price = v.item.priceMinor as Minor;
    void guarded(id, async () => {
      try {
        await store.shopping.uncheck(id);
        toast.success(`Достали из корзины: ${v.item.name}`, {
          action: {
            label: 'Отменить',
            onClick: () => void store.shopping.check(id, price).catch((e: unknown) => fail(e, 'Не удалось вернуть позицию в корзину')),
          },
        });
      } catch (e) {
        fail(e, 'Не удалось убрать позицию из корзины');
      }
    });
  };

  const saveItem = (v: ItemView | null) => async (f: ItemFormValue) => {
    if (v === null) {
      await store.shopping.add({ name: f.name, qtyMilli: f.qtyMilli, unit: f.unit });
      return;
    }
    await store.shopping.update(v.item.id, { name: f.name, qtyMilli: f.qtyMilli, unit: f.unit });
    if (v.checked && f.priceMinor !== null && f.priceMinor !== v.item.priceMinor) await store.shopping.check(v.item.id, f.priceMinor);
  };

  const removeItem = (v: ItemView) => async () => {
    await store.shopping.remove(v.item.id);
    toast.success(`Удалено: ${v.item.name}`, {
      action: {
        label: 'Отменить',
        onClick: () => void store.shopping.restore(v.item.id).catch((e: unknown) => fail(e, 'Не удалось вернуть позицию')),
      },
    });
  };

  // названия из прошлых покупок (без повторов), свежие первыми
  const recent: { name: string; unit: ShoppingUnit }[] = [];
  const seenKeys = new Set<string>();
  const catalog = buildCatalog(data.all);
  const bought = data.all
    .filter((i) => i.purchasedAt !== null)
    .sort((a, b) => ((a.purchasedAt as string) < (b.purchasedAt as string) ? 1 : -1));
  for (const i of bought) {
    const key = priceKey(i.name, i.unit);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    recent.push({ name: i.name, unit: i.unit });
    if (recent.length >= RECENT_MAX) break;
  }

  const editView = sheet?.kind === 'edit' ? current(sheet.id) : undefined;
  const priceView = sheet?.kind === 'price' ? current(sheet.id) : undefined;
  const cartCount = totals?.cartCount ?? 0;

  const planLine = (
    <p className="mb-3 px-1 text-sm text-muted" data-testid="shopping-plan">
      {totals === null ? (
        'Суммы слишком большие, проверьте данные'
      ) : (
        <>
          План <span className="money font-semibold text-text">{approxText(totals.planMinor, base)}</span>
          {totals.unknownCount > 0 && ` (без цены: ${totals.unknownCount})`}
          {budget && (
            <>
              {' · '}
              {budget.overMinor > 0 ? `Перерасход на «${budget.categoryName}» ` : `Осталось на «${budget.categoryName}» `}
              <span className="money font-semibold text-text">
                {formatMinor(budget.overMinor > 0 ? budget.overMinor : budget.remainingMinor, base)}
              </span>
            </>
          )}
        </>
      )}
    </p>
  );

  return (
    <>
      <PageHeader
        title="Покупки"
        actions={
          <>
            <Button variant="secondary" icon="list" aria-label="Добавить списком" onClick={() => setSheet({ kind: 'list' })}>
              <span className="hidden sm:inline">Списком</span>
            </Button>
            <Button icon="plus" aria-label="Добавить позицию" onClick={() => setSheet({ kind: 'new' })}>
              <span className="hidden sm:inline">Добавить</span>
            </Button>
          </>
        }
      />

      {views.length === 0 ? (
        <EmptyState
          icon="cart"
          title="Список покупок пуст"
          text="Добавьте, что нужно купить. Приложение запомнит цены и подскажет, сколько выйдет в следующий раз."
          action={
            <div className="flex flex-col gap-2">
              <Button onClick={() => setSheet({ kind: 'new' })}>Добавить позицию</Button>
              <Button variant="secondary" icon="list" onClick={() => setSheet({ kind: 'list' })}>
                Продиктовать списком
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {planLine}
          <Card padding="none" className="mb-4">
            <ul className="divide-y divide-border" aria-label="Список покупок">
              {views.map((v) => (
                <ItemRow
                  key={v.item.id}
                  view={v}
                  currency={base}
                  busy={busyIds.has(v.item.id)}
                  onToggle={() => toggle(v)}
                  onOpen={() => setSheet({ kind: 'edit', id: v.item.id })}
                />
              ))}
            </ul>
          </Card>

          <Card className="mb-4 flex items-center justify-between gap-3" data-testid="shopping-cart">
            <span className="font-semibold">Итого в корзине</span>
            <span className="money text-xl font-bold" aria-live="polite">
              {totals === null ? '—' : priceText(totals.cartMinor, base)}
            </span>
          </Card>

          <Button size="lg" fullWidth disabled={cartCount === 0 || totals === null} onClick={() => setSheet({ kind: 'purchase' })}>
            Подтвердить покупку
          </Button>
          {cartCount === 0 && <p className="mt-2 text-center text-sm text-muted">Отметьте купленное флажком и впишите цену с ценника.</p>}
          <p className="mt-4 px-1 text-sm text-muted">
            Единицы: {Object.values(UNIT_LABEL).join(', ')}. Цены считаются в {base}; прошлые цены берутся из купленных позиций.
          </p>
        </>
      )}

      {sheet?.kind === 'new' && (
        <ItemSheet view={null} currency={base} recent={recent} onSave={saveItem(null)} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'list' && (
        <ListTextSheet
          known={[...new Set(data.all.map((i) => i.name))]}
          catalog={catalog}
          memory={data.memory}
          currency={base}
          parse={(text, known) => parseListWithAi(text, known)}
          listen={(rec, known) => listenToListWithAi(rec, known)}
          onAdd={async (parsed) => {
            for (const it of parsed) await store.shopping.add({ name: it.name, qtyMilli: it.qtyMilli, unit: it.unit });
            toast.success(`Добавлено: ${parsed.length}`);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'edit' && editView && (
        <ItemSheet
          key={editView.item.id}
          view={editView}
          currency={base}
          recent={[]}
          onSave={saveItem(editView)}
          onRemove={removeItem(editView)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'price' && priceView && (
        <PriceSheet
          key={priceView.item.id}
          view={priceView}
          currency={base}
          onSave={(p) => store.shopping.check(priceView.item.id, p).then(() => undefined)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'purchase' && totals && (
        <PurchaseSheet
          totalMinor={totals.cartMinor}
          count={totals.cartCount}
          currency={base}
          defaultCategoryId={data.categoryId}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
