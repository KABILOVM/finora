import { addMinor } from '@/domain/money';
import { totalInBase } from '@/domain/totals';
import type { CurrencyCode, IsoDate, Minor, UUID, Wallet } from '@/domain/types';
import type { RateLookup } from '@/rates/types';

export interface WalletsTotal {
  /** Итог в базовой валюте по тем валютам, для которых курс известен. */
  totalMinor: Minor;
  /** Валюты без курса: в итог НЕ вошли. */
  missing: CurrencyCode[];
  /** true, если в итог вошла хотя бы одна пересчитанная по курсу валюта: сумма приблизительная («≈»). */
  approximate: boolean;
  /** Валюты, чей курс устарел (старше 3 суток). */
  stale: { currency: CurrencyCode; asOf: IsoDate }[];
}

/**
 * «Всего» по активным (не архивным) кошелькам в базовой валюте. Сначала точно суммируются остатки внутри каждой валюты,
 * потом каждая сумма переводится по курсу один раз (см. domain/totals.ts). null — сумма слишком велика для расчёта.
 */
export function computeWalletsTotal(
  wallets: readonly Pick<Wallet, 'id' | 'currency'>[],
  balances: ReadonlyMap<UUID, Minor>,
  base: CurrencyCode,
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null,
): WalletsTotal | null {
  try {
    const items = wallets.map((w) => ({ currency: w.currency, balanceMinor: balances.get(w.id) ?? 0 }));
    const rates = new Map<CurrencyCode, RateLookup | null>();
    const lookup = (from: CurrencyCode, to: CurrencyCode): number | null => {
      const hit = getRate(from, to);
      rates.set(from, hit);
      return hit ? hit.rate : null;
    };
    const { totalMinor, missing } = totalInBase(items, base, lookup);
    const stale: WalletsTotal['stale'] = [];
    let approximate = false;
    for (const [currency, hit] of rates) {
      if (!hit || missing.includes(currency)) continue;
      approximate = true;
      if (hit.stale) stale.push({ currency, asOf: hit.asOf });
    }
    // защита от переполнения при дальнейшем показе: сумма должна быть безопасным целым
    addMinor(totalMinor, 0);
    return { totalMinor, missing, approximate, stale: stale.sort((a, b) => a.currency.localeCompare(b.currency)) };
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}
