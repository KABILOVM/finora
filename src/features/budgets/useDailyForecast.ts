import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { summarizeDay, summarizeMonth, uuidV5, useStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeDebtState, debtPlanStop } from '@/domain/debts';
import {
  computeDailyForecast,
  endOfMonth,
  floorDiv,
  isSpendableWallet,
  occurrenceKey,
  usualSpendWindow,
  type DailyForecast,
  type ForecastDebt,
  type ForecastInput,
} from '@/domain/forecast';
import { occurrencesBetween } from '@/domain/schedule';
import type { IsoDate, LocalRow, Transaction, UUID } from '@/domain/types';
import { useRates } from '@/rates/hooks';
import { useToday } from '@/recurring/useToday';

export type ForecastData = Omit<ForecastInput, 'getRate'>;
export type LoadedForecast = { overflow: true } | { overflow: false; data: ForecastData; labels: ReadonlyMap<UUID, string> };

/**
 * Читает из локальной базы всё, что нужно прогнозу, ОДНИМ чтением (иначе экран на миг показал бы цифры из разных моментов).
 * null — настройки ещё не созданы. После последнего обращения к базе идёт только ожидание crypto (v5-идентификаторы) —
 * вне транзакции Dexie это безопасно (так же сделано в useUpcoming).
 */
export async function loadForecastData(store: Store, today: IsoDate, horizonEnd: IsoDate = endOfMonth(today)): Promise<LoadedForecast | null> {
  const settings = await store.settings.get();
  if (!settings) return null;
  const { db } = store;
  const [walletRows, txs, ruleRows, debtRows, budgetRows, categoryRows] = await Promise.all([
    db.wallets.toArray(),
    db.transactions.toArray(),
    db.recurring_rules.toArray(),
    db.debts.toArray(),
    db.budgets.toArray(),
    db.categories.toArray(),
  ]);
  const base = settings.baseCurrency;
  const wallets = walletRows.filter((w) => w.deletedAt === null);
  let rules = ruleRows.filter((r) => r.deletedAt === null && r.archivedAt === null);

  const byDebt = new Map<string, LocalRow<Transaction>[]>();
  const existingIds = new Set<string>();
  let firstOp: IsoDate | null = null;
  for (const t of txs) {
    if (t.recurringRuleId !== null && t.recurringRuleId !== undefined) existingIds.add(t.id); // проведённые и «пропущенные» (удалённые)
    if (t.deletedAt !== null) continue;
    if (firstOp === null || t.occurredOn < firstOp) firstOp = t.occurredOn;
    if (t.debtId !== null && t.debtId !== undefined) {
      const list = byDebt.get(t.debtId);
      if (list) list.push(t);
      else byDebt.set(t.debtId, [t]);
    }
  }

  let data: Omit<ForecastData, 'doneOccurrences'>;
  try {
    const balances = computeBalances(wallets, txs);
    const walletById = new Map(walletRows.map((w) => [w.id, w] as const));
    // Долги обоих направлений: прогноз «в день» сам берёт только «я должен», календарь по желанию учитывает и «мне должны»
    const debts: ForecastDebt[] = debtRows
      .filter((d) => d.deletedAt === null)
      .map((d) => ({
        id: d.id,
        direction: d.direction,
        currency: d.currency,
        dueOn: d.dueOn,
        remainingMinor: computeDebtState(d, byDebt.get(d.id) ?? [], walletById).remainingMinor,
        closedAt: d.closedAt,
        archivedAt: d.archivedAt,
      }));

    // План по долгу, который стоит (долг погашен, закрыт, в архиве или удалён), денег больше не тратит — как в «Предстоящих»
    const debtRowById = new Map(debtRows.map((d) => [d.id, d] as const));
    const remainingById = new Map(debts.map((d) => [d.id, d.remainingMinor] as const));
    rules = rules.filter((r) => {
      if (r.debtId === null) return true;
      const left = remainingById.get(r.debtId);
      return debtPlanStop(r, debtRowById.get(r.debtId), left === undefined ? null : { remainingMinor: left }) === null;
    });

    const month = summarizeMonth(txs, today.slice(0, 7), base);
    // «Сегодня потрачено» — только из тех кошельков, чьи деньги входят в «деньги на руках»: трата с накопления их не уменьшила
    // и в «можно было потратить сегодня» (деньги на руках + потрачено сегодня) попасть не должна.
    const moneyWalletIds = new Set(wallets.filter(isSpendableWallet).map((w) => w.id));
    const spentToday = summarizeDay(
      txs.filter((t) => t.occurredOn === today && moneyWalletIds.has(t.walletId)),
      base,
    ).expenseMinor;
    const window = usualSpendWindow(firstOp, today);
    const usualPerDayMinor = window
      ? floorDiv(
          summarizeDay(
            txs.filter((t) => t.occurredOn >= window.from && t.occurredOn <= window.to),
            base,
          ).expenseMinor,
          window.days,
        )
      : null;
    const total = budgetRows.find((b) => b.deletedAt === null && b.archivedAt === null && b.categoryId === null);

    data = {
      today,
      base,
      wallets,
      balances,
      rules,
      debts,
      spentTodayMinor: spentToday,
      usualPerDayMinor,
      totalBudget: total
        ? { limitMinor: total.amountMinor, currency: total.currency, spentMonthMinor: month.expenseMinor, excludedCount: month.excludedCount }
        : null,
    };
  } catch (e) {
    if (e instanceof RangeError) return { overflow: true };
    throw e;
  }

  // Какие даты правил уже проведены или пропущены: id операции = v5(правило, дата).
  const doneOccurrences = new Set<string>();
  for (const r of rules) {
    for (const date of occurrencesBetween(r, today, horizonEnd)) {
      if (existingIds.has(await uuidV5(r.id, date))) doneOccurrences.add(occurrenceKey(r.id, date));
    }
  }
  // Подписи для списков (календарь): у правила — заметка или название категории, у долга — с кем.
  const categoryName = new Map(categoryRows.map((c) => [c.id, c.name] as const));
  const labels = new Map<UUID, string>();
  for (const r of ruleRows) {
    const label = r.note.trim() || (r.categoryId !== null ? categoryName.get(r.categoryId) : undefined) || '';
    if (label !== '') labels.set(r.id, label);
  }
  for (const d of debtRows) if (d.deletedAt === null) labels.set(d.id, d.counterparty);
  return { overflow: false, data: { ...data, doneOccurrences }, labels };
}

/**
 * Прогноз «сколько можно тратить в день» для экрана (формула — в domain/forecast.ts). Пересчитывается сам после любой записи
 * в базу, после обновления курсов и при смене даты. undefined — считается (ничего не показываем, а не нули); null — настроек ещё нет.
 */
export function useDailyForecast(): DailyForecast | null | undefined {
  const store = useStore();
  const { getRate } = useRates();
  const today = useToday(); // сама меняется за полночь и при возврате в приложение: «сегодня» не застревает на вчера
  const loaded = useLiveQuery(() => loadForecastData(store, today), [store, today]);
  return useMemo(() => {
    if (loaded === undefined) return undefined;
    if (loaded === null) return null;
    if (loaded.overflow) return { status: 'overflow' } as const;
    return computeDailyForecast({ ...loaded.data, getRate: (from, to) => getRate(from, to)?.rate ?? null });
  }, [loaded, getRate]);
}
