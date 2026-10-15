import { addMinor, isMinor } from './money';
import type { CurrencyCode, Debt, IsoDate, Minor, Transaction, UUID, Wallet } from './types';

/**
 * Остаток долга — ЧИСТАЯ функция над операциями. Нигде не хранится (как остаток кошелька), поэтому разойтись с операциями не может.
 *
 * Операции долга — расходы/доходы с debtId (переводы к долгу не относятся):
 *  - lent («мне должны», я дал): выдача — РАСХОД (деньги ушли от меня), платежи мне — ДОХОДЫ;
 *  - borrowed («я должен», мне дали): получение — ДОХОД, мои платежи — РАСХОДЫ.
 * Остаток = исходная сумма долга (principalMinor) − сумма платежей. Для показа он не меньше 0, а переплата (платежей больше долга)
 * считается отдельно. Исходная операция в остаток не входит (сумма долга задана самим долгом), но суммируется отдельно
 * (issuedMinor) — по ней видно, выдан ли долг деньгами.
 * Валюта операции — валюта её кошелька. Операция в валюте, отличной от валюты долга, в остаток НЕ входит и попадает в диагностику
 * (issues): складывать дирамы с долларами нельзя. То же для операции с неизвестным кошельком и для «перевода с debtId».
 */

export type DebtTx = Pick<Transaction, 'id' | 'kind' | 'walletId' | 'amountMinor' | 'occurredOn' | 'createdAt' | 'deletedAt' | 'debtId'>;
export type DebtInfo = Pick<Debt, 'id' | 'direction' | 'principalMinor' | 'currency'>;

export type DebtIssueReason = 'foreign-currency' | 'unknown-wallet' | 'transfer' | 'bad-amount';

export interface DebtIssue {
  txId: UUID;
  reason: DebtIssueReason;
  /** Для 'foreign-currency': валюта кошелька операции. */
  currency?: CurrencyCode;
  message: string;
}

export interface DebtPayment {
  txId: UUID;
  occurredOn: IsoDate;
  amountMinor: Minor;
}

export interface DebtState {
  principalMinor: Minor;
  currency: CurrencyCode;
  /** Сумма платежей (операции того же вида, что «возврат долга»). */
  paidMinor: Minor;
  /** principal − платежи, но не меньше 0. */
  remainingMinor: Minor;
  /** Платежи сверх суммы долга (0, если переплаты нет). */
  overpaidMinor: Minor;
  /** Сумма исходных операций (выдача/получение долга). */
  issuedMinor: Minor;
  /** Остаток равен 0 (долг погашен полностью или с переплатой). */
  settled: boolean;
  /** Платежи по порядку: старые первыми. */
  payments: DebtPayment[];
  /** Выдачи и пополнения (исходная операция и «добавить ещё») по порядку: старые первыми. Сумма — issuedMinor. */
  entries: DebtPayment[];
  /** Операции долга, которые не вошли в расчёт, и почему. */
  issues: DebtIssue[];
}

/** Вид операции-платежа для направления: мне должны → платёж это доход; я должен → расход. */
export const paymentKind = (direction: Debt['direction']): 'income' | 'expense' => (direction === 'lent' ? 'income' : 'expense');
/** Вид исходной операции: я дал → расход; мне дали → доход. */
export const issueKind = (direction: Debt['direction']): 'income' | 'expense' => (direction === 'lent' ? 'expense' : 'income');

const byOrder = (a: DebtTx, b: DebtTx): number =>
  a.occurredOn !== b.occurredOn
    ? a.occurredOn < b.occurredOn ? -1 : 1
    : a.createdAt !== b.createdAt
      ? a.createdAt < b.createdAt ? -1 : 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * wallets — кошельки (в том числе архивные и удалённые): по ним определяется валюта операции.
 * Берутся только живые операции именно этого долга (по debtId); чужие и удалённые пропускаются.
 */
export function computeDebtState(
  debt: DebtInfo,
  txs: readonly DebtTx[],
  wallets: ReadonlyMap<UUID, Pick<Wallet, 'currency'>> | readonly (Pick<Wallet, 'id' | 'currency'>)[],
): DebtState {
  const currencyByWallet: ReadonlyMap<UUID, CurrencyCode> =
    wallets instanceof Map
      ? new Map([...wallets].map(([id, w]) => [id, w.currency]))
      : new Map((wallets as readonly Pick<Wallet, 'id' | 'currency'>[]).map((w) => [w.id, w.currency]));
  const cur = (id: UUID): CurrencyCode | undefined => currencyByWallet.get(id);

  const pay = paymentKind(debt.direction);
  const mine = txs.filter((t) => t.debtId === debt.id && t.deletedAt === null).sort(byOrder);

  let paid: Minor = 0;
  let issued: Minor = 0;
  const payments: DebtPayment[] = [];
  const entries: DebtPayment[] = [];
  const issues: DebtIssue[] = [];

  for (const t of mine) {
    if (t.kind === 'transfer') {
      issues.push({ txId: t.id, reason: 'transfer', message: 'Перевод не может относиться к долгу' });
      continue;
    }
    if (!isMinor(t.amountMinor) || t.amountMinor <= 0) {
      issues.push({ txId: t.id, reason: 'bad-amount', message: 'Некорректная сумма операции долга' });
      continue;
    }
    const currency = cur(t.walletId);
    if (currency === undefined) {
      issues.push({ txId: t.id, reason: 'unknown-wallet', message: 'Кошелёк операции долга не найден' });
      continue;
    }
    if (currency !== debt.currency) {
      issues.push({
        txId: t.id,
        reason: 'foreign-currency',
        currency,
        message: `Операция в ${currency}, а долг в ${debt.currency}: в остаток не входит`,
      });
      continue;
    }
    if (t.kind === pay) {
      paid = addMinor(paid, t.amountMinor);
      payments.push({ txId: t.id, occurredOn: t.occurredOn, amountMinor: t.amountMinor });
    } else {
      issued = addMinor(issued, t.amountMinor);
      entries.push({ txId: t.id, occurredOn: t.occurredOn, amountMinor: t.amountMinor });
    }
  }

  const principal = debt.principalMinor;
  const left = principal - paid; // оба в безопасных целых, разность не выходит за ±2·MAX_SAFE
  const remaining = left > 0 ? left : 0;
  return {
    principalMinor: principal,
    currency: debt.currency,
    paidMinor: paid,
    remainingMinor: remaining,
    overpaidMinor: left < 0 ? -left : 0,
    issuedMinor: issued,
    settled: remaining === 0,
    payments,
    entries,
    issues,
  };
}
