import type { Store } from '@/db';
import type { LocalRow, Transaction, Wallet } from '@/domain/types';
import { fxSourceOf } from '@/features/transactions/txForm';
import { todayLocal } from '@/lib/dates';
import type { useRates } from '@/rates/hooks';

type GetRate = ReturnType<typeof useRates>['getRate'];

/** Ошибка, текст которой можно показать человеку как есть (нет курса, настройки не загружены). */
export class AdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdjustmentError';
  }
}

/**
 * «Корректировка остатка» сегодняшним числом на разницу `deltaMinor` (плюс — в кошельке больше, чем в приложении): видна в истории,
 * но не доход и не расход (domain/adjustment.ts). Кошелёк не в основной валюте записывается по курсу из «Курсов»; нет курса —
 * AdjustmentError с подсказкой. Настройки читаются здесь, а не из хука: нажатие не должно молча пропадать, пока хук ещё загружается.
 */
export async function writeAdjustment(
  store: Store,
  wallet: Pick<Wallet, 'id' | 'currency'>,
  deltaMinor: number,
  getRate: GetRate,
): Promise<LocalRow<Transaction>> {
  const settings = await store.settings.get();
  if (!settings) throw new AdjustmentError('Настройки ещё не загружены. Попробуйте через секунду.');
  let fx: { rate: number; source: string } | undefined;
  if (wallet.currency !== settings.baseCurrency) {
    const hit = getRate(wallet.currency, settings.baseCurrency);
    if (!hit) {
      throw new AdjustmentError(`Нет курса ${wallet.currency} к ${settings.baseCurrency}: задайте его в Настройках → «Курсы валют» или поправьте начальный остаток.`);
    }
    fx = { rate: hit.rate, source: fxSourceOf(hit) };
  }
  return store.transactions.createAdjustment({ walletId: wallet.id, deltaMinor, occurredOn: todayLocal(), ...(fx ? { fx } : {}) });
}
