import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useStore } from '@/db';
import type { CurrencyCode, Debt, LocalRow, Transaction, UUID, Wallet } from '@/domain/types';
import { buildDebtItems, type DebtItem } from './debtSummary';

export interface DebtsData {
  /** Все живые долги (и закрытые, и в архиве) с остатками, в порядке показа. */
  items: DebtItem[];
  /** Основная валюта пользователя; null — настройки ещё не созданы. */
  base: CurrencyCode | null;
}

interface Raw {
  debts: LocalRow<Debt>[];
  txs: LocalRow<Transaction>[];
  wallets: LocalRow<Wallet>[];
  base: CurrencyCode | null;
}

/**
 * Все долги с остатками одним живым запросом (а не по запросу на каждый долг): список, итоги и виджет «Главной» опираются на него.
 * undefined — ещё читается. Остатки считаются из операций (domain/debts.ts), нигде не хранятся.
 */
export function useDebtsData(): DebtsData | undefined {
  const store = useStore();
  const raw = useLiveQuery(async (): Promise<Raw> => {
    const { db } = store;
    const debts = (await db.debts.toArray()).filter((d) => d.deletedAt === null);
    const ids = debts.map((d) => d.id);
    const [txs, wallets, settings] = await Promise.all([
      ids.length > 0 ? db.transactions.where('debtId').anyOf(ids).toArray() : Promise.resolve([]),
      db.wallets.toArray(),
      store.settings.get(),
    ]);
    return { debts, txs, wallets, base: settings?.baseCurrency ?? null };
  }, [store]);

  return useMemo(() => {
    if (!raw) return undefined;
    const wallets = new Map<UUID, LocalRow<Wallet>>(raw.wallets.map((w) => [w.id, w]));
    return { items: buildDebtItems(raw.debts, raw.txs, wallets), base: raw.base };
  }, [raw]);
}
