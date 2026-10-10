import { addMinor, isMinor } from '@/domain/money';
import type { Minor, Transaction, UUID, Wallet } from '@/domain/types';

type WalletLike = Pick<Wallet, 'id' | 'openingBalanceMinor'>;
type TxLike = Pick<Transaction, 'kind' | 'walletId' | 'toWalletId' | 'amountMinor' | 'toAmountMinor' | 'deletedAt'>;

export interface Reconciliation {
  openingMinor: Minor;
  incomeMinor: Minor;
  incomeCount: number;
  expenseMinor: Minor;
  expenseCount: number;
  transferInMinor: Minor;
  transferInCount: number;
  transferOutMinor: Minor;
  transferOutCount: number;
  /** начальный + доходы − расходы + переводы на кошелёк − переводы с кошелька */
  totalMinor: Minor;
  /** Операции с некорректной суммой: в остаток не входят (см. «Проверка данных» в Настройках). */
  skipped: number;
}

/**
 * Расчёт остатка кошелька по частям — для проверки человеком. Правила те же, что в domain/balances.ts
 * (computeBalances): удалённые не считаются, операции с битой суммой пропускаются, перевод зачисляет toAmountMinor.
 * Итог ОБЯЗАН совпадать с computeBalances; на это есть тест. Бросает RangeError при переполнении суммы.
 */
export function reconcileWallet(wallet: WalletLike, txs: readonly TxLike[]): Reconciliation {
  const r: Reconciliation = {
    openingMinor: isMinor(wallet.openingBalanceMinor) ? wallet.openingBalanceMinor : 0,
    incomeMinor: 0,
    incomeCount: 0,
    expenseMinor: 0,
    expenseCount: 0,
    transferInMinor: 0,
    transferInCount: 0,
    transferOutMinor: 0,
    transferOutCount: 0,
    totalMinor: 0,
    skipped: 0,
  };
  const id: UUID = wallet.id;

  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    const touches = t.walletId === id || (t.kind === 'transfer' && t.toWalletId === id);
    if (!touches) continue;
    if (!isMinor(t.amountMinor) || t.amountMinor <= 0) {
      r.skipped++;
      continue;
    }
    if (t.kind === 'income' && t.walletId === id) {
      r.incomeMinor = addMinor(r.incomeMinor, t.amountMinor);
      r.incomeCount++;
    } else if (t.kind === 'expense' && t.walletId === id) {
      r.expenseMinor = addMinor(r.expenseMinor, t.amountMinor);
      r.expenseCount++;
    } else if (t.kind === 'transfer' && t.toWalletId) {
      const credit = t.toAmountMinor ?? t.amountMinor;
      if (!isMinor(credit) || credit <= 0) {
        r.skipped++;
        continue;
      }
      if (t.walletId === id) {
        r.transferOutMinor = addMinor(r.transferOutMinor, t.amountMinor);
        r.transferOutCount++;
      }
      if (t.toWalletId === id) {
        r.transferInMinor = addMinor(r.transferInMinor, credit);
        r.transferInCount++;
      }
    }
  }

  let total = addMinor(r.openingMinor, r.incomeMinor);
  total = addMinor(total, -r.expenseMinor);
  total = addMinor(total, r.transferInMinor);
  total = addMinor(total, -r.transferOutMinor);
  r.totalMinor = total;
  return r;
}
