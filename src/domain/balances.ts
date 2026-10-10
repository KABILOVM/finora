import { addMinor, isMinor } from './money';
import type { Minor, Transaction, UUID, Wallet } from './types';

type WalletLike = Pick<Wallet, 'id' | 'openingBalanceMinor'>;
type TxLike = Pick<Transaction, 'kind' | 'walletId' | 'toWalletId' | 'amountMinor' | 'toAmountMinor' | 'deletedAt'>;

/**
 * Остаток кошелька = начальный остаток + доходы − расходы − переводы со счёта + переводы на счёт.
 * Остаток НИКОГДА не хранится: считается из живых (deletedAt === null) операций, поэтому расхождений быть не может.
 * Операции с битой суммой пропускаются (см. findBalanceIssues), чтобы один плохой документ не ломал весь экран.
 */
export function computeBalances(wallets: readonly WalletLike[], txs: readonly TxLike[]): Map<UUID, Minor> {
  const balances = new Map<UUID, Minor>();
  for (const w of wallets) balances.set(w.id, isMinor(w.openingBalanceMinor) ? w.openingBalanceMinor : 0);

  const apply = (walletId: UUID, delta: Minor) => {
    const cur = balances.get(walletId);
    if (cur === undefined) return; // операция по неизвестному кошельку — не наша забота
    balances.set(walletId, addMinor(cur, delta));
  };

  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    if (!isMinor(t.amountMinor) || t.amountMinor <= 0) continue;
    if (t.kind === 'income') apply(t.walletId, t.amountMinor);
    else if (t.kind === 'expense') apply(t.walletId, -t.amountMinor);
    else if (t.kind === 'transfer' && t.toWalletId) {
      const credit = t.toAmountMinor ?? t.amountMinor;
      if (!isMinor(credit) || credit <= 0) continue;
      apply(t.walletId, -t.amountMinor);
      apply(t.toWalletId, credit);
    }
  }
  return balances;
}

export interface BalanceIssue {
  txId?: UUID;
  message: string;
}

/** Диагностика данных, которые computeBalances молча пропустил. Для экрана «Проверка данных». */
export function findBalanceIssues(
  wallets: readonly Pick<Wallet, 'id'>[],
  txs: readonly (TxLike & Pick<Transaction, 'id'>)[],
): BalanceIssue[] {
  const ids = new Set(wallets.map((w) => w.id));
  const out: BalanceIssue[] = [];
  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    if (!isMinor(t.amountMinor) || t.amountMinor <= 0) out.push({ txId: t.id, message: 'Некорректная сумма' });
    if (!ids.has(t.walletId)) out.push({ txId: t.id, message: 'Кошелёк операции не найден' });
    if (t.kind === 'transfer') {
      if (!t.toWalletId || !ids.has(t.toWalletId)) out.push({ txId: t.id, message: 'Кошелёк зачисления не найден' });
      if (t.toWalletId === t.walletId) out.push({ txId: t.id, message: 'Перевод на тот же кошелёк' });
    }
  }
  return out;
}
