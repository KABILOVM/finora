import { totalInBase } from '@/domain/totals';
import { floorDiv } from '@/domain/forecast';
import { addMinor } from '@/domain/money';
import type { CategoryTotal } from '@/db';
import { summarizeDay } from '@/db/queries';
import { addDays } from '@/lib/dates';
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
  /** Валюты, пересчитанные по курсу, который человек сам ввёл в операции (с днём ввода). Интерфейс обязан сказать об этом. */
  entered: { currency: CurrencyCode; asOf: IsoDate }[];
  /** true, если хотя бы одна валюта пересчитана по обычному курсу (сеть или «Свой курс»), а не по введённому в операции. */
  viaOtherRates: boolean;
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
    let viaOtherRates = false;
    const stale: HomeTotal['stale'] = [];
    const entered: HomeTotal['entered'] = [];
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

/**
 * Средний расход в день с начала месяца: расход месяца ÷ число прошедших дней, считая сегодняшний (номер дня в дате).
 * Округляем вниз, как и остальные «в день» (domain/forecast.ts). null — расходов в месяце нет: «0 в день» ничего не говорит.
 * Бросает RangeError, если сумма не помещается в безопасное целое.
 */
export function avgPerDay(expenseMinor: Minor, today: IsoDate): Minor | null {
  if (expenseMinor <= 0) return null;
  const day = Number(today.slice(8, 10));
  return floorDiv(expenseMinor, day >= 1 ? day : 1);
}

type DayTx = Parameters<typeof summarizeDay>[0][number];

/**
 * Остаток по дням для графика: от сегодняшнего итога назад. За день деньги на руках меняются на «доходы − расходы»
 * плюс движение по долгам (по снимкам суммы в базовой валюте). Возвращает days + 1 точку: от самой старой к сегодняшней.
 * Бросает RangeError, если суммы не помещаются в безопасное целое (экран тогда просто не рисует график).
 */
export function balanceSeries(
  txs: readonly DayTx[],
  endMinor: Minor,
  today: IsoDate,
  days: number,
  base: CurrencyCode,
): Minor[] {
  const byDay = new Map<IsoDate, DayTx[]>();
  for (const t of txs) {
    const list = byDay.get(t.occurredOn);
    if (list) list.push(t);
    else byDay.set(t.occurredOn, [t]);
  }
  const out: Minor[] = [];
  let balance = endMinor;
  for (let i = 0; i <= days; i++) {
    out.unshift(balance);
    const day = summarizeDay(byDay.get(addDays(today, -i)) ?? [], base);
    balance = addMinor(balance, -addMinor(day.netMinor, day.debtFlowMinor));
  }
  return out;
}

/** Сглаженная линия по точкам для SVG 300×90: путь и высота последней точки (для маркера). */
export function sparkPath(points: readonly number[], width = 300, height = 90): { d: string; lastY: number } {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const pts = points.map((v, i): [number, number] => [
    (i / Math.max(1, points.length - 1)) * width,
    span === 0 ? height / 2 : height - 10 - ((v - min) / span) * (height - 26),
  ]);
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)]!;
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[i + 1]!;
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)]!;
    d += ` C${f(x1 + (x2 - x0) / 6)} ${f(y1 + (y2 - y0) / 6)} ${f(x2 - (x3 - x1) / 6)} ${f(y2 - (y3 - y1) / 6)} ${f(x2)} ${f(y2)}`;
  }
  return { d, lastY: pts[pts.length - 1]![1] };
}
