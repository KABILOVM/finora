import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useStore } from '@/db';
import type { CurrencyCode, UUID } from '@/domain/types';
import { listTrips, tripReport, type TripInfo, type TripReport, type TripTx } from './trips';

export interface TripsData {
  base: CurrencyCode;
  trips: TripInfo[];
  /** Операции с метками (живые): из них строится отчёт выбранной поездки. */
  txs: TripTx[];
  currencyOf: ReadonlyMap<UUID, CurrencyCode>;
}

/**
 * Поездки одним чтением базы: операции с `#` в заметке (метки лежат в заметках, отдельного индекса у них нет — читаем по порядку,
 * отбирая только нужные) и валюты кошельков. undefined — читается; null — настроек ещё нет.
 */
export function useTrips(): TripsData | null | undefined {
  const store = useStore();
  const loaded = useLiveQuery(async () => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const [txs, wallets] = await Promise.all([
      store.db.transactions.filter((t) => t.deletedAt === null && t.note.includes('#')).toArray(),
      store.db.wallets.toArray(),
    ]);
    return { base: settings.baseCurrency, txs, currencyOf: new Map(wallets.map((w) => [w.id, w.currency] as const)) };
  }, [store]);
  return useMemo((): TripsData | null | undefined => {
    if (loaded === undefined || loaded === null) return loaded;
    return { ...loaded, trips: listTrips(loaded.txs, loaded.base) };
  }, [loaded]);
}

/** Отчёт по поездке `key`; null — поездки с такой меткой нет (или сумма не помещается в безопасное целое). */
export function useTripReport(data: TripsData | null | undefined, key: string | null): TripReport | null {
  return useMemo(() => {
    if (!data || key === null) return null;
    try {
      return tripReport(data.txs, key, data.base, data.currencyOf);
    } catch (e) {
      if (e instanceof RangeError) return null;
      throw e;
    }
  }, [data, key]);
}
