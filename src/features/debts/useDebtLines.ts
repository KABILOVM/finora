import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '@/db';
import type { CurrencyCode, LocalRow, Transaction, UUID, Wallet } from '@/domain/types';

export interface DebtLines {
  /** Живые операции этого долга по id: из них берутся кошелёк и заметка платежей. */
  txs: Map<UUID, LocalRow<Transaction>>;
  /** Все кошельки (и архивные): у старого платежа название кошелька должно находиться. */
  wallets: Map<UUID, LocalRow<Wallet>>;
  base: CurrencyCode | null;
}

/** Операции долга и кошельки для страницы долга (живой запрос). undefined — ещё читается. */
export function useDebtLines(debtId: UUID): DebtLines | undefined {
  const store = useStore();
  return useLiveQuery(async (): Promise<DebtLines> => {
    const [txs, wallets, settings] = await Promise.all([
      store.db.transactions.where('debtId').equals(debtId).toArray(),
      store.db.wallets.toArray(),
      store.settings.get(),
    ]);
    return {
      txs: new Map(txs.filter((t) => t.deletedAt === null).map((t) => [t.id, t])),
      wallets: new Map(wallets.map((w) => [w.id, w])),
      base: settings?.baseCurrency ?? null,
    };
  }, [store, debtId]);
}
