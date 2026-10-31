import { useMemo } from 'react';
import { useSettings, useShoppingItems } from '@/db';
import { buildPriceBook, type PriceBook } from '@/domain/products/stats';
import type { CurrencyCode, LocalRow, ShoppingItem } from '@/domain/types';

export interface ProductsData {
  base: CurrencyCode;
  /** Все живые позиции списка покупок: из купленных складываются цены. */
  items: LocalRow<ShoppingItem>[];
  book: PriceBook;
}

/** Всё для экрана «Продукты»: книга цен по купленным позициям в основной валюте. undefined — читается; null — настроек ещё нет. */
export function useProductsData(): ProductsData | null | undefined {
  const items = useShoppingItems();
  const settings = useSettings();
  return useMemo(() => {
    if (items === undefined || settings === undefined) return undefined;
    if (settings === null) return null;
    return { base: settings.baseCurrency, items, book: buildPriceBook(items, new Date().toISOString()) };
  }, [items, settings]);
}
