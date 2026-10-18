import { useLiveQuery } from 'dexie-react-hooks';
import { useOptionalStore } from '@/db';
import { debtTxRole } from '@/domain/debts';
import type { Debt, LocalRow, Transaction } from '@/domain/types';

export type DebtTxLink = Pick<Transaction, 'id' | 'kind' | 'walletId' | 'amountMinor' | 'debtId'>;

export interface DebtTxRoleView {
  /** Живой долг операции; null — долга нет в списке (удалён или ещё не загрузился). */
  debt: LocalRow<Debt> | null;
  /** Роль операции в долге (как в computeDebtState); 'outside' — в расчёт остатка не входит или долга нет. */
  role: 'payment' | 'entry' | 'outside';
}

/** Долг операции и её роль в нём (платёж или выдача). null — операция не относится к долгу; undefined — читается. */
export function useDebtTxRole(tx: DebtTxLink): DebtTxRoleView | null | undefined {
  const store = useOptionalStore();
  const { id, kind, walletId, amountMinor, debtId } = tx;
  return useLiveQuery(async (): Promise<DebtTxRoleView | null> => {
    if (!debtId) return null;
    const d = store ? await store.db.debts.get(debtId) : undefined;
    if (!d || d.deletedAt !== null) return { debt: null, role: 'outside' }; // удалённый долг — как отсутствующий
    const wallet = store ? await store.db.wallets.get(walletId) : undefined;
    return { debt: d, role: debtTxRole(d, { id, kind, walletId, amountMinor, debtId }, () => wallet?.currency) };
  }, [store, id, kind, walletId, amountMinor, debtId]);
}
