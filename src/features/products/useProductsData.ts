import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useSettings, useShoppingItems, useStore } from '@/db';
import { buildPriceBook, type PriceBook } from '@/domain/products/stats';
import type { CurrencyCode, LocalRow, ShoppingItem } from '@/domain/types';

export interface ProductsData {
  base: CurrencyCode;
  /** Живые позиции списка покупок, кроме позиций удалённых чеков: из купленных складываются цены. */
  items: LocalRow<ShoppingItem>[];
  book: PriceBook;
}

/**
 * Номера расходов, которые удалены (в том числе «Отмена» после сохранения): их позиции — не покупки, цены из них брать нельзя.
 * Расхода нет в базе вообще (позиция пришла с сервера раньше расхода) — это не «удалён», позицию не трогаем.
 */
function useDeletedReceiptIds(): ReadonlySet<string> | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const bought = await store.db.shopping_items.where('transactionId').above('').toArray();
    const ids = [...new Set(bought.filter((i) => i.deletedAt === null && i.transactionId !== null).map((i) => i.transactionId as string))];
    const txs = await store.db.transactions.bulkGet(ids);
    const deleted = new Set<string>();
    txs.forEach((t, i) => {
      if (t !== undefined && t.deletedAt !== null) deleted.add(ids[i] as string);
    });
    return deleted as ReadonlySet<string>;
  }, [store]);
}

/** Живые позиции списка без позиций удалённых чеков: из них считаются цены (экран «Продукты», «Покупки»). undefined — читается. */
export function useLiveShoppingItems(): LocalRow<ShoppingItem>[] | undefined {
  const all = useShoppingItems();
  const deleted = useDeletedReceiptIds();
  return useMemo(() => {
    if (all === undefined || deleted === undefined) return undefined;
    return deleted.size === 0 ? all : all.filter((i) => i.transactionId === null || !deleted.has(i.transactionId));
  }, [all, deleted]);
}

/** Всё для экрана «Продукты»: книга цен по купленным позициям в основной валюте. undefined — читается; null — настроек ещё нет. */
export function useProductsData(): ProductsData | null | undefined {
  const items = useLiveShoppingItems();
  const settings = useSettings();
  return useMemo(() => {
    if (items === undefined || settings === undefined) return undefined;
    if (settings === null) return null;
    return { base: settings.baseCurrency, items, book: buildPriceBook(items, new Date().toISOString()) };
  }, [items, settings]);
}
