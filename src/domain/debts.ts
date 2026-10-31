import { addMinor, isMinor } from './money';
import type { CurrencyCode, Debt, IsoDate, Minor, RecurringRule, Transaction, UUID, Wallet } from './types';

/**
 * Остаток долга — ЧИСТАЯ функция над операциями. Нигде не хранится (как остаток кошелька), поэтому разойтись с операциями не может.
 *
 * Операции долга — расходы/доходы с debtId (переводы к долгу не относятся):
 *  - lent («мне должны», я дал): выдача — РАСХОД (деньги ушли от меня), платежи мне — ДОХОДЫ;
 *  - borrowed («я должен», мне дали): получение — ДОХОД, мои платежи — РАСХОДЫ.
 * Остаток = исходная сумма долга (principalMinor) + проценты (interestMinor, если они есть) − сумма платежей. Для показа он не
 * меньше 0, а переплата (платежей больше долга) считается отдельно. Исходная операция в остаток не входит (сумма долга задана
 * самим долгом), но суммируется отдельно (issuedMinor) — по ней видно, выдан ли долг деньгами; проценты денег не двигают:
 * они лишь увеличивают то, что нужно вернуть.
 * Валюта операции — валюта её кошелька. Операция в валюте, отличной от валюты долга, в остаток НЕ входит и попадает в диагностику
 * (issues): складывать дирамы с долларами нельзя. То же для операции с неизвестным кошельком и для «перевода с debtId».
 */

export type DebtTx = Pick<Transaction, 'id' | 'kind' | 'walletId' | 'amountMinor' | 'occurredOn' | 'createdAt' | 'deletedAt' | 'debtId'>;
export type DebtInfo = Pick<Debt, 'id' | 'direction' | 'principalMinor' | 'currency'> & {
  /** Проценты за весь срок; нет поля или null — долг без процентов. */
  interestMinor?: Minor | null;
};

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
  /** Проценты за весь срок (0 — без процентов). */
  interestMinor: Minor;
  /** Всего вернуть: сумма долга + проценты. От неё считаются остаток, переплата и доля выплаченного. */
  totalMinor: Minor;
  currency: CurrencyCode;
  /** Сумма платежей (операции того же вида, что «возврат долга»). */
  paidMinor: Minor;
  /** principal + проценты − платежи, но не меньше 0. */
  remainingMinor: Minor;
  /** Платежи сверх суммы долга с процентами (0, если переплаты нет). */
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

type Classified = { role: 'payment' | 'entry' } | { issue: DebtIssue };

/** Куда операция долга попадает в расчёте: платёж, выдача/пополнение или диагностика (и почему). */
function classify(
  t: Pick<DebtTx, 'id' | 'kind' | 'amountMinor'>,
  pay: 'income' | 'expense',
  debtCurrency: CurrencyCode,
  currency: CurrencyCode | undefined,
): Classified {
  if (t.kind === 'transfer') return { issue: { txId: t.id, reason: 'transfer', message: 'Перевод не может относиться к долгу' } };
  if (!isMinor(t.amountMinor) || t.amountMinor <= 0) {
    return { issue: { txId: t.id, reason: 'bad-amount', message: 'Некорректная сумма операции долга' } };
  }
  if (currency === undefined) return { issue: { txId: t.id, reason: 'unknown-wallet', message: 'Кошелёк операции долга не найден' } };
  if (currency !== debtCurrency) {
    return {
      issue: {
        txId: t.id,
        reason: 'foreign-currency',
        currency,
        message: `Операция в ${currency}, а долг в ${debtCurrency}: в остаток не входит`,
      },
    };
  }
  return { role: t.kind === pay ? 'payment' : 'entry' };
}

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
    const c = classify(t, pay, debt.currency, cur(t.walletId));
    if ('issue' in c) {
      issues.push(c.issue);
    } else if (c.role === 'payment') {
      paid = addMinor(paid, t.amountMinor);
      payments.push({ txId: t.id, occurredOn: t.occurredOn, amountMinor: t.amountMinor });
    } else {
      issued = addMinor(issued, t.amountMinor);
      entries.push({ txId: t.id, occurredOn: t.occurredOn, amountMinor: t.amountMinor });
    }
  }

  const principal = debt.principalMinor;
  const interest = debt.interestMinor ?? 0;
  const total = addMinor(principal, interest); // сумма не помещается в безопасное целое — RangeError, как у платежей
  const left = total - paid; // оба в безопасных целых, разность не выходит за ±2·MAX_SAFE
  const remaining = left > 0 ? left : 0;
  return {
    principalMinor: principal,
    interestMinor: interest,
    totalMinor: total,
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

/**
 * Роль операции в долге — та же классификация, что в computeDebtState: платёж (уменьшает остаток), выдача или пополнение
 * (сумма долга задана самим долгом, операция меняет только кошелёк и «Выдано деньгами») или «вне расчёта» (чужая валюта,
 * неизвестный кошелёк, перевод, операция другого долга).
 */
export function debtTxRole(
  debt: Pick<Debt, 'id' | 'direction' | 'currency'>,
  tx: Pick<Transaction, 'id' | 'kind' | 'walletId' | 'amountMinor' | 'debtId'>,
  currencyOf: (walletId: UUID) => CurrencyCode | undefined,
): 'payment' | 'entry' | 'outside' {
  if (tx.debtId !== debt.id) return 'outside';
  const c = classify(tx, paymentKind(debt.direction), debt.currency, currencyOf(tx.walletId));
  return 'issue' in c ? 'outside' : c.role;
}

/** Живой план платежей этого долга: регулярный платёж вида «возврат» с его debtId, не удалён и не в архиве. */
export const isLivePlanOf = (
  rule: Pick<RecurringRule, 'kind' | 'debtId' | 'deletedAt' | 'archivedAt'>,
  debt: Pick<Debt, 'id' | 'direction'>,
): boolean => rule.debtId === debt.id && rule.kind === paymentKind(debt.direction) && rule.deletedAt === null && rule.archivedAt === null;

/**
 * Заметка пропущенной даты плана, которую закрыл отдельный платёж по долгу («Это плановый платёж за …»). По ней «Пропущенные»
 * не предлагают «Вернуть»: деньги уже записаны отдельным платежом, второй раз их записывать нельзя.
 */
export const PLAN_PAID_NOTE = 'Оплачено отдельным платежом';

/** План закончился: дата окончания прошла (новых дат не будет), даже если долг не погашен. today — местная дата. */
export const planFinished = (rule: Pick<RecurringRule, 'endOn'>, today: IsoDate): boolean => rule.endOn !== null && rule.endOn < today;

/** Почему план платежей по долгу стоит: долг удалён, в архиве, закрыт или погашен. */
export type DebtPlanStop = 'deleted' | 'archived' | 'closed' | 'settled';

/**
 * План «Платить частями» — регулярный платёж с debtId того же вида, что «возврат долга». Он останавливается сам, когда долг
 * удалён, в архиве, закрыт или погашен: в правило ничего не пишется, поэтому «Открыть снова» и пополнение долга возвращают
 * план без действий. Правила другого вида (выдача по расписанию) не останавливаются.
 * debt undefined — долга на устройстве нет: план тоже стоит. state null — остаток посчитать не удалось: по остатку не останавливаем.
 */
export function debtPlanStop(
  rule: Pick<RecurringRule, 'kind' | 'debtId'>,
  debt: Pick<Debt, 'direction' | 'deletedAt' | 'archivedAt' | 'closedAt'> | undefined,
  state: Pick<DebtState, 'remainingMinor'> | null,
): DebtPlanStop | null {
  if (rule.debtId === null) return null;
  if (debt === undefined || debt.deletedAt !== null) return 'deleted';
  if (rule.kind !== paymentKind(debt.direction)) return null;
  if (debt.archivedAt !== null) return 'archived';
  if (debt.closedAt !== null) return 'closed';
  if (state !== null && state.remainingMinor <= 0) return 'settled';
  return null;
}

/** Подпись остановленного плана: «Долг погашен — план остановлен». */
export const DEBT_PLAN_STOP_TEXT: Record<DebtPlanStop, string> = {
  deleted: 'Долг удалён — план остановлен',
  archived: 'Долг в архиве — план остановлен',
  closed: 'Долг закрыт — план остановлен',
  settled: 'Долг погашен — план остановлен',
};
