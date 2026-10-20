import { addMinor } from '@/domain/money';
import type { Minor, UUID } from '@/domain/types';
import type { PlanOp } from '@/import/types';

/** Как импорт изменит один кошелёк: сколько операций его заденет и на сколько сдвинется остаток. */
export interface WalletImpact {
  count: number;
  /** null — сумма не помещается в безопасное целое. */
  deltaMinor: Minor | null;
}

/**
 * Сдвиг остатка каждого кошелька от операций, которые ДОБАВЯТСЯ (status 'add'). Уже имеющиеся операции лежат в базе и в остатке
 * учтены, их второй раз не считаем. Правила те же, что у остатков кошельков (domain/balances.ts): доход плюс, расход минус, у перевода
 * минус со счёта списания и плюс на счёт зачисления (сумма зачисления может быть меньше: разница — комиссия).
 */
export function walletImpacts(ops: readonly PlanOp[]): Map<UUID, WalletImpact> {
  const out = new Map<UUID, WalletImpact>();
  const move = (walletId: UUID, delta: Minor) => {
    const cur = out.get(walletId) ?? { count: 0, deltaMinor: 0 };
    cur.count++;
    if (cur.deltaMinor !== null) {
      try {
        cur.deltaMinor = addMinor(cur.deltaMinor, delta);
      } catch {
        cur.deltaMinor = null;
      }
    }
    out.set(walletId, cur);
  };
  for (const op of ops) {
    const t = op.input;
    if (op.status !== 'add' || !t) continue;
    if (t.kind === 'income') move(t.walletId, t.amountMinor);
    else if (t.kind === 'expense') move(t.walletId, -t.amountMinor);
    else if (t.kind === 'transfer' && t.toWalletId) {
      move(t.walletId, -t.amountMinor);
      move(t.toWalletId, t.toAmountMinor ?? t.amountMinor);
    }
  }
  return out;
}
