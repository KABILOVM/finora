import { addMinor } from '@/domain/money';
import { totalInBase } from '@/domain/totals';
import type { CurrencyCode, IsoDate, Minor, UUID, Wallet } from '@/domain/types';
import type { RateLookup } from './types';

export interface WalletsTotal {
  /** Итог по кошелькам в основной валюте — только по тем валютам, для которых курс известен. */
  totalMinor: Minor;
  /** Часть денег пересчитана по курсу, поэтому сумма приблизительная («≈»). */
  approximate: boolean;
  /** Валюты без курса: в итог НЕ вошли. Остаток показываем в самой валюте. */
  missing: { currency: CurrencyCode; balanceMinor: Minor }[];
  /** Курсы старше 3 суток. */
  stale: { currency: CurrencyCode; asOf: IsoDate }[];
  /** Валюты, пересчитанные по курсу, который человек сам ввёл в операции (с днём ввода). Интерфейс обязан сказать об этом. */
  entered: { currency: CurrencyCode; asOf: IsoDate }[];
  /** true, если хотя бы одна валюта пересчитана по обычному курсу (сеть или «Свой курс»), а не по введённому в операции. */
  viaOtherRates: boolean;
}

/**
 * «Всего» по активным кошелькам в основной валюте — единый расчёт для Главной, «Кошельков» и «Аналитики». Сначала точно складываем остатки внутри каждой валюты, потом каждую сумму переводим по курсу один раз
 * (domain/totals.ts). Валюта с нулевым остатком ничего не добавляет — её отсутствие курса не тревожит.
 * null — сумма не помещается в безопасное целое.
 */
export function computeWalletsTotal(
  wallets: readonly Pick<Wallet, 'id' | 'currency'>[],
  balances: ReadonlyMap<UUID, Minor>,
  base: CurrencyCode,
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null,
): WalletsTotal | null {
  try {
    const sums = new Map<CurrencyCode, Minor>();
    for (const w of wallets) sums.set(w.currency, addMinor(sums.get(w.currency) ?? 0, balances.get(w.id) ?? 0));
    const items = [...sums]
      .filter(([currency, sum]) => currency === base || sum !== 0)
      .map(([currency, balanceMinor]) => ({ currency, balanceMinor }));

    const used = new Map<CurrencyCode, RateLookup | null>();
    const { totalMinor, missing } = totalInBase(items, base, (from, to) => {
      const hit = getRate(from, to);
      used.set(from, hit);
      return hit ? hit.rate : null;
    });

    let approximate = false;
    let viaOtherRates = false;
    const stale: WalletsTotal['stale'] = [];
    const entered: WalletsTotal['entered'] = [];
    for (const [currency, hit] of used) {
      if (!hit || missing.includes(currency)) continue;
      approximate = true;
      if (hit.entered) entered.push({ currency, asOf: hit.asOf });
      else viaOtherRates = true;
      if (hit.stale) stale.push({ currency, asOf: hit.asOf });
    }
    return {
      totalMinor,
      approximate,
      missing: missing.map((currency) => ({ currency, balanceMinor: sums.get(currency) ?? 0 })),
      stale: stale.sort((a, b) => a.currency.localeCompare(b.currency)),
      entered: entered.sort((a, b) => a.currency.localeCompare(b.currency)),
      viaOtherRates,
    };
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}
