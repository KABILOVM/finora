import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { summarizeDay, summarizeMonth, uuidV5, useStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeDebtState, debtPlanStop } from '@/domain/debts';
import {
  computeDailyForecast,
  daysBetween,
  floorDiv,
  forecastLookaheadEnd,
  isSavingsInflowRule,
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
import { addDays } from '@/lib/dates';
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
  // создания правила (recurring/plan.ts). Правка правила их не отменяет — так же, как «Просроченные» на экране платежей
  // (там, в отличие от прогноза, видны и даты до создания правила).
  let rules: ForecastRule[] = ruleRows
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

    // План по долгу, который стоит (долг погашен, закрыт, в архиве или удалён), денег больше не тратит — как в «Предстоящих»
    const debtRowById = new Map(debtRows.map((d) => [d.id, d] as const));
    const remainingById = new Map(debts.map((d) => [d.id, d.remainingMinor] as const));
    rules = rules.filter((r) => {
      if (r.debtId === null) return true;
      const left = remainingById.get(r.debtId);
      return debtPlanStop(r, debtRowById.get(r.debtId), left === undefined ? null : { remainingMinor: left }) === null;
    });

    const month = summarizeMonth(txs, today.slice(0, 7), base);
    const isScheduled = (t: LocalRow<Transaction>): boolean => t.recurringRuleId !== null && t.recurringRuleId !== undefined;
    const spendableKind = (walletId: string | null | undefined): boolean =>
      SPENDABLE_KINDS.includes(walletById.get(walletId ?? '')?.kind ?? 'savings');
    // Операция по регулярному платежу, которую прогноз до проведения уже вычитал как обязательную: расход, перевод в накопления
    // и комиссия перевода между своими обычными кошельками.
    const preCounted = (t: LocalRow<Transaction>): boolean => isScheduled(t) && t.kind !== 'income';
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
            // как «потрачено за месяц» (все кошельки), но без проведённых регулярных расходов и комиссий: до проведения прогноз уже
            // отложил их из лимита
            spentTodayMinor: summarizeDay(
              txs.filter((t) => t.occurredOn === today && !preCounted(t)),
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
  // Доход (или перевод с накоплений) по правилу внесли обычной операцией, а не «Провести»: деньги уже в остатке — второй раз
  // их не ждём. Пары «плановая дата ± 3 дня — операция» подбираются по всем правилам сразу: сначала ближе по дате, затем по сумме,
  // затем более крупное правило; каждая операция и каждая дата — один раз. В тот же день достаточно половины плановой суммы
  // (пришло меньше — остального не ждём), в другой день — не меньше 90 %, чтобы подарок накануне не «закрыл» зарплату.
  // Прошлые даты тоже участвуют: операция, пришедшая под них, не закроет другое правило. Возвраты по долгам так не закрываются.
  const NEAR_DAYS = 3;
  const walletsById = new Map(walletRows.map((w) => [w.id, w] as const));
  const matchable = rules.filter(
    (r) => (r.kind === 'income' && r.debtId === null) || isSavingsInflowRule(r, walletsById),
  );
  const entries = txs.filter(
    (t) =>
      t.deletedAt === null &&
      (t.recurringRuleId === null || t.recurringRuleId === undefined) &&
      (t.debtId === null || t.debtId === undefined) &&
      (t.kind === 'income' || t.kind === 'transfer') &&
      t.occurredOn >= addDays(today, -NEAR_DAYS) &&
      t.occurredOn <= addDays(today, NEAR_DAYS),
  );
  const pairs: { key: string; tx: string; gap: number; fit: number; plan: number; date: IsoDate }[] = [];
  for (const r of matchable) {
    for (const d of occurrencesBetween(r, addDays(today, -NEAR_DAYS), addDays(today, NEAR_DAYS))) {
      const key = occurrenceKey(r.id, d);
      if (doneOccurrences.has(key)) continue;
      for (const t of entries) {
        if (t.kind !== r.kind || t.walletId !== r.walletId || (r.kind === 'transfer' && t.toWalletId !== r.toWalletId)) continue;
        const gap = Math.abs(daysBetween(d, t.occurredOn));
        if (gap > NEAR_DAYS || t.amountMinor * (gap === 0 ? 2 : 10) < r.amountMinor * (gap === 0 ? 1 : 9)) continue;
        pairs.push({ key, tx: t.id, gap, fit: Math.abs(t.amountMinor - r.amountMinor) / r.amountMinor, plan: r.amountMinor, date: d });
      }
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.fit - b.fit || b.plan - a.plan || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const usedTx = new Set<string>();
  for (const p of pairs) {
    if (usedTx.has(p.tx) || doneOccurrences.has(p.key)) continue;
    usedTx.add(p.tx);
    doneOccurrences.add(p.key);
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
