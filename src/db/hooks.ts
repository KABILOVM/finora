import { useLiveQuery } from 'dexie-react-hooks';
import { computeBalances } from '@/domain/balances';
import { computeDebtState, type DebtPlanStop, type DebtState } from '@/domain/debts';
import { upcomingOccurrences, type UpcomingStatus } from '@/domain/schedule';
import type {
  Budget,
  Category,
  CategoryKind,
  Debt,
  IsoDate,
  LocalRow,
  Minor,
  RecurringRule,
  Settings,
  ShoppingItem,
  Transaction,
  UUID,
  Wallet,
} from '@/domain/types';
import { todayLocal } from '@/lib/dates';
import { stoppedDebtPlans } from './debtPlans';
import { uuidV5 } from './ids';
import { filterTransactions, summarizeMonth, type MonthSummary, type TxFilter } from './queries';
import { sortByOrderThenName } from './sort';
import { useStore } from './storeContext';

/**
 * Живые запросы к локальной базе: экран сам обновляется после любой записи (в том числе из другой вкладки
 * и после загрузки с сервера). Пока данные грузятся, хук возвращает undefined.
 */

/** Кошельки по порядку (sortOrder, затем название по-русски). Архивные — только с includeArchived. */
export function useWallets(opts: { includeArchived?: boolean } = {}): LocalRow<Wallet>[] | undefined {
  const store = useStore();
  const includeArchived = opts.includeArchived === true;
  return useLiveQuery(async () => {
    const rows = await store.db.wallets.toArray();
    return sortByOrderThenName(rows.filter((w) => w.deletedAt === null && (includeArchived || w.archivedAt === null)));
  }, [store, includeArchived]);
}

/**
 * Категории по порядку, при желании только одного вида. Архивные скрыты; чтобы показать название категории
 * в старой операции, передайте { includeArchived: true }.
 */
export function useCategories(
  kind?: CategoryKind,
  opts: { includeArchived?: boolean } = {},
): LocalRow<Category>[] | undefined {
  const store = useStore();
  const includeArchived = opts.includeArchived === true;
  return useLiveQuery(async () => {
    const rows = await store.db.categories.toArray();
    return sortByOrderThenName(
      rows.filter(
        (c) => c.deletedAt === null && (includeArchived || c.archivedAt === null) && (kind === undefined || c.kind === kind),
      ),
    );
  }, [store, kind, includeArchived]);
}

/** Операции по фильтру, новые сверху. limit — сколько первых вернуть. Удалённые не показываются. */
export function useTransactions(
  filter: TxFilter = {},
  opts: { limit?: number } = {},
): LocalRow<Transaction>[] | undefined {
  const store = useStore();
  const { limit } = opts;
  // null («без категории») и undefined («любая») — разные фильтры, поэтому undefined в ключе заменён меткой
  const part = (v: unknown) => (v === undefined ? '\u2205' : v);
  const key = JSON.stringify(
    [filter.from, filter.to, filter.walletId, filter.categoryId, filter.categoryIds, filter.kind, filter.search, filter.debtId, limit].map(part),
  );
  return useLiveQuery(async () => {
    // период берём по индексу даты, остальное — чистым фильтром
    const rows = await store.db.transactions
      .where('occurredOn')
      .between(filter.from ?? '', filter.to ?? '￿', true, true)
      .toArray();
    const out = filterTransactions(rows, filter);
    return typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? out.slice(0, limit) : out;
  }, [store, key]);
}

/**
 * Есть ли хоть одна неудалённая операция. undefined — ещё считается. Отдельный запрос вместо useTransactions({}, { limit: 1 }):
 * тот читает и сортирует ВСЕ операции, а здесь остановка на первой подходящей.
 */
export function useHasTransactions(): boolean | undefined {
  const store = useStore();
  return useLiveQuery(async () => (await store.db.transactions.filter((t) => t.deletedAt === null).first()) !== undefined, [store]);
}

/** Что показать человеку, когда суммы не помещаются в расчёт (см. useBalancesState). */
export const BALANCES_OVERFLOW_MESSAGE = 'Сумма слишком большая, проверьте данные';

/**
 * Итог расчёта остатков: либо остатки, либо понятный признак ошибки. Не бросает: переполнение (RangeError из
 * computeBalances) становится значением, иначе useLiveQuery пробросил бы его в отрисовку и уронил бы экран.
 */
export type BalancesState =
  | { ok: true; balances: Map<UUID, Minor> }
  | { ok: false; error: 'overflow'; message: typeof BALANCES_OVERFLOW_MESSAGE };

/**
 * Остатки или признак ошибки. undefined — ещё считается. Экран при ok === false показывает `message`
 * («Сумма слишком большая, проверьте данные») вместо цифр: показывать нули или половину сумм нельзя, это деньги.
 */
export function useBalancesState(): BalancesState | undefined {
  const store = useStore();
  return useLiveQuery(async (): Promise<BalancesState> => {
    const [wallets, txs] = await Promise.all([store.db.wallets.toArray(), store.db.transactions.toArray()]);
    try {
      return {
        ok: true,
        balances: computeBalances(
          wallets.filter((w) => w.deletedAt === null),
          txs,
        ),
      };
    } catch (e) {
      if (e instanceof RangeError) return { ok: false, error: 'overflow', message: BALANCES_OVERFLOW_MESSAGE };
      throw e; // любая другая ошибка — настоящий сбой, его скрывать нельзя
    }
  }, [store]);
}

/**
 * Текущие остатки всех кошельков (включая архивные): начальный остаток ± живые операции. Нигде не хранятся.
 * Прежний API: Map или undefined. При переполнении сумм экран НЕ падает, а остаётся в состоянии «считается» (undefined):
 * чтобы показать причину, используйте useBalancesState().
 */
export function useBalances(): Map<UUID, Minor> | undefined {
  const state = useBalancesState();
  return state?.ok ? state.balances : undefined;
}

/** Настройки пользователя. undefined — загружаются; null — ещё не созданы (до первой загрузки/затравки). */
export function useSettings(): LocalRow<Settings> | null | undefined {
  const store = useStore();
  return useLiveQuery(() => store.settings.get(), [store]);
}

/**
 * Итоги месяца ('ГГГГ-ММ') в базовой валюте. undefined — считается; null — настроек ещё нет,
 * базовая валюта неизвестна. Подробности — в queries.summarizeMonth.
 */
export function useMonthSummary(month: string): MonthSummary | null | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const rows = await store.db.transactions.where('occurredOn').between(`${month}-01`, `${month}-31`, true, true).toArray();
    return summarizeMonth(rows, month, settings.baseCurrency);
  }, [store, month]);
}

// ───────────────────────── бюджеты, долги, регулярные платежи ─────────────────────────

/** Бюджеты: общий лимит первым, затем по времени создания. Архивные — только с includeArchived. Удалённые не показываются. */
export function useBudgets(opts: { includeArchived?: boolean } = {}): LocalRow<Budget>[] | undefined {
  const store = useStore();
  const includeArchived = opts.includeArchived === true;
  return useLiveQuery(async () => {
    const rows = await store.db.budgets.toArray();
    return rows
      .filter((b) => b.deletedAt === null && (includeArchived || b.archivedAt === null))
      .sort((a, b) => {
        if ((a.categoryId === null) !== (b.categoryId === null)) return a.categoryId === null ? -1 : 1;
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }, [store, includeArchived]);
}

/**
 * Долги: незакрытые первыми, затем по сроку возврата (без срока — в конце), затем новые сверху.
 * Архивные скрыты (includeArchived), закрытые показываются (includeClosed: false их скрывает). Удалённые не показываются.
 */
export function useDebts(opts: { includeArchived?: boolean; includeClosed?: boolean } = {}): LocalRow<Debt>[] | undefined {
  const store = useStore();
  const includeArchived = opts.includeArchived === true;
  const includeClosed = opts.includeClosed !== false;
  return useLiveQuery(async () => {
    const rows = await store.db.debts.toArray();
    return rows
      .filter((d) => d.deletedAt === null && (includeArchived || d.archivedAt === null) && (includeClosed || d.closedAt === null))
      .sort((a, b) => {
        if ((a.closedAt === null) !== (b.closedAt === null)) return a.closedAt === null ? -1 : 1;
        if (a.dueOn !== b.dueOn) return a.dueOn === null ? 1 : b.dueOn === null ? -1 : a.dueOn < b.dueOn ? -1 : 1;
        if (a.openedOn !== b.openedOn) return a.openedOn < b.openedOn ? 1 : -1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }, [store, includeArchived, includeClosed]);
}

/** Регулярные платежи по порядку начала расписания. Архивные — только с includeArchived. Удалённые не показываются. */
export function useRecurringRules(opts: { includeArchived?: boolean } = {}): LocalRow<RecurringRule>[] | undefined {
  const store = useStore();
  const includeArchived = opts.includeArchived === true;
  return useLiveQuery(async () => {
    const rows = await store.db.recurring_rules.toArray();
    return rows
      .filter((r) => r.deletedAt === null && (includeArchived || r.archivedAt === null))
      .sort((a, b) => {
        if (a.startOn !== b.startOn) return a.startOn < b.startOn ? -1 : 1;
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }, [store, includeArchived]);
}

/** Все живые позиции списка покупок (и купленные: из них складывается память цен), по порядку добавления. undefined — читается. */
export function useShoppingItems(): LocalRow<ShoppingItem>[] | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const rows = await store.db.shopping_items.toArray();
    return rows
      .filter((i) => i.deletedAt === null)
      .sort((a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1));
  }, [store]);
}

/** Чек расхода: позиции, вошедшие в покупку (по порядку добавления). Пусто — расход не из списка покупок. undefined — читается. */
export function useReceipt(txId: UUID | null | undefined): LocalRow<ShoppingItem>[] | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    if (!txId) return [];
    const rows = await store.db.shopping_items.where('transactionId').equals(txId).toArray();
    return rows
      .filter((i) => i.deletedAt === null)
      .sort((a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1));
  }, [store, txId]);
}

export const DEBT_OVERFLOW_MESSAGE = 'Суммы по долгу слишком большие, проверьте данные';

/** Состояние долга для экрана: либо долг с остатком и платежами, либо понятная причина, почему показать нечего. */
export type DebtView =
  | { ok: true; debt: LocalRow<Debt>; state: DebtState }
  | { ok: false; error: 'not-found'; message: string }
  | { ok: false; error: 'overflow'; message: typeof DEBT_OVERFLOW_MESSAGE };

/**
 * Остаток и платежи долга (считаются из операций с debtId, см. domain/debts.ts). undefined — ещё считается; debtId null — «не найден».
 * Не бросает: переполнение сумм становится значением (error: 'overflow'), как у useBalancesState.
 */
export function useDebtView(debtId: UUID | null): DebtView | undefined {
  const store = useStore();
  return useLiveQuery(async (): Promise<DebtView> => {
    const debt = debtId === null ? undefined : await store.db.debts.get(debtId);
    if (!debt || debt.deletedAt !== null) return { ok: false, error: 'not-found', message: 'Долг не найден' };
    const [txs, wallets] = await Promise.all([
      store.db.transactions.where('debtId').equals(debt.id).toArray(),
      store.db.wallets.toArray(),
    ]);
    try {
      return { ok: true, debt, state: computeDebtState(debt, txs, new Map(wallets.map((w) => [w.id, w]))) };
    } catch (e) {
      if (e instanceof RangeError) return { ok: false, error: 'overflow', message: DEBT_OVERFLOW_MESSAGE };
      throw e; // любая другая ошибка — настоящий сбой, его скрывать нельзя
    }
  }, [store, debtId]);
}

/** Остаток и платежи долга; null — долга нет (или суммы не помещаются в расчёт: причину даёт useDebtView). undefined — считается. */
export function useDebtState(debtId: UUID): { debt: LocalRow<Debt>; state: DebtState } | null | undefined {
  const view = useDebtView(debtId);
  if (view === undefined) return undefined;
  return view.ok ? { debt: view.debt, state: view.state } : null;
}

export interface UpcomingItem {
  rule: LocalRow<RecurringRule>;
  date: IsoDate;
  /** due — сегодня, overdue — раньше сегодняшнего дня, upcoming — позже. */
  status: UpcomingStatus;
  /** За эту дату уже есть операция: проведённая или «пропущенная» (удалённая) — второй раз её создавать не надо. */
  alreadyExists: boolean;
}

/**
 * Предстоящие и просроченные платежи по живым (не архивным) правилам: сегодня, ближайшие daysAhead дней и просроченные за
 * последние lookbackDays (по умолчанию 366) дней. Планы по долгам, которые стоят (долг погашен, закрыт, в архиве или удалён —
 * см. debtPlanStop), в список не попадают. Проведённые и пропущенные тоже в списке — с alreadyExists: true; экран решает,
 * показывать ли их. Наличие определяется по детерминированному id операции v5(правило, дата), поэтому правка даты проведённой
 * операции не создаёт «призрачный» долг. today — для тестов; по умолчанию сегодняшняя дата устройства. undefined — считается.
 */
export function useUpcoming(
  daysAhead: number,
  opts: { today?: IsoDate; lookbackDays?: number } = {},
): UpcomingItem[] | undefined {
  const store = useStore();
  const today = opts.today ?? todayLocal();
  const lookbackDays = opts.lookbackDays;
  return useLiveQuery(async () => {
    const live = (await store.db.recurring_rules.toArray()).filter((r) => r.deletedAt === null && r.archivedAt === null);
    const stopped = await stoppedDebtPlans(store.db, live);
    const rules = live.filter((r) => !stopped.has(r.id));
    if (rules.length === 0) return [];
    const have = new Set<string>();
    for (const r of rules) {
      for (const k of await store.db.transactions.where('recurringRuleId').equals(r.id).primaryKeys()) have.add(k);
    }
    // после этой строки обращений к базе нет: ожидание crypto вне транзакции Dexie безопасно
    const entries = upcomingOccurrences(rules, today, daysAhead, lookbackDays);
    return Promise.all(
      entries.map(async (e): Promise<UpcomingItem> => ({
        rule: e.rule,
        date: e.date,
        status: e.status,
        alreadyExists: have.has(await uuidV5(e.rule.id, e.date)),
      })),
    );
  }, [store, daysAhead, today, lookbackDays]);
}

/** Планы платежей по долгам, которые стоят: id правила → причина (см. debtPlanStop). undefined — считается. */
export function useStoppedDebtPlans(): Map<UUID, DebtPlanStop> | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const rules = (await store.db.recurring_rules.toArray()).filter((r) => r.deletedAt === null && r.debtId !== null);
    return stoppedDebtPlans(store.db, rules);
  }, [store]);
}
