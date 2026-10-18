import { computeDebtState, debtPlanStop, type DebtPlanStop, type DebtState } from '@/domain/debts';
import type { Debt, LocalRow, RecurringRule, UUID, Wallet } from '@/domain/types';
import type { FinoraDB } from './database';

/**
 * Какие планы платежей по долгам стоят (см. debtPlanStop): id правила → причина. Читает долги правил, их операции и кошельки;
 * в useLiveQuery экран поэтому сам обновляется, когда долг погашен, закрыт или открыт снова.
 */
export async function stoppedDebtPlans(
  db: FinoraDB,
  rules: readonly Pick<RecurringRule, 'id' | 'kind' | 'debtId'>[],
): Promise<Map<UUID, DebtPlanStop>> {
  const out = new Map<UUID, DebtPlanStop>();
  const ids = [...new Set(rules.map((r) => r.debtId).filter((id): id is UUID => id !== null))];
  if (ids.length === 0) return out;
  const debts = new Map<UUID, LocalRow<Debt>>();
  for (const d of await db.debts.bulkGet(ids)) if (d) debts.set(d.id, d);
  let wallets: LocalRow<Wallet>[] | null = null;
  const states = new Map<UUID, DebtState | null>();
  for (const d of debts.values()) {
    if (d.deletedAt !== null || d.archivedAt !== null || d.closedAt !== null) continue; // остаток не нужен: план стоит и так
    wallets ??= await db.wallets.toArray();
    const txs = await db.transactions.where('debtId').equals(d.id).toArray();
    try {
      states.set(d.id, computeDebtState(d, txs, wallets));
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      states.set(d.id, null); // суммы не помещаются в расчёт — по остатку план не останавливаем
    }
  }
  for (const r of rules) {
    if (r.debtId === null) continue;
    const stop = debtPlanStop(r, debts.get(r.debtId), states.get(r.debtId) ?? null);
    if (stop !== null) out.set(r.id, stop);
  }
  return out;
}
