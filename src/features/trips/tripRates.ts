import { daysBetween, floorDiv } from '@/domain/forecast';
import { isAdjustment } from '@/domain/adjustment';
import { factorOf } from '@/domain/currency';
import { addMinor, convertMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor, UUID } from '@/domain/types';
import { hasTag, type TripTx } from './trips';

/**
 * Курс поездки и деньги поездки: ЧИСТЫЕ функции (без React и базы).
 *
 * Обмен валюты — это перевод между кошельками РАЗНЫХ валют с меткой поездки в заметке («отдал 1000 с., получил 90 $»). Из таких
 * обменов считается курс поездки: сколько сомони реально стоит единица валюты. Он средневзвешенный: всего отдано сомони ÷ всего
 * получено валюты. Цепочка (сомони → доллары → дирхамы) считается звено за звеном: единицу дирхама оценивают по цене тех долларов,
 * что за него отданы. Никакой новой таблицы: всё берётся из операций с меткой, поэтому работает офлайн и ездит между устройствами.
 */

/** Один обмен валюты внутри поездки. */
export interface Exchange {
  txId: UUID;
  occurredOn: IsoDate;
  fromWalletId: UUID;
  toWalletId: UUID;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  /** Отдано (в валюте кошелька списания). */
  fromMinor: Minor;
  /** Получено (в валюте кошелька зачисления). */
  toMinor: Minor;
}

/** Курс поездки к основной валюте для одной валюты. */
export interface TripRate {
  currency: CurrencyCode;
  /** Единиц основной валюты за 1 единицу этой валюты (например, 11,1 с. за 1 $). */
  rate: number;
  /** Сколько всего получено этой валюты обменами (минорные единицы). */
  unitsMinor: Minor;
  /** Сколько основной валюты за это отдано (минорные единицы). */
  costMinor: Minor;
  /** Сколько обменов вошло в курс. */
  exchanges: number;
  /** День последнего обмена (до него курс складывался). */
  lastOn: IsoDate;
}

export interface TripRates {
  rates: ReadonlyMap<CurrencyCode, TripRate>;
  /** Отдано основной валюты на обмен (из кошельков в основной валюте). */
  paidMinor: Minor;
  /** Получено основной валюты обратно (обмен остатка в сомони). */
  returnedMinor: Minor;
  /** Во сколько основной валюты обошлись возвращённые деньги по курсу поездки. */
  returnCostMinor: Minor;
}

const SCALE_DIGITS = 12;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

const isLive = (t: TripTx): boolean => t.deletedAt === null && !isAdjustment(t) && (t.debtId ?? null) === null;

const byTime = (a: TripTx, b: TripTx): number =>
  a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

/** Обмены поездки `key` по порядку (дата, время внесения). `currencyOf` — валюта кошелька по id; неизвестный кошелёк — перевод пропускается. */
export function tripExchanges(txs: readonly TripTx[], key: string, currencyOf: ReadonlyMap<UUID, CurrencyCode>): Exchange[] {
  const out: Exchange[] = [];
  for (const t of [...txs].sort(byTime)) {
    if (!isLive(t) || t.kind !== 'transfer' || t.toWalletId === null || t.toWalletId === undefined) continue;
    const to = t.toAmountMinor;
    if (to === null || to === undefined || to <= 0 || t.amountMinor <= 0) continue;
    if (!hasTag(t.note, key)) continue;
    const fromCurrency = currencyOf.get(t.walletId);
    const toCurrency = currencyOf.get(t.toWalletId);
    if (fromCurrency === undefined || toCurrency === undefined || fromCurrency === toCurrency) continue;
    out.push({ txId: t.id, occurredOn: t.occurredOn, fromWalletId: t.walletId, toWalletId: t.toWalletId, fromCurrency, toCurrency, fromMinor: t.amountMinor, toMinor: to });
  }
  return out;
}

/** a × b ÷ c, округление «от нуля» на половинке; точно, целыми числами. */
function mulDivRound(a: Minor, b: Minor, c: Minor): Minor {
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const out = (2n * num + den) / (2n * den);
  if (out > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Переполнение при расчёте курса поездки');
  return Number(out);
}

/** Единиц основной валюты за 1 единицу `currency`: cost и units — в минорных единицах обеих валют. null — считать нечего. */
export function rateFromAmounts(unitsMinor: Minor, costMinor: Minor, currency: CurrencyCode, base: CurrencyCode): number | null {
  if (!(unitsMinor > 0) || !(costMinor > 0)) return null;
  const scaled = (BigInt(costMinor) * BigInt(factorOf(currency)) * SCALE) / (BigInt(unitsMinor) * BigInt(factorOf(base)));
  const rate = Number(scaled) / Number(SCALE);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Курсы поездки по обменам. `fallback` — чем оценить валюту, которой нет в обменах поездки (деньги были и до поездки, например
 * оставшиеся с прошлой): курс к основной валюте или null.
 */
export function tripRates(exchanges: readonly Exchange[], base: CurrencyCode, fallback: (currency: CurrencyCode) => number | null = () => null): TripRates {
  const pools = new Map<CurrencyCode, { units: Minor; cost: Minor; exchanges: number; lastOn: IsoDate }>();
  let paid = 0;
  let returned = 0;
  let returnCost = 0;

  /** Сколько основной валюты стоят `minor` единиц `currency`: по курсу поездки, а нет его — по запасному. null — оценить нечем. */
  const costOf = (currency: CurrencyCode, minor: Minor): Minor | null => {
    if (currency === base) return minor;
    const pool = pools.get(currency);
    if (pool && pool.units > 0 && pool.cost > 0) return mulDivRound(minor, pool.cost, pool.units);
    const rate = fallback(currency);
    if (rate === null || !(rate > 0)) return null;
    try {
      return convertMinor(minor, currency, base, rate);
    } catch {
      return null;
    }
  };

  for (const ex of exchanges) {
    const cost = costOf(ex.fromCurrency, ex.fromMinor);
    if (cost === null || cost <= 0) continue; // обмен нечем оценить: курс не искажаем
    if (ex.fromCurrency === base) paid = addMinor(paid, ex.fromMinor);
    if (ex.toCurrency === base) {
      // возврат остатка в основную валюту: курс не меняет, но разница с ценой этих денег — потеря (или выгода) поездки
      returned = addMinor(returned, ex.toMinor);
      returnCost = addMinor(returnCost, cost);
      continue;
    }
    const pool = pools.get(ex.toCurrency) ?? { units: 0, cost: 0, exchanges: 0, lastOn: ex.occurredOn };
    pool.units = addMinor(pool.units, ex.toMinor);
    pool.cost = addMinor(pool.cost, cost);
    pool.exchanges += 1;
    pool.lastOn = ex.occurredOn;
    pools.set(ex.toCurrency, pool);
  }

  const rates = new Map<CurrencyCode, TripRate>();
  for (const [currency, pool] of pools) {
    const rate = rateFromAmounts(pool.units, pool.cost, currency, base);
    if (rate !== null) rates.set(currency, { currency, rate, unitsMinor: pool.units, costMinor: pool.cost, exchanges: pool.exchanges, lastOn: pool.lastOn });
  }
  return { rates, paidMinor: paid, returnedMinor: returned, returnCostMinor: returnCost };
}

/** Кошельки, куда в этой поездке обменивали деньги (не основная валюта): по валютам, самые свежие первыми. */
export function tripWalletIds(exchanges: readonly Exchange[], base: CurrencyCode): Map<CurrencyCode, UUID[]> {
  const out = new Map<CurrencyCode, UUID[]>();
  for (const ex of [...exchanges].reverse()) {
    if (ex.toCurrency === base) continue;
    const list = out.get(ex.toCurrency) ?? [];
    if (!list.includes(ex.toWalletId)) list.push(ex.toWalletId);
    out.set(ex.toCurrency, list);
  }
  return out;
}

export interface TripWalletMoney {
  walletId: UUID;
  currency: CurrencyCode;
  /** Остаток кошелька (минорные единицы его валюты). */
  balanceMinor: Minor;
  /** Остаток в основной валюте по курсу поездки; null — курса поездки для этой валюты нет. */
  valueMinor: Minor | null;
}

/** Остаток каждого кошелька поездки и его цена в основной валюте по курсу поездки. */
export function tripWalletMoney(
  ids: ReadonlyMap<CurrencyCode, readonly UUID[]>,
  balances: ReadonlyMap<UUID, Minor>,
  rates: ReadonlyMap<CurrencyCode, TripRate>,
  base: CurrencyCode,
): TripWalletMoney[] {
  const out: TripWalletMoney[] = [];
  for (const [currency, walletIds] of ids) {
    for (const walletId of walletIds) {
      const balanceMinor = balances.get(walletId);
      if (balanceMinor === undefined) continue;
      const rate = rates.get(currency)?.rate ?? null;
      let valueMinor: Minor | null = null;
      if (rate !== null && balanceMinor !== 0) {
        try {
          valueMinor = convertMinor(balanceMinor, currency, base, rate);
        } catch {
          valueMinor = null;
        }
      } else if (balanceMinor === 0) valueMinor = 0;
      out.push({ walletId, currency, balanceMinor, valueMinor });
    }
  }
  return out;
}

/**
 * Во сколько обошлась поездка с учётом возврата остатка: расходы поездки (по курсу) плюс курсовая разница возврата.
 * Вернули 320 $ за 3 480 с., хотя по курсу поездки они стоили 3 552 с. — поездка обошлась на 72 с. дороже, чем показывают траты.
 * null — возврата не было.
 */
export function tripNetCost(expenseMinor: Minor, rates: Pick<TripRates, 'returnedMinor' | 'returnCostMinor'>): { netMinor: Minor; lossMinor: Minor } | null {
  if (rates.returnedMinor <= 0) return null;
  const lossMinor = rates.returnCostMinor - rates.returnedMinor;
  return { netMinor: addMinor(expenseMinor, lossMinor), lossMinor };
}

// ───────────────────────── план поездки: «сколько можно тратить в день» ─────────────────────────

/** План поездки: с какого дня и на сколько дней рассчитаны деньги. Живёт на устройстве (tripPlan.ts). */
export interface TripPlan {
  startOn: IsoDate;
  days: number;
}

export const PLAN_DAYS_MIN = 1;
export const PLAN_DAYS_MAX = 365;

/** Сколько дней осталось, считая сегодняшний (не меньше одного). До начала поездки — все дни плана. */
export function daysLeft(plan: TripPlan, today: IsoDate): number {
  if (today <= plan.startOn) return plan.days;
  return Math.max(plan.days - daysBetween(plan.startOn, today), 1);
}

export interface DailyAllowance {
  /** Сколько можно тратить в день: (остаток + потрачено сегодня) ÷ оставшиеся дни, вниз. */
  perDayMinor: Minor;
  /** Сколько можно потратить ещё сегодня (отрицательное — уже потрачено больше). */
  leftTodayMinor: Minor;
  daysLeft: number;
}

/**
 * «Сколько можно тратить в день»: остаток на начало дня делится на оставшиеся дни. Потраченное сегодня возвращаем в остаток, чтобы
 * дневная сумма не «плыла» с каждой тратой, а «осталось на сегодня» уменьшалось.
 */
export function dailyAllowance(balanceMinor: Minor, spentTodayMinor: Minor, daysLeftCount: number): DailyAllowance {
  const days = Math.max(Math.floor(daysLeftCount), 1);
  const startOfDay = Math.max(addMinor(balanceMinor, spentTodayMinor), 0);
  const perDayMinor = floorDiv(startOfDay, days);
  return { perDayMinor, leftTodayMinor: perDayMinor - spentTodayMinor, daysLeft: days };
}
