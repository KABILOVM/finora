import type { ToastApi } from '@/components/Toast';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import type { IsoDate } from '@/domain/types';
import { buildTripMoney, loadTripData, type TripWalletView } from './useTripMoney';
import { tagKey } from './trips';

/**
 * Завершение поездки: пустые кошельки поездки («USD · Самарканд» с нулевым остатком) уходят в архив. Кошелёк, где ещё остались
 * деньги, не трогаем: их можно вернуть в сомони обменом (экран поездки). Возвращает кошельки с остатком, чтобы сказать об этом человеку.
 * Сбой архивации не мешает завершить поездку: режим выключает вызывающий код, а кошелёк можно убрать в архив руками.
 */
export async function archiveEmptyTripWallets(store: Store, tag: string, today: IsoDate): Promise<TripWalletView[]> {
  const key = tagKey(tag);
  const data = await loadTripData(store, key);
  if (!data) return [];
  const money = buildTripMoney(data, tag, key, today);
  for (const w of money.wallets) {
    if (!w.archived && w.balanceMinor === 0) await store.wallets.archive(w.walletId);
  }
  return money.wallets.filter((w) => w.balanceMinor > 0);
}

/**
 * После завершения поездки: убирает в архив пустые кошельки поездки, а если в кошельках остались деньги, говорит об этом тостом
 * (их можно вернуть в сомони обменом в «Поездках»). Не бросает: сбой архивации только пишется в консоль.
 */
export function tidyTripWallets(store: Store, toast: ToastApi, tag: string, today: IsoDate): Promise<void> {
  return archiveEmptyTripWallets(store, tag, today).then(
    (left) => {
      if (left.length > 0) {
        toast.show(`В кошельках поездки остались деньги: ${left.map((w) => formatMinor(w.balanceMinor, w.currency)).join(', ')}. Их можно вернуть в сомони обменом.`);
      }
    },
    (e: unknown) => console.error('Кошельки поездки не убраны в архив:', e),
  );
}
