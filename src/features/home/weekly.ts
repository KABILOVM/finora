import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeDay, useStore } from '@/db';
import { percentOf } from '@/domain/budgetLevels';
import type { CurrencyCode, IsoDate, Minor, UUID } from '@/domain/types';
import { isSpend, type AnomalyTx } from '@/features/analytics/anomalies';
import { weekdayOf } from '@/features/analytics/analytics';
import { longDate } from '@/features/budgets/budgetText';
import { addDays } from '@/lib/dates';

/**
 * «Итоги недели»: на «Главной» в начале новой недели — карточка про прошедшую (понедельник–воскресенье): сколько потрачено и
 * как это соотносится с неделей раньше, на что ушло больше всего, самая крупная трата. Считается из операций на устройстве, ничего не
 * отправляет и не пишет. Правила учёта те же, что у «Итогов месяца»: по снимкам в основной валюте, без переводов, долгов и корректировок.
 */

/** Сколько первых дней недели показываем карточку: понедельник — четверг (кто открыл приложение позже, итогов уже не увидит). */
export const WEEKLY_SHOW_DAYS = 4;

/** Операция для итогов недели: всё, что нужно и итогам дня (db/queries.ts), и поиску самой крупной траты. */
export type WeekTx = AnomalyTx & Parameters<typeof summarizeDay>[0][number];

export interface WeekSummary {
  /** Понедельник прошедшей недели: по нему «Скрыть» помнит, какую неделю убрали. */
  from: IsoDate;
  /** Воскресенье прошедшей недели. */
  to: IsoDate;
  expenseMinor: Minor;
  /** Расходы недели до неё (понедельник–воскресенье). */
  previousExpenseMinor: Minor;
  incomeMinor: Minor;
  /** Категория с самыми большими расходами; null — расходов не было. */
  top: { categoryId: UUID | null; totalMinor: Minor; sharePercent: number } | null;
  /** Самая крупная трата недели (по снимку в основной валюте); null — расходов не было. */
  biggest: { id: UUID; categoryId: UUID | null; note: string; amountMinor: Minor; occurredOn: IsoDate } | null;
}

/** Понедельник недели, в которую попадает дата. */
export const weekStart = (date: IsoDate): IsoDate => addDays(date, -weekdayOf(date));

/** Показывать ли карточку сегодня: первые дни недели. */
export const inShowWindow = (today: IsoDate): boolean => weekdayOf(today) < WEEKLY_SHOW_DAYS;

/** «5–11 октября» или «28 сентября – 4 октября». */
export function weekRangeText(from: IsoDate, to: IsoDate): string {
  const a = longDate(from);
  const b = longDate(to);
  const [dayA, monthA] = [a.split(' ')[0], a.split(' ').slice(1).join(' ')];
  const monthB = b.split(' ').slice(1).join(' ');
  return monthA === monthB ? `${dayA}–${b}` : `${a} – ${b}`;
}

/**
 * Итоги прошедшей недели; null — карточка не нужна: сегодня уже не первые дни недели или за неделю не было ни расходов, ни доходов.
 * `txs` должны покрывать две прошедшие недели. Бросает RangeError, если суммы не помещаются в безопасное целое.
 */
export function weeklySummary(txs: readonly WeekTx[], today: IsoDate, base: CurrencyCode): WeekSummary | null {
  if (!inShowWindow(today)) return null;
  const thisMonday = weekStart(today);
  const from = addDays(thisMonday, -7);
  const to = addDays(thisMonday, -1);
  const prevFrom = addDays(from, -7);
  const prevTo = addDays(from, -1);
  const inRange = (t: WeekTx, a: IsoDate, b: IsoDate) => t.occurredOn >= a && t.occurredOn <= b;
  const week = txs.filter((t) => inRange(t, from, to));
  const s = summarizeDay(week, base);
  if (s.expenseMinor <= 0 && s.incomeMinor <= 0) return null;
  const previous = summarizeDay(
    txs.filter((t) => inRange(t, prevFrom, prevTo)),
    base,
  );
  const topRow = s.byCategory.find((c) => c.kind !== 'fee' && c.totalMinor > 0) ?? null;
  let biggest: WeekSummary['biggest'] = null;
  for (const t of week) {
    if (!isSpend(t, base) || t.baseAmountMinor <= 0) continue;
    if (biggest === null || t.baseAmountMinor > biggest.amountMinor || (t.baseAmountMinor === biggest.amountMinor && t.id < biggest.id)) {
      biggest = { id: t.id, categoryId: t.categoryId, note: t.note.trim(), amountMinor: t.baseAmountMinor, occurredOn: t.occurredOn };
    }
  }
  return {
    from,
    to,
    expenseMinor: s.expenseMinor,
    previousExpenseMinor: previous.expenseMinor,
    incomeMinor: s.incomeMinor,
    top: topRow ? { categoryId: topRow.categoryId, totalMinor: topRow.totalMinor, sharePercent: percentOf(topRow.totalMinor, s.expenseMinor) } : null,
    biggest,
  };
}

export interface WeeklyState {
  base: CurrencyCode;
  summary: WeekSummary | null;
}

/** undefined — читается; null — настроек ещё нет (или сумм не сложить: карточки нет). Живой запрос: внесли операцию — цифры обновились. */
export function useWeeklySummary(today: IsoDate): WeeklyState | null | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    if (!inShowWindow(today)) return { summary: null, base: null };
    const settings = await store.settings.get();
    if (!settings) return null;
    const from = addDays(weekStart(today), -14);
    const rows = await store.db.transactions.where('occurredOn').between(from, addDays(weekStart(today), -1), true, true).toArray();
    try {
      return { base: settings.baseCurrency, summary: weeklySummary(rows, today, settings.baseCurrency) };
    } catch (e) {
      if (e instanceof RangeError) return { base: settings.baseCurrency, summary: null };
      throw e;
    }
  }, [store, today]) as WeeklyState | null | undefined;
}
