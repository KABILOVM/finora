import { DEBT_OVERFLOW_MESSAGE, ValidationError, type Store } from '@/db';
import { computeDebtState, type DebtInfo, type DebtTx } from '@/domain/debts';
import type { CurrencyCode, Minor, Transaction, UUID, Wallet } from '@/domain/types';

/** Поля операции, которые влияют на расчёт долга. */
export type DebtTxEdit = Pick<Transaction, 'kind' | 'walletId' | 'amountMinor' | 'occurredOn'>;

/**
 * Насколько платежи по долгу превысят его сумму ПОСЛЕ правки, если правка увеличивает переплату; иначе 0.
 * Сравнивается переплата «как есть» и «с правкой»: платёж, который и раньше был с подтверждённой переплатой, при правке заметки
 * или даты вопроса не вызывает, а «200» → «2000» при долге 500 — вызывает. Чистая функция: деньги — целые, остаток считает домен.
 * Если суммы после правки не помещаются в число, бросает RangeError (так считает домен).
 */
export function overpayGrowth(
  debt: DebtInfo,
  txs: readonly DebtTx[],
  wallets: readonly Pick<Wallet, 'id' | 'currency'>[],
  txId: UUID,
  edit: DebtTxEdit,
): Minor {
  let before: Minor;
  try {
    before = computeDebtState(debt, txs, wallets).overpaidMinor;
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    before = 0; // суммы и так не считались: прежней переплаты «как есть» нет, любая переплата после правки — повод спросить
  }
  const after = computeDebtState(
    debt,
    txs.map((t) => (t.id === txId ? { ...t, ...edit } : t)),
    wallets,
  ).overpaidMinor;
  return after > before ? after : 0;
}

export interface EditOverpay {
  /** На сколько платежи станут больше суммы долга. */
  overMinor: Minor;
  currency: CurrencyCode;
}

/**
 * Защита от опечатки при правке операции по долгу: в шите «Платёж по долгу» сумма больше остатка проходит только после
 * подтверждения, и правка того же платежа из журнала не должна быть лазейкой. null — переплата не растёт (или операция не по долгу).
 * Читает свежие данные из базы в момент сохранения, а не то, что человек видел при открытии.
 * Суммы после правки не помещаются в число — ValidationError с понятным текстом (запись не делается).
 */
export async function overpayAfterEdit(
  store: Store,
  tx: Pick<Transaction, 'id' | 'debtId'>,
  edit: DebtTxEdit,
): Promise<EditOverpay | null> {
  if (!tx.debtId) return null;
  const { db } = store;
  const [debt, txs, wallets] = await Promise.all([
    db.debts.get(tx.debtId),
    db.transactions.where('debtId').equals(tx.debtId).toArray(),
    db.wallets.toArray(),
  ]);
  if (!debt) return null;
  try {
    const overMinor = overpayGrowth(debt, txs, wallets, tx.id, edit);
    return overMinor > 0 ? { overMinor, currency: debt.currency } : null;
  } catch (e) {
    if (e instanceof RangeError) throw new ValidationError(DEBT_OVERFLOW_MESSAGE);
    throw e;
  }
}
