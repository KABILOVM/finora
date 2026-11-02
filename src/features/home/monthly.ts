import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeMonth, useStore } from '@/db';
import { percentOf } from '@/domain/budgetLevels';
import { floorDiv } from '@/domain/forecast';
import type { CurrencyCode, IsoDate, Minor, UUID } from '@/domain/types';
import { isSpend, type AnomalyTx } from '@/features/analytics/anomalies';
import { shiftMonth } from '@/features/transactions/txFilters';
import { addDays, monthKey } from '@/lib/dates';
import { inMonthlyWindow } from './monthlyWindow';

/**
 * «Итоги месяца»: на «Главной» в первые дни нового месяца — карточка про прошедший: сколько потрачено и как это соотносится с месяцем
 * раньше, на что ушло больше всего, самая крупная трата, сколько получено. Считается из операций на устройстве, ничего не отправляет и
 * не пишет. Правила учёта те же, что у «Итогов месяца» в «Аналитике» (db/queries.ts summarizeMonth): по снимкам в основной валюте,
 * без переводов, долгов и корректировок остатка. Для недели то же самое делает weekly.ts.
 */

/** Операция для итогов месяца: всё, что нужно и итогам месяца (db/queries.ts), и поиску самой крупной траты. */
export type MonthTx = AnomalyTx & Parameters<typeof summarizeMonth>[0][number];

export interface MonthRecap {
  /** Прошедший месяц 'ГГГГ-ММ': по нему «Скрыть» помнит, какой месяц убрали, а «Подробнее» открывает «Аналитику». */
  month: string;
  expenseMinor: Minor;
  /** Расходы месяца до него. */
  previousExpenseMinor: Minor;
  incomeMinor: Minor;
  /** Доходы минус расходы месяца. */
  netMinor: Minor;
  /** Сколько в среднем уходило в день (расходы ÷ число дней месяца, вниз). */
  perDayMinor: Minor;
  /** Категория с самыми большими расходами; null — расходов не было. */
  top: { categoryId: UUID | null; totalMinor: Minor; sharePercent: number } | null;
  /** Самая крупная трата месяца (по снимку в основной валюте); null — расходов не было. */
  biggest: { id: UUID; categoryId: UUID | null; note: string; amountMinor: Minor; occurredOn: IsoDate } | null;
}

/** Первый и последний день прошедшего месяца относительно сегодняшнего дня. */
export function lastMonthRange(today: IsoDate): { month: string; from: IsoDate; to: IsoDate } {
  const to = addDays(`${monthKey(today)}-01`, -1);
  const month = monthKey(to);
  return { month, from: `${month}-01`, to };
}

/**
 * Итоги прошедшего месяца; null — карточка не нужна: сегодня уже не первые дни месяца или за месяц не было ни расходов, ни доходов.
 * `txs` должны покрывать два прошедших месяца. Бросает RangeError, если суммы не помещаются в безопасное целое.
 */
export function monthRecap(txs: readonly MonthTx[], today: IsoDate, base: CurrencyCode): MonthRecap | null {
  if (!inMonthlyWindow(today)) return null;
  const { month, to } = lastMonthRange(today);
  const s = summarizeMonth(txs, month, base);
  if (s.expenseMinor <= 0 && s.incomeMinor <= 0) return null;
  const previous = summarizeMonth(txs, shiftMonth(month, -1), base);
  const topRow = s.byCategory.find((c) => c.kind !== 'fee' && c.totalMinor > 0) ?? null;
  let biggest: MonthRecap['biggest'] = null;
  for (const t of txs) {
    if (monthKey(t.occurredOn) !== month) continue;
    if (!isSpend(t, base) || t.baseAmountMinor <= 0) continue;
    if (biggest === null || t.baseAmountMinor > biggest.amountMinor || (t.baseAmountMinor === biggest.amountMinor && t.id < biggest.id)) {
      biggest = { id: t.id, categoryId: t.categoryId, note: t.note.trim(), amountMinor: t.baseAmountMinor, occurredOn: t.occurredOn };
    }
  }
  const netMinor = s.incomeMinor - s.expenseMinor;
  if (!Number.isSafeInteger(netMinor)) throw new RangeError('Сумма не помещается в безопасное целое');
  return {
    month,
    expenseMinor: s.expenseMinor,
    previousExpenseMinor: previous.expenseMinor,
    incomeMinor: s.incomeMinor,
    netMinor,
    perDayMinor: floorDiv(s.expenseMinor, Number(to.slice(8, 10))),
    top: topRow ? { categoryId: topRow.categoryId, totalMinor: topRow.totalMinor, sharePercent: percentOf(topRow.totalMinor, s.expenseMinor) } : null,
    biggest,
  };
}

export interface MonthlyState {
  base: CurrencyCode;
  recap: MonthRecap | null;
}

/** undefined — читается; null — настроек ещё нет. Сумм не сложить — карточки нет. Живой запрос: внесли операцию — цифры обновились. */
export function useMonthRecap(today: IsoDate): MonthlyState | null | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    if (!inMonthlyWindow(today)) return { recap: null, base: null };
    const settings = await store.settings.get();
    if (!settings) return null;
    const { month, to } = lastMonthRange(today);
    const from: IsoDate = `${shiftMonth(month, -1)}-01`;
    const rows = await store.db.transactions.where('occurredOn').between(from, to, true, true).toArray();
    try {
      return { base: settings.baseCurrency, recap: monthRecap(rows, today, settings.baseCurrency) };
    } catch (e) {
      if (e instanceof RangeError) return { base: settings.baseCurrency, recap: null };
      throw e;
    }
  }, [store, today]) as MonthlyState | null | undefined;
}
