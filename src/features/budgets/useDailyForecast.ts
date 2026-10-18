import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { summarizeDay, summarizeMonth, uuidV5, useStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import {
  computeDailyForecast,
  floorDiv,
  forecastLookaheadEnd,
  isSpendableWallet,
  occurrenceKey,
  SPENDABLE_KINDS,
  usualSpendWindow,
  type DailyForecast,
  type ForecastDebt,
  type ForecastInput,
  type ForecastRule,
} from '@/domain/forecast';
import { occurrencesBetween } from '@/domain/schedule';
import type { IsoDate, LocalRow, Transaction, UUID } from '@/domain/types';
import { useRates } from '@/rates/hooks';
import { FORECAST_OVERDUE_MAX_AGE_DAYS, historyFrom, localDateOf } from '@/recurring/plan';
import { useToday } from '@/recurring/useToday';

export type ForecastData = Omit<ForecastInput, 'getRate'>;
export type LoadedForecast = { overflow: true } | { overflow: false; data: ForecastData; labels: ReadonlyMap<UUID, string> };

/**
 * Читает из локальной базы всё, что нужно прогнозу, ОДНИМ чтением (иначе экран на миг показал бы цифры из разных моментов).
 * null — настройки ещё не созданы. После последнего обращения к базе идёт только ожидание crypto (v5-идентификаторы) —
 * вне транзакции Dexie это безопасно (так же сделано в useUpcoming).
 * Проведённые и пропущенные даты правил собираются от их просроченных дат до `horizonEnd` — он должен покрывать всё, на что
 * смотрит расчёт (по умолчанию — окно прогноза «в день»).
 */
export async function loadForecastData(store: Store, today: IsoDate, horizonEnd: IsoDate = forecastLookaheadEnd(today)): Promise<LoadedForecast | null> {
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
  // Прошлые даты правила, не проведённые и не пропущенные, прогноз вычитает как просроченные — но не старше месяца и не раньше
  // создания правила (recurring/plan.ts). Правка правила их не отменяет: «Просроченные» на экране платежей тоже их показывают.
  const rules: ForecastRule[] = ruleRows
    .filter((r) => r.deletedAt === null && r.archivedAt === null)
    .map((r) => ({ ...r, overdueFrom: historyFrom(r, today, FORECAST_OVERDUE_MAX_AGE_DAYS, localDateOf, { sinceEdit: false }) }));

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

    const month = summarizeMonth(txs, today.slice(0, 7), base);
    const isScheduled = (t: LocalRow<Transaction>): boolean => t.recurringRuleId !== null && t.recurringRuleId !== undefined;
    const spendableKind = (walletId: string | null | undefined): boolean =>
      SPENDABLE_KINDS.includes(walletById.get(walletId ?? '')?.kind ?? 'savings');
    // Операция по регулярному платежу, которую прогноз до проведения уже вычитал как обязательную: расход и перевод в накопления.
    // Комиссия регулярного перевода между своими обычными кошельками обязательной не была — это обычная трата.
    const preCounted = (t: LocalRow<Transaction>): boolean => isScheduled(t) && (t.kind !== 'transfer' || !spendableKind(t.toWalletId));
    // «Сегодня потрачено» — только из тех кошельков, чьи деньги входят в «деньги на руках»: трата с накопления их не уменьшила
    // и в «можно было потратить сегодня» (деньги на руках + потрачено сегодня) попасть не должна. Без того, что прогноз уже
    // вычитал как обязательное: проведённая аренда не делает день «перерасходом».
    const moneyWalletIds = new Set(wallets.filter(isSpendableWallet).map((w) => w.id));
    const spentToday = summarizeDay(
      txs.filter((t) => t.occurredOn === today && moneyWalletIds.has(t.walletId) && !preCounted(t)),
      base,
    ).expenseMinor;
    // «Обычно тратите» — повседневные траты: без регулярных платежей (их прогноз и календарь вычитают отдельно) и без трат
    // с накоплений. По виду кошелька, а не по архиву: траты с карты, которую потом убрали в архив, остаются показательными.
    const isFreeSpend = (t: LocalRow<Transaction>): boolean => !preCounted(t) && spendableKind(t.walletId);
    const window = usualSpendWindow(firstOp, today);
    const usualPerDayMinor = window
      ? floorDiv(
          summarizeDay(
            txs.filter((t) => t.occurredOn >= window.from && t.occurredOn <= window.to && isFreeSpend(t)),
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
        ? {
            limitMinor: total.amountMinor,
            currency: total.currency,
            spentMonthMinor: month.expenseMinor,
            // как «потрачено за месяц» (все кошельки), но без проведённых регулярных расходов: до проведения прогноз уже отложил их из лимита
            spentTodayMinor: summarizeDay(
              txs.filter((t) => t.occurredOn === today && !(isScheduled(t) && t.kind === 'expense')),
              base,
            ).expenseMinor,
            excludedCount: month.excludedCount,
          }
        : null,
    };
  } catch (e) {
    if (e instanceof RangeError) return { overflow: true };
    throw e;
  }

  // Какие даты правил уже проведены или пропущены: id операции = v5(правило, дата).
  const doneOccurrences = new Set<string>();
  for (const r of rules) {
    const from = r.overdueFrom !== null && r.overdueFrom !== undefined && r.overdueFrom < today ? r.overdueFrom : today;
    for (const date of occurrencesBetween(r, from, horizonEnd)) {
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
