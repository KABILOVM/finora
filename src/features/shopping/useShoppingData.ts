import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useSettings, useShoppingItems, useStore } from '@/db';
import { useBudgetsData } from '@/features/budgets/useBudgetsData';
import { averageMemory, buildPriceBook, type PriceBook } from '@/domain/products/stats';
import { useLiveShoppingItems } from '@/features/products/useProductsData';
import { activeItems, planByAverage, priceMemory, totalsOf, viewItem, type ItemView, type ShoppingTotals } from '@/domain/shopping';
import type { CurrencyCode, LocalRow, Minor, ShoppingItem } from '@/domain/types';
import { monthKey, todayLocal } from '@/lib/dates';

export interface BudgetLeft {
  categoryName: string;
  /** Сколько ещё можно потратить по бюджету категории. */
  remainingMinor: Minor;
  /** На сколько бюджет уже превышен. */
  overMinor: Minor;
}

export interface ShoppingData {
  base: CurrencyCode;
  /** Все живые позиции (в том числе купленные: из них складывается память цен). */
  all: LocalRow<ShoppingItem>[];
  views: ItemView[];
  memory: ReadonlyMap<string, Minor>;
  /** Книга цен продуктов: последняя и средняя цена (экран «Продукты»); подсказки при добавлении позиции. */
  book: PriceBook;
  /** План по средним ценам (где средней нет — по последней); null — суммы не помещаются в расчёт. */
  planAvgMinor: Minor | null;
  /** null — суммы не помещаются в расчёт. */
  totals: ShoppingTotals | null;
  /** Категория покупок: та, что была в прошлой покупке, иначе «Продукты». */
  categoryId: string | null;
  budget: BudgetLeft | null;
}

/** Категория для покупок: из последней покупки по списку, иначе категория расходов «Продукты». */
function useShoppingCategory(): { id: string; name: string } | null | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const { db } = store;
    const bought = (await db.shopping_items.where('transactionId').above('').toArray())
      .filter((i) => i.deletedAt === null && i.purchasedAt !== null && i.transactionId !== null)
      .sort((a, b) => ((a.purchasedAt as string) < (b.purchasedAt as string) ? 1 : -1));
    const cats = await db.categories.toArray();
    const live = (id: string | null) => cats.find((c) => c.id === id && c.deletedAt === null && c.archivedAt === null && c.kind === 'expense');
    for (const it of bought) {
      const tx = await db.transactions.get(it.transactionId as string);
      const c = tx && tx.deletedAt === null ? live(tx.categoryId) : undefined;
      if (c) return { id: c.id, name: c.name };
    }
    const byName = cats.find((c) => c.deletedAt === null && c.archivedAt === null && c.kind === 'expense' && c.name.trim().toLowerCase() === 'продукты');
    return byName ? { id: byName.id, name: byName.name } : null;
  }, [store]);
}

/** Всё, что нужно экрану «Покупки»: позиции с ценами, итоги, остаток бюджета. undefined — ещё читается; null — настроек ещё нет. */
export function useShoppingData(): ShoppingData | null | undefined {
  const items = useShoppingItems();
  // цены считаем без позиций удалённых чеков: расход удалили или «Отменили» — эти цены не покупка
  const live = useLiveShoppingItems();
  const settings = useSettings();
  const category = useShoppingCategory();
  const budgets = useBudgetsData(monthKey(todayLocal()));

  return useMemo(() => {
    if (items === undefined || live === undefined || settings === undefined || category === undefined || budgets === undefined) return undefined;
    if (settings === null) return null; // настроек ещё нет: основная валюта неизвестна
    const memory = priceMemory(live);
    const book = buildPriceBook(live, new Date().toISOString());
    const active = activeItems(items);
    let totals: ShoppingTotals | null = null;
    let planAvgMinor: Minor | null = null;
    try {
      totals = totalsOf(active, memory);
      planAvgMinor = planByAverage(active, averageMemory(book), memory);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
    }
    let budget: BudgetLeft | null = null;
    if (category && budgets && !('overflow' in budgets) && budgets.progress.ok) {
      const p = budgets.progress.items.find((x) => x.categoryId === category.id);
      if (p && p.comparable) budget = { categoryName: category.name, remainingMinor: p.remainingMinor, overMinor: p.overMinor };
    }
    return {
      base: settings.baseCurrency,
      all: items,
      views: active.map((i) => viewItem(i, memory)),
      memory,
      book,
      planAvgMinor,
      totals,
      categoryId: category?.id ?? null,
      budget,
    };
  }, [items, live, settings, category, budgets]);
}
