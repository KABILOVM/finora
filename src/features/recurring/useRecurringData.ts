import { useMemo } from 'react';
import { useDebts, useSettings } from '@/db';
import type { Category, CurrencyCode, Debt, LocalRow, Wallet } from '@/domain/types';
import { useCategoryIndex, useWalletIndex } from '@/features/transactions/txData';

export interface RecurringLookups {
  /** Все кошельки по id, включая архивные: у старого платежа название кошелька должно находиться. */
  wallets: Map<string, LocalRow<Wallet>>;
  categories: Map<string, LocalRow<Category>>;
  /** Все долги по id (включая закрытые и архивные). */
  debts: Map<string, LocalRow<Debt>>;
  base: CurrencyCode;
  /** Кошелёк «по умолчанию» из настроек (подставляется в новый платёж). */
  defaultWalletId: string | null;
}

/**
 * Справочники для экранов регулярных платежей. undefined — ещё читаются; null — настроек (базовой валюты) пока нет
 * (до первой загрузки данных): платежи тогда показывать и проводить нельзя.
 */
export function useRecurringLookups(): RecurringLookups | null | undefined {
  const wallets = useWalletIndex();
  const categories = useCategoryIndex();
  const debtList = useDebts({ includeArchived: true, includeClosed: true });
  const settings = useSettings();
  const base = settings?.baseCurrency;
  return useMemo(() => {
    if (!wallets || !categories || !debtList || settings === undefined) return undefined;
    if (settings === null || base === undefined) return null;
    return { wallets, categories, debts: new Map(debtList.map((d) => [d.id, d])), base, defaultWalletId: settings.defaultWalletId };
  }, [wallets, categories, debtList, settings, base]);
}
