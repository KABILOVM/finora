import { computeDebtState, type DebtInfo, type DebtTx } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, DebtDirection, Minor, UUID, Wallet } from '@/domain/types';

/** Выдача или пополнение долга деньгами (исходная операция и «добавить ещё»), с кошельком, через который она прошла. */
export interface EntryLine {
  txId: UUID;
  walletId: UUID;
  amountMinor: Minor;
}

/** Выдачи и пополнения долга по порядку: старые первыми. Та же классификация, что в остатке долга (чужая валюта и удалённые не входят). */
export function debtEntryLines(
  debt: DebtInfo,
  txs: readonly (DebtTx & { walletId: UUID })[],
  wallets: readonly Pick<Wallet, 'id' | 'currency'>[],
): EntryLine[] {
  const walletOf = new Map(txs.map((t) => [t.id, t.walletId]));
  return computeDebtState(debt, txs, wallets).entries.map((e) => ({ txId: e.txId, walletId: walletOf.get(e.txId)!, amountMinor: e.amountMinor }));
}

export interface EntryStep {
  txId: UUID;
  fromMinor: Minor;
  /** 0 — операция убирается целиком. */
  toMinor: Minor;
}

export interface EntryAdjustment {
  steps: EntryStep[];
  /** Часть изменения, которую некуда отнести: денег по долгу выдано меньше, чем убирают. Эти деньги не двигаются. */
  uncoveredMinor: Minor;
}

/**
 * Как подстроить выдачи/пополнения долга под изменение его суммы на deltaMinor (entries — старые первыми).
 * Сумма выросла — растёт последняя выдача; уменьшилась — деньги «возвращаются» с самой поздней выдачи, а если её не хватает,
 * то и с более ранних. Выдач нет вовсе — шагов нет, uncovered = всё изменение (долг «на бумаге»).
 */
export function planEntryAdjustment(entries: readonly Pick<EntryLine, 'txId' | 'amountMinor'>[], deltaMinor: number): EntryAdjustment {
  const newest = [...entries].reverse();
  if (deltaMinor === 0) return { steps: [], uncoveredMinor: 0 };
  const last = newest[0];
  if (deltaMinor > 0) {
    if (!last) return { steps: [], uncoveredMinor: deltaMinor };
    return { steps: [{ txId: last.txId, fromMinor: last.amountMinor, toMinor: last.amountMinor + deltaMinor }], uncoveredMinor: 0 };
  }
  const steps: EntryStep[] = [];
  let left = -deltaMinor;
  for (const e of newest) {
    if (left === 0) break;
    const take = Math.min(e.amountMinor, left);
    steps.push({ txId: e.txId, fromMinor: e.amountMinor, toMinor: e.amountMinor - take });
    left -= take;
  }
  return { steps, uncoveredMinor: left };
}

/** Остаток кошелька падает, если сумма «я дал» выросла или сумма «я взял» уменьшилась; иначе растёт. */
export const walletGoesDown = (direction: DebtDirection, deltaMinor: number): boolean => (direction === 'lent') === (deltaMinor > 0);

/**
 * Что произойдёт с деньгами при правке суммы долга: «Остаток кошелька «Наличные» уменьшится на 200 с.…».
 * walletNames — кошельки, через которые прошли затронутые выдачи (повторы убираются).
 */
export function editMoneyText(
  direction: DebtDirection,
  currency: CurrencyCode,
  deltaMinor: number,
  adjustment: EntryAdjustment,
  walletNames: readonly string[],
): string {
  const moved = Math.abs(deltaMinor) - adjustment.uncoveredMinor;
  const names = [...new Set(walletNames)].map((n) => `«${n}»`);
  const whose = names.length === 1 ? `кошелька ${names[0]}` : names.length > 1 ? `кошельков ${names.join(', ')}` : 'кошелька';
  const verb = walletGoesDown(direction, deltaMinor) ? 'уменьшится' : 'вырастет';
  const parts = [`Остаток ${whose} ${verb} на ${formatMinor(moved, currency)}, а в доходы и расходы месяца это не войдёт.`];
  if (adjustment.uncoveredMinor > 0) {
    parts.push(`Ещё ${formatMinor(adjustment.uncoveredMinor, currency)} не проходили через кошелёк, поэтому они не двигаются.`);
  }
  return parts.join(' ');
}

/** editMoneyText для выдач долга: считает, что изменится, и называет кошельки, через которые они прошли. */
export function entryEditText(
  direction: DebtDirection,
  currency: CurrencyCode,
  deltaMinor: number,
  entries: readonly EntryLine[],
  wallets: readonly Pick<Wallet, 'id' | 'name'>[],
): string {
  const adjustment = planEntryAdjustment(entries, deltaMinor);
  const names = adjustment.steps.flatMap((step) => {
    const walletId = entries.find((e) => e.txId === step.txId)?.walletId;
    const wallet = wallets.find((w) => w.id === walletId);
    return wallet ? [wallet.name] : [];
  });
  return editMoneyText(direction, currency, deltaMinor, adjustment, names);
}
