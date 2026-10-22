import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeMonth, useBalances, useStore, useWallets } from '@/db';
import type { CurrencyCode, IsoDate, Minor, UUID, Wallet } from '@/domain/types';
import { useGoals } from '@/features/wallets/useGoals';
import { shiftMonth } from '@/features/transactions/txFilters';
import { monthKey } from '@/lib/dates';

/**
 * «Отложить остаток»: в первые дни месяца, если прошлый месяц закрылся с плюсом (доходы больше расходов), «Главная» предлагает
 * перевести остаток на кошелёк-накопление (цель). Перевод не делается сам: кнопка открывает обычную форму «Новая операция» с готовым
 * переводом — сумму можно поправить. Считается из операций на устройстве.
 */

/** Предлагаем только в первые дни месяца: позже остаток прошлого месяца уже «растворился» в нынешнем. */
export const SAVE_UNTIL_DAY = 7;
/** Остаток должен быть не меньше стольких процентов дохода прошлого месяца: пара копеек откладывать не стоит. */
export const MIN_NET_SHARE_PERCENT = 5;

type WalletLite = Pick<Wallet, 'id' | 'name' | 'kind' | 'currency' | 'archivedAt'>;

export interface RemainderInput {
  today: IsoDate;
  base: CurrencyCode;
  /** Доходы и расходы прошлого месяца в основной валюте. */
  previous: { incomeMinor: Minor; expenseMinor: Minor };
  wallets: readonly WalletLite[];
  balances: ReadonlyMap<UUID, Minor>;
  /** Кошельки-накопления с целью, которая ещё не достигнута, в порядке «сначала самые срочные». */
  openGoalIds: readonly UUID[];
  /** Кошельки-накопления с достигнутой целью: сюда уже не откладываем. */
  reachedGoalIds: ReadonlySet<UUID>;
  /** Кошельки, на которые в этом месяце уже были переводы. */
  transferredTo: ReadonlySet<UUID>;
}

export interface RemainderSuggestion {
  /** Прошлый месяц, 'ГГГГ-ММ': по нему «Не сейчас» помнит отказ. */
  month: string;
  /** Сколько осталось по итогам прошлого месяца. */
  netMinor: Minor;
  /** Сколько предлагаем перевести: остаток, но не больше денег на кошельке-источнике. */
  amountMinor: Minor;
  from: { id: UUID; name: string };
  to: { id: UUID; name: string };
}

/**
 * Что предложить; null — предлагать нечего: не первые дни месяца, прошлый месяц без остатка (или он меньше 5% дохода), нет кошелька-накопления
 * в основной валюте (перевод между валютами здесь не предлагаем), уже откладывали в этом месяце или не из чего (на обычных кошельках пусто).
 * Куда: цель с ближайшим сроком, иначе накопление без цели. Откуда: обычный кошелёк с самым большим остатком той же валюты.
 */
export function remainderSuggestion(i: RemainderInput): RemainderSuggestion | null {
  if (Number(i.today.slice(8, 10)) > SAVE_UNTIL_DAY) return null;
  const net = i.previous.incomeMinor - i.previous.expenseMinor;
  if (!Number.isSafeInteger(net) || net <= 0) return null;
  if (BigInt(net) * 100n < BigInt(i.previous.incomeMinor) * BigInt(MIN_NET_SHARE_PERCENT)) return null;

  const live = i.wallets.filter((w) => w.archivedAt === null && w.currency === i.base);
  const byId = new Map(live.map((w) => [w.id, w] as const));
  const savings = live.filter((w) => w.kind === 'savings' && !i.reachedGoalIds.has(w.id));
  if (savings.length === 0 || savings.some((w) => i.transferredTo.has(w.id))) return null;
  const open = i.openGoalIds.map((id) => byId.get(id)).filter((w): w is WalletLite => w !== undefined && w.kind === 'savings');
  const target = open[0] ?? savings[0];
  if (!target) return null;

  let source: WalletLite | null = null;
  let sourceBalance = 0;
  for (const w of live) {
    if (w.kind === 'savings') continue;
    const bal = i.balances.get(w.id) ?? 0;
    if (bal > sourceBalance || (bal === sourceBalance && bal > 0 && source !== null && w.id < source.id)) {
      source = w;
      sourceBalance = bal;
    }
  }
  if (source === null || sourceBalance <= 0) return null;
  return {
    month: shiftMonth(monthKey(i.today), -1),
    netMinor: net,
    amountMinor: Math.min(net, sourceBalance),
    from: { id: source.id, name: source.name },
    to: { id: target.id, name: target.name },
  };
}

/** undefined — читается; null — предлагать нечего. Живой запрос: сделали перевод — предложение исчезло. */
export function useRemainderSuggestion(today: IsoDate): RemainderSuggestion | null | undefined {
  const store = useStore();
  const wallets = useWallets();
  const balances = useBalances();
  const goals = useGoals();
  const month = monthKey(today);
  const previousMonth = shiftMonth(month, -1);
  const data = useLiveQuery(async () => {
    if (Number(today.slice(8, 10)) > SAVE_UNTIL_DAY) return { skip: true as const };
    const settings = await store.settings.get();
    if (!settings) return null;
    const [previousTxs, thisMonth] = await Promise.all([
      store.db.transactions.where('occurredOn').between(`${previousMonth}-01`, `${previousMonth}-31`, true, true).toArray(),
      store.db.transactions.where('occurredOn').between(`${month}-01`, `${month}-31`, true, true).toArray(),
    ]);
    try {
      const s = summarizeMonth(previousTxs, previousMonth, settings.baseCurrency);
      const transferredTo = new Set<UUID>();
      for (const t of thisMonth) if (t.deletedAt === null && t.kind === 'transfer' && t.toWalletId !== null) transferredTo.add(t.toWalletId);
      return { skip: false as const, base: settings.baseCurrency, previous: { incomeMinor: s.incomeMinor, expenseMinor: s.expenseMinor }, transferredTo };
    } catch (e) {
      if (e instanceof RangeError) return { skip: true as const };
      throw e;
    }
  }, [store, month, previousMonth, today]);

  if (data === undefined || !wallets || !balances || !goals) return undefined;
  if (data === null || data.skip) return null;
  return remainderSuggestion({
    today,
    base: data.base,
    previous: data.previous,
    wallets,
    balances,
    openGoalIds: goals.filter((g) => !g.progress.reached).map((g) => g.wallet.id),
    reachedGoalIds: new Set(goals.filter((g) => g.progress.reached).map((g) => g.wallet.id)),
    transferredTo: data.transferredTo,
  });
}
