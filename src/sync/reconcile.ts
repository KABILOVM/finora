import type { Store } from '@/db';
import { touch, writeTx } from '@/db/repoContext';
import { internalContext } from '@/db/store';
import type { FinoraDB } from '@/db/database';
import type { Category, Transaction, UUID, Wallet } from '@/domain/types';
import type { SyncTableName } from './tables';

/**
 * Согласование данных после получения с сервера.
 *
 * Каждая строка сливается отдельно («последняя правка побеждает»), а правила «валюту кошелька нельзя менять, если по нему
 * есть операции» и «вид категории нельзя менять, если по ней есть операции» проверяют только локальные репозитории — на
 * одном устройстве. Если один телефон поменял валюту кошелька, а другой, не зная об этом, записал в него расход, после
 * синхронизации сумма меняет смысл («1000 сомони» становится «1000 долларов»). Здесь это ловится и исправляется:
 * операции главнее — кошелёк (категория) возвращается к тому, под что записаны операции, новой правкой, которая
 * разойдётся по остальным устройствам. Чужая операция никогда не меняется и не удаляется.
 *
 * Проверяются только записи, которых коснулось это получение, а полный просмотр операций кошелька — только если есть подозрение.
 */

/** Что запомнить по ходу получения, чтобы потом проверить. Живёт один заход (для пересчёта хватает данных в базе). */
export interface Watch {
  /** Валюта кошелька ДО чужой версии, сменившей её, если у кошелька к тому времени уже были операции. */
  pinnedCurrency: Map<UUID, string>;
  /** Пришедшие операции: кошелёк → «базовая валюта / по какому курсу» (см. factOf). Хватает горстки вариантов на кошелёк. */
  walletFacts: Map<UUID, Set<string>>;
  /** Пришедшие живые операции: категория → виды операций. */
  categoryKinds: Map<UUID, Set<string>>;
  /** Категории, чей вид сменила чужая версия при живых локальных операциях. */
  suspectCategories: Set<UUID>;
}

export const newWatch = (): Watch => ({
  pinnedCurrency: new Map(),
  walletFacts: new Map(),
  categoryKinds: new Map(),
  suspectCategories: new Set(),
});

type TxFacts = Pick<Transaction, 'kind' | 'fxSource' | 'baseCurrency'>;

/** Операция «в базовой валюте» (курс 1, источник same) лежит ровно в кошельке базовой валюты — и только в нём. */
const fits = (txs: readonly TxFacts[], currency: string): boolean =>
  txs.every((t) => t.kind === 'transfer' || (t.fxSource === 'same') === (t.baseCurrency === currency));

const factOf = (t: TxFacts): string => `${t.fxSource === 'same' ? 'same' : 'fx'}:${t.baseCurrency}`;
/** Согласуется ли запомненный факт об операции («same:TJS» / «fx:TJS») с валютой кошелька. */
const factFits = (fact: string, currency: string): boolean =>
  fact.startsWith('same:') ? fact.slice(5) === currency : fact.slice(3) !== currency;

async function hasTransactions(db: FinoraDB, walletId: UUID): Promise<boolean> {
  if ((await db.transactions.where('walletId').equals(walletId).count()) > 0) return true;
  return (await db.transactions.where('toWalletId').equals(walletId).count()) > 0;
}

const hasLiveOperation = async (db: FinoraDB, categoryId: UUID): Promise<boolean> =>
  (await db.transactions.where('categoryId').equals(categoryId).filter((t) => t.deletedAt === null).first()) !== undefined;

/**
 * Вызывается ПЕРЕД записью страницы с сервера (пока в базе ещё локальные версии): запоминает, что потом проверять.
 * Для кошелька важно, какая валюта была у него до чужой версии: по ней видно, под что записаны локальные операции.
 */
export async function noteIncoming(
  store: Store,
  table: SyncTableName,
  rows: ReadonlyArray<{ entity: unknown }>,
  watch: Watch,
): Promise<void> {
  const { db } = store;
  if (table === 'wallets') {
    const incoming = rows.map((r) => r.entity as Wallet);
    const local = await db.wallets.bulkGet(incoming.map((w) => w.id));
    for (const [i, w] of incoming.entries()) {
      const was = local[i];
      if (!was || was.deletedAt !== null || was.currency === w.currency || watch.pinnedCurrency.has(was.id)) continue;
      if (await hasTransactions(db, was.id)) watch.pinnedCurrency.set(was.id, was.currency);
    }
  } else if (table === 'categories') {
    const incoming = rows.map((r) => r.entity as Category);
    const local = await db.categories.bulkGet(incoming.map((c) => c.id));
    for (const [i, c] of incoming.entries()) {
      const was = local[i];
      if (was && was.deletedAt === null && was.kind !== c.kind && (await hasLiveOperation(db, was.id))) watch.suspectCategories.add(was.id);
    }
  } else if (table === 'transactions') {
    for (const t of rows.map((r) => r.entity as Transaction)) {
      if (t.kind === 'transfer') continue;
      const facts = watch.walletFacts.get(t.walletId) ?? new Set<string>();
      facts.add(factOf(t));
      watch.walletFacts.set(t.walletId, facts);
      if (t.deletedAt === null && t.categoryId !== null) {
        const kinds = watch.categoryKinds.get(t.categoryId) ?? new Set<string>();
        kinds.add(t.kind);
        watch.categoryKinds.set(t.categoryId, kinds);
      }
    }
  }
}

/** Какой валюте должен соответствовать кошелёк, чтобы все его операции читались правильно; null — менять нечего или неясно на что. */
async function planWallet(db: FinoraDB, id: UUID, pin: string | undefined): Promise<string | null> {
  const w = await db.wallets.get(id);
  if (!w || w.deletedAt !== null) return null;
  // удалённые операции тоже считаются: при восстановлении они снова встанут в кошелёк
  const txs = (await db.transactions.where('walletId').equals(id).toArray()).filter((t) => t.kind !== 'transfer');
  if (txs.length === 0 || fits(txs, w.currency)) return null;
  const candidates = [...(pin !== undefined ? [pin] : []), ...txs.filter((t) => t.fxSource === 'same').map((t) => t.baseCurrency)];
  return candidates.find((c) => c !== w.currency && fits(txs, c)) ?? null;
}

/** Каким должен быть вид категории, чтобы все её живые операции были того же вида; null — менять нечего или операции разного вида. */
async function planCategory(db: FinoraDB, id: UUID): Promise<string | null> {
  const c = await db.categories.get(id);
  if (!c || c.deletedAt !== null) return null;
  const kinds = new Set(
    (await db.transactions.where('categoryId').equals(id).filter((t) => t.deletedAt === null && t.kind !== 'transfer').toArray()).map((t) => t.kind),
  );
  const only = kinds.size === 1 ? [...kinds][0] : undefined;
  return only !== undefined && only !== c.kind ? only : null;
}

/**
 * Исправляет то, что нашлось. Возвращает, сколько записей переписано (они ждут отправки; уведомление о правке уйдёт само).
 * Любая неожиданность здесь не должна ломать синхронизацию: данные остаются как есть, как было бы без согласования.
 */
export async function reconcile(store: Store, watch: Watch): Promise<number> {
  try {
    const { db } = store;
    const ctx = internalContext(store);
    let fixed = 0;

    const wallets = new Set<UUID>(watch.pinnedCurrency.keys());
    for (const [id, facts] of watch.walletFacts) {
      const w = await db.wallets.get(id);
      if (w && w.deletedAt === null && ![...facts].every((f) => factFits(f, w.currency))) wallets.add(id);
    }
    for (const id of wallets) {
      if ((await planWallet(db, id, watch.pinnedCurrency.get(id))) === null) continue;
      const done = await writeTx(ctx, [db.wallets, db.transactions], async () => {
        const target = await planWallet(db, id, watch.pinnedCurrency.get(id)); // заново, уже внутри записи
        const w = await db.wallets.get(id);
        if (target === null || !w) return false;
        await db.wallets.put({ ...w, currency: target, ...touch(ctx).fields });
        return true;
      });
      if (done) fixed++;
    }

    const categories = new Set<UUID>(watch.suspectCategories);
    for (const [id, kinds] of watch.categoryKinds) {
      const c = await db.categories.get(id);
      if (c && c.deletedAt === null && [...kinds].some((k) => k !== c.kind)) categories.add(id);
    }
    for (const id of categories) {
      if ((await planCategory(db, id)) === null) continue;
      const done = await writeTx(ctx, [db.categories, db.transactions], async () => {
        const target = await planCategory(db, id);
        const c = await db.categories.get(id);
        if (target === null || !c) return false;
        await db.categories.put({ ...c, kind: target as Category['kind'], ...touch(ctx).fields });
        return true;
      });
      if (done) fixed++;
    }
    return fixed;
  } catch {
    return 0;
  }
}
