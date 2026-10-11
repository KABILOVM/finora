import { convertMinor } from '@/domain/money';
import type { CurrencyCode, Minor, TxKind, Wallet } from '@/domain/types';
import type { ReceivedView } from '@/features/transactions/useTxFormController';
import type { RateLookup } from '@/rates/types';

/**
 * Поле «Получено» у перевода — то же правило, что в форме операции (useTxFormController):
 *  - разные валюты: сумма предлагается по курсу и правится руками; курса нет — вводится вручную;
 *  - одна валюта: зачисление равно списанию, разницу можно объявить комиссией (поле открывается кнопкой).
 * override: undefined — человек не трогал поле, null — стёр, число — ввёл.
 */
export function buildReceivedView(a: {
  kind: TxKind;
  wallet: Pick<Wallet, 'currency'> | undefined;
  toWallet: Pick<Wallet, 'currency'> | undefined | null;
  amountMinor: Minor | null;
  override: Minor | null | undefined;
  feeOpen: boolean;
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null;
}): ReceivedView | null {
  const { kind, wallet, toWallet, override } = a;
  if (kind !== 'transfer' || !wallet || !toWallet) return null;
  const from = wallet.currency;
  const to = toWallet.currency;
  const amount = a.amountMinor !== null && a.amountMinor > 0 ? a.amountMinor : null;
  if (from === to) {
    return { mode: 'fee', show: a.feeOpen, value: override !== undefined ? override : amount, suggested: amount, lookup: null, from, to };
  }
  const lookup = a.getRate(from, to);
  let suggested: Minor | null = null;
  if (lookup && amount !== null) {
    try {
      suggested = convertMinor(amount, from, to, lookup.rate);
    } catch {
      suggested = null; // слишком большая сумма для пересчёта — человек введёт зачисление сам
    }
  }
  return { mode: 'cross', show: true, value: override !== undefined ? override : suggested, suggested, lookup, from, to };
}

/**
 * Сумма зачисления перевода для записи; null — не хватает данных (текст ошибки в `error`).
 * Не перевод — null без ошибки.
 */
export function receivedAmount(
  view: ReceivedView | null,
  amount: Minor | null,
): { toAmount: Minor | null; error: string | null } {
  if (!view) return { toAmount: null, error: null };
  const toAmount = view.mode === 'fee' && !view.show ? amount : view.value;
  if (toAmount === null) {
    return {
      toAmount: null,
      error: view.mode === 'cross' && !view.lookup ? 'Курса нет — введите, сколько денег пришло' : 'Укажите, сколько получено',
    };
  }
  if (toAmount <= 0) return { toAmount: null, error: 'Получено должно быть больше нуля' };
  if (view.mode === 'fee' && amount !== null && toAmount > amount) {
    return { toAmount: null, error: 'Получено не может быть больше списанного: разница — это комиссия' };
  }
  return { toAmount, error: null };
}
