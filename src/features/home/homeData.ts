import { totalInBase } from '@/domain/totals';
import { addMinor } from '@/domain/money';
import type { CategoryTotal } from '@/db';
import type { CurrencyCode, IsoDate, Minor, UUID, Wallet } from '@/domain/types';
import type { RateLookup } from '@/rates/types';

/** Чистые расчёты для главной (без React и базы). */

export interface HomeTotal {
  /** Итог по кошелькам в основной валюте — только по тем валютам, для которых курс известен. */
  totalMinor: Minor;
  /** Часть денег пересчитана по курсу, поэтому сумма приблизительная («≈»). */
  approximate: boolean;
  /** Валюты без курса: в итог НЕ вошли. Остаток показываем в самой валюте. */
  missing: { currency: CurrencyCode; balanceMinor: Minor }[];
  /** Курсы старше 3 суток. */
  stale: { currency: CurrencyCode; asOf: IsoDate }[];
}

/**
 * «Всего»: сначала точно складываем остатки внутри каждой валюты, потом каждую сумму переводим по курсу один раз
 * (domain/totals.ts). Валюта с нулевым остатком ничего не добавляет — её отсутствие курса не тревожит.
 * null — сумма не помещается в безопасное целое.
 */
export function computeHomeTotal(
  wallets: readonly Pick<Wallet, 'id' | 'currency'>[],
  balances: ReadonlyMap<UUID, Minor>,
  base: CurrencyCode,
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null,
): HomeTotal | null {
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
    const stale: HomeTotal['stale'] = [];
    for (const [currency, hit] of used) {
      if (!hit || missing.includes(currency)) continue;
      approximate = true;
      if (hit.stale) stale.push({ currency, asOf: hit.asOf });
    }
    return {
      totalMinor,
      approximate,
      missing: missing.map((currency) => ({ currency, balanceMinor: sums.get(currency) ?? 0 })),
      stale: stale.sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

export interface CategoryBars {
  top: CategoryTotal[];
  /** Сколько категорий не поместилось в топ и их общая сумма. */
  restCount: number;
  restMinor: Minor;
}

/** Топ-N категорий расходов и «ещё» (сумма остальных). Вход уже отсортирован от большего к меньшему. */
export function topCategories(byCategory: readonly CategoryTotal[], limit = 5): CategoryBars {
  const top = byCategory.slice(0, limit);
  const rest = byCategory.slice(limit);
  let restMinor: Minor = 0;
  for (const r of rest) restMinor = addMinor(restMinor, r.totalMinor);
  return { top, restCount: rest.length, restMinor };
}

/** Доля в процентах (0–100), округлённая; при нулевом целом — 0. */
export function sharePercent(part: Minor, whole: Minor): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}
