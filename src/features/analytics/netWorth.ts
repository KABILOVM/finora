import { daysBetween, endOfMonth } from '@/domain/forecast';
import { addMinor } from '@/domain/money';
import { totalInBase } from '@/domain/totals';
import type { CurrencyCode, DebtDirection, IsoDate, Minor } from '@/domain/types';
import { balanceSeries, type HomeTotal } from '@/features/home/homeData';
import { shiftMonth } from '@/features/transactions/txFilters';
import { monthKey } from '@/lib/dates';

/**
 * Чистый капитал и история денег по месяцам (без React и без базы).
 *
 * Чистый капитал = деньги в кошельках (все, включая накопления) + мне должны − я должен. Долги берутся по остаткам (computeDebtState).
 * История — ТОЛЬКО по кошелькам: сумма долга хранится без истории (при «добавить ещё» и правке она просто меняется), поэтому прошлые
 * значения долговой части честно не восстановить. Деньги в кошельках в прошлом считаются обратным ходом от сегодняшнего итога
 * (как график «14 дней» на главной) по снимкам сумм в основной валюте.
 */

export interface NetDebt {
  direction: DebtDirection;
  currency: CurrencyCode;
  /** Остаток долга в валюте долга. */
  remainingMinor: Minor;
}

export interface MissingRate {
  currency: CurrencyCode;
  /** Сумма в этой валюте, которая НЕ вошла в итог. */
  amountMinor: Minor;
  where: 'wallets' | 'owed' | 'owe';
}

export interface NetWorth {
  /** Деньги в кошельках в основной валюте (только валюты с известным курсом). */
  walletsMinor: Minor;
  /** Сколько мне должны (в основной валюте). */
  owedToMeMinor: Minor;
  /** Сколько должен я (в основной валюте, положительное число). */
  iOweMinor: Minor;
  /** walletsMinor + owedToMeMinor − iOweMinor. */
  netMinor: Minor;
  /** Часть сумм пересчитана по курсу. */
  approximate: boolean;
  /** Что не вошло в итог из-за отсутствия курса. */
  missing: MissingRate[];
}

export interface NetWorthArgs {
  /** Итог по кошелькам (computeHomeTotal). */
  wallets: Pick<HomeTotal, 'totalMinor' | 'approximate' | 'missing'>;
  /** Открытые долги с остатком > 0 (закрытые, архивные и погашенные вызывающий отфильтровал). */
  debts: readonly NetDebt[];
  base: CurrencyCode;
  getRate: (from: CurrencyCode, to: CurrencyCode) => number | null;
}

/** Бросает RangeError, если суммы не помещаются в безопасное целое. */
export function computeNetWorth({ wallets, debts, base, getRate }: NetWorthArgs): NetWorth {
  const missing: MissingRate[] = wallets.missing.map((m) => ({ currency: m.currency, amountMinor: m.balanceMinor, where: 'wallets' as const }));
  let approximate = wallets.approximate;

  const side = (direction: DebtDirection, where: 'owed' | 'owe'): Minor => {
    const sums = new Map<CurrencyCode, Minor>();
    for (const d of debts) {
      if (d.direction !== direction || d.remainingMinor <= 0) continue;
      sums.set(d.currency, addMinor(sums.get(d.currency) ?? 0, d.remainingMinor));
    }
    const { totalMinor, missing: lost } = totalInBase([...sums].map(([currency, balanceMinor]) => ({ currency, balanceMinor })), base, getRate);
    for (const currency of lost) missing.push({ currency, amountMinor: sums.get(currency) ?? 0, where });
    if ([...sums.keys()].some((c) => c !== base && !lost.includes(c))) approximate = true;
    return totalMinor;
  };

  const owedToMeMinor = side('lent', 'owed');
  const iOweMinor = side('borrowed', 'owe');
  const netMinor = addMinor(addMinor(wallets.totalMinor, owedToMeMinor), -iOweMinor);
  return { walletsMinor: wallets.totalMinor, owedToMeMinor, iOweMinor, netMinor, approximate: approximate || missing.length > 0, missing };
}

export interface MonthBalance {
  /** 'ГГГГ-ММ' */
  month: string;
  /** Деньги в кошельках на конец месяца (для текущего — на сегодня), в основной валюте. */
  balanceMinor: Minor;
}

type DayTx = Parameters<typeof balanceSeries>[0][number];

/**
 * Деньги в кошельках на конец каждого из `months` последних месяцев (старые первыми; текущий месяц — на сегодня).
 * `endMinor` — сегодняшний итог по кошелькам; от него обратным ходом по операциям считаются прошлые значения.
 * Бросает RangeError, если суммы не помещаются в безопасное целое.
 */
export function walletHistory(txs: readonly DayTx[], endMinor: Minor, today: IsoDate, months: number, base: CurrencyCode): MonthBalance[] {
  if (months < 1) return [];
  const first = shiftMonth(monthKey(today), -(months - 1));
  const days = daysBetween(`${first}-01`, today);
  const series = balanceSeries(txs, endMinor, today, days, base); // series[i] — конец дня today − (days − i)
  const out: MonthBalance[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = shiftMonth(monthKey(today), -i);
    const monthEnd = endOfMonth(`${month}-01`);
    const date = monthEnd < today ? monthEnd : today;
    const balanceMinor = series[days - daysBetween(date, today)];
    if (balanceMinor === undefined) throw new RangeError(`Нет значения на ${date}`);
    out.push({ month, balanceMinor });
  }
  return out;
}

