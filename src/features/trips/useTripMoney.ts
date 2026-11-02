import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';
import { useStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { isAdjustment } from '@/domain/adjustment';
import { addMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, LocalRow, Minor, Transaction, UUID, Wallet } from '@/domain/types';
import { useToday } from '@/recurring/useToday';
import type { RateLookup } from '@/rates/types';
import {
  tripExchanges,
  tripRates,
  tripWalletIds,
  tripWalletMoney,
  type Exchange,
  type TripRate,
  type TripWalletMoney,
} from './tripRates';
import { tagKey, tagLabel, type TripTx } from './trips';

/** Кошелёк поездки: остаток, его цена в основной валюте и сколько потрачено из него сегодня. */
export interface TripWalletView extends TripWalletMoney {
  name: string;
  archived: boolean;
  /** Расходы из этого кошелька за сегодня (его валюта). */
  spentTodayMinor: Minor;
}

export interface TripMoney {
  tag: string;
  key: string;
  label: string;
  base: CurrencyCode;
  exchanges: Exchange[];
  rates: ReadonlyMap<CurrencyCode, TripRate>;
  paidMinor: Minor;
  returnedMinor: Minor;
  returnCostMinor: Minor;
  wallets: TripWalletView[];
}

/** Курс поездки в виде, который понимает форма операции (источник 'trip'). null — для этой валюты обменов не было. */
export function tripRateLookup(rates: ReadonlyMap<CurrencyCode, TripRate>, currency: CurrencyCode): RateLookup | null {
  const r = rates.get(currency);
  if (!r) return null;
  return { rate: r.rate, source: 'trip', asOf: r.lastOn, stale: false, manual: false };
}

export interface TripData {
  base: CurrencyCode;
  wallets: LocalRow<Wallet>[];
  /** Операции с метками (из них — обмены поездки). */
  tagged: LocalRow<Transaction>[];
  /** Все живые операции по кошелькам поездки (из них — остаток и траты за сегодня). */
  touching: LocalRow<Transaction>[];
}

/**
 * Читает из базы всё, что нужно для денег поездки `key`. Метки лежат в заметках операций, отдельного индекса у них нет,
 * поэтому берём операции с «#» (как useTrips). null — приложение ещё не настроено.
 */
export async function loadTripData(store: Store, key: string): Promise<TripData | null> {
  const settings = await store.settings.get();
  if (!settings) return null;
  const [tagged, wallets] = await Promise.all([
    store.db.transactions.filter((t) => t.deletedAt === null && t.note.includes('#')).toArray(),
    store.db.wallets.toArray(),
  ]);
  const currencyOf = new Map(wallets.map((w) => [w.id, w.currency] as const));
  const ids = [...tripWalletIds(tripExchanges(tagged, key, currencyOf), settings.baseCurrency).values()].flat();
  let touching: LocalRow<Transaction>[] = [];
  if (ids.length > 0) {
    const [from, to] = await Promise.all([
      store.db.transactions.where('walletId').anyOf(ids).toArray(),
      store.db.transactions.where('toWalletId').anyOf(ids).toArray(),
    ]);
    const seen = new Set<UUID>();
    touching = [...from, ...to].filter((t) => t.deletedAt === null && !seen.has(t.id) && (seen.add(t.id), true));
  }
  return { base: settings.baseCurrency, wallets, tagged, touching };
}

/**
 * Деньги поездки `tag`: курс по обменам, кошельки поездки с остатком и ценой остатка в основной валюте. Читает базу сам и
 * обновляется вместе с ней. undefined — читается; null — поездки нет (метка пуста) или приложение ещё не настроено.
 */
export function useTripMoney(tag: string | null): TripMoney | null | undefined {
  const store = useStore();
  const today = useToday();
  const key = tag === null ? null : tagKey(tag);
  const loaded = useLiveQuery(async (): Promise<TripData | null> => (key === null ? null : loadTripData(store, key)), [store, key]);

  return useMemo((): TripMoney | null | undefined => {
    if (loaded === undefined) return undefined;
    if (loaded === null || tag === null || key === null) return null;
    try {
      return buildTripMoney(loaded, tag, key, today);
    } catch (e) {
      if (e instanceof RangeError) return null; // сумма не помещается в безопасное целое: поездку не показываем
      throw e;
    }
  }, [loaded, tag, key, today]);
}

export function buildTripMoney(loaded: TripData, tag: string, key: string, today: IsoDate): TripMoney {
  const { base, wallets, tagged, touching } = loaded;
  const currencyOf = new Map(wallets.map((w) => [w.id, w.currency] as const));
  const exchanges = tripExchanges(tagged as readonly TripTx[], key, currencyOf);
  const calc = tripRates(exchanges, base);
  const ids = tripWalletIds(exchanges, base);
  const tripWallets = wallets.filter((w) => [...ids.values()].some((list) => list.includes(w.id)));
  const balances = computeBalances(tripWallets, touching);
  const money = tripWalletMoney(ids, balances, calc.rates, base);
  const byId = new Map(wallets.map((w) => [w.id, w] as const));
  const spentToday = new Map<UUID, Minor>();
  for (const t of touching) {
    if (t.kind !== 'expense' || t.occurredOn !== today || isAdjustment(t)) continue;
    spentToday.set(t.walletId, addMinor(spentToday.get(t.walletId) ?? 0, t.amountMinor));
  }
  return {
    tag,
    key,
    label: tagLabel(tag),
    base,
    exchanges,
    rates: calc.rates,
    paidMinor: calc.paidMinor,
    returnedMinor: calc.returnedMinor,
    returnCostMinor: calc.returnCostMinor,
    wallets: money.map((m) => ({
      ...m,
      name: byId.get(m.walletId)?.name ?? '',
      archived: (byId.get(m.walletId)?.archivedAt ?? null) !== null,
      spentTodayMinor: spentToday.get(m.walletId) ?? 0,
    })),
  };
}

/** Функция «курс поездки для валюты» для формы операции; undefined, пока поездка не начата или данные читаются. */
export function useTripRateLookup(tag: string | null): ((currency: CurrencyCode) => RateLookup | null) | undefined {
  const money = useTripMoney(tag);
  const rates = money?.rates;
  const lookup = useCallback((currency: CurrencyCode) => (rates ? tripRateLookup(rates, currency) : null), [rates]);
  return rates && rates.size > 0 ? lookup : undefined;
}
