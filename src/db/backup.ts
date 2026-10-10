import { computeBalances } from '@/domain/balances';
import type { Category, Entity, LocalFields, LocalRow, Settings, SyncFields, Transaction, Wallet } from '@/domain/types';
import { TABLE_SPECS, type SyncTableName } from '@/sync/tables';
import { BACKUP_FORMAT, BACKUP_VERSION, parseBackup, type BackupFile } from './backupSchema';
import { fail } from './errors';
import { writeTx } from './repoContext';
import { internalContext, type Store } from './store';
import { compareVersion } from './validate';

export { exportTransactionsCsv } from './backupCsv';
export type { BackupFile } from './backupSchema';

/** Строка базы → чистая сущность (без служебных полей dirty/serverSeq/syncError) — ровно по колонкам договора. */
export function toEntity<T extends Entity>(table: SyncTableName, row: LocalRow<T>): T {
  const src = row as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const c of TABLE_SPECS[table].columns) out[c.field] = src[c.field] ?? null;
  return out as unknown as T;
}

/** Полная резервная копия: настройки, кошельки, категории и ВСЕ операции, включая удалённые. Снимок читается одной транзакцией. */
export async function exportBackup(store: Store): Promise<BackupFile> {
  const { db } = store;
  const [settings, wallets, categories, transactions] = await db.transaction(
    'r',
    [db.settings, db.wallets, db.categories, db.transactions],
    () => Promise.all([db.settings.get(store.userId), db.wallets.toArray(), db.categories.toArray(), db.transactions.toArray()]),
  );
  const byCreated = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: settings ? toEntity<Settings>('settings', settings) : null,
    wallets: wallets.sort(byCreated).map((r) => toEntity<Wallet>('wallets', r)),
    categories: categories.sort(byCreated).map((r) => toEntity<Category>('categories', r)),
    transactions: transactions.sort(byCreated).map((r) => toEntity<Transaction>('transactions', r)),
  };
}

export interface ImportResult {
  /** Записей, которых не было, — добавлено. */
  added: number;
  /** Записей, у которых версия в файле новее локальной, — заменено. */
  replaced: number;
  /** Записей, у которых локальная версия новее или равна, — оставлено как есть. */
  keptLocal: number;
}

type Row<T> = LocalRow<T & SyncFields>;

/**
 * Слияние по id по правилу «новее побеждает» (clientUpdatedAt, затем deviceId).
 * Мутирует `final` (итоговое состояние таблицы в памяти) и возвращает строки, которые надо записать.
 */
function mergeTable<E extends SyncFields, R extends E & LocalFields>(
  final: Map<string, R>,
  incoming: readonly E[],
  tally: ImportResult,
): { written: R[]; winners: Set<string> } {
  const written: R[] = [];
  const winners = new Set<string>();
  for (const inc of incoming) {
    const cur = final.get(inc.id);
    let row: R;
    if (!cur) {
      row = { ...inc, dirty: 1, serverSeq: null, syncError: null } as R;
      tally.added++;
    } else if (compareVersion(inc, cur) > 0) {
      // serverSeq сохраняем: это «какую версию сервера мы уже видели», он не зависит от импорта
      row = { ...inc, dirty: 1, serverSeq: cur.serverSeq, syncError: null } as R;
      tally.replaced++;
    } else {
      tally.keptLocal++;
      continue;
    }
    final.set(inc.id, row);
    written.push(row);
    winners.add(inc.id);
  }
  return { written, winners };
}

const index = <R extends { id: string }>(rows: readonly R[]): Map<string, R> => new Map(rows.map((r) => [r.id, r]));

/**
 * Импорт резервной копии.
 *  1) Весь файл проверяется до первой записи (структура, типы, границы, дубли id): ошибка — в базе ничего не меняется.
 *  2) Слияние по id по правилу «новее побеждает»: импорт НИКОГДА не затирает более новые локальные данные.
 *  3) Копия не может сделать то, что запретили бы репозитории: сменить валюту кошелька с операциями или вид категории
 *     с живыми операциями (иначе суммы поменяли бы смысл) — такой файл отвергается целиком.
 *  4) Всё записывается одной транзакцией; импортированное помечается dirty и уйдёт в облако.
 * Копия другого аккаунта отвергается (id записей уникальны на сервере и принадлежат владельцу).
 */
export async function importBackup(store: Store, data: unknown): Promise<ImportResult> {
  const ctx = internalContext(store);
  const file = parseBackup(data, { userId: store.userId, nowMs: Date.now() });
  const { db } = store;
  const tally: ImportResult = { added: 0, replaced: 0, keptLocal: 0 };

  return writeTx(ctx, [db.settings, db.wallets, db.categories, db.transactions], async () => {
    const wallets = index(await db.wallets.toArray());
    const categories = index(await db.categories.toArray());
    const transactions = index(await db.transactions.toArray());
    const settings = index(await db.settings.toArray());

    // До слияния: валюта кошельков (чтобы заметить, что импорт её меняет).
    const currencyBefore = new Map([...wallets.values()].map((x) => [x.id, x.currency]));

    const w = mergeTable<Wallet, Row<Wallet>>(wallets, file.wallets, tally);
    const c = mergeTable<Category, Row<Category>>(categories, file.categories, tally);
    const t = mergeTable<Transaction, Row<Transaction>>(transactions, file.transactions, tally);
    const s = file.settings
      ? mergeTable<Settings, Row<Settings>>(settings, [file.settings], tally)
      : { written: [] as Row<Settings>[], winners: new Set<string>() };

    // Правила репозиториев действуют и при импорте: копия не должна сделать то, что запретил бы сам интерфейс.
    // Валюта кошелька, по которому есть операции, не меняется: суммы поменяли бы смысл. Смотрим итог: операции,
    // которые остались локальными (не заменены версией из файла), заведены в прежней валюте. Операции из файла
    // пришли вместе с новой валютой кошелька — в самой копии они согласованы.
    const pinned = new Set<string>();
    for (const x of transactions.values()) {
      if (t.winners.has(x.id)) continue;
      pinned.add(x.walletId);
      if (x.toWalletId !== null) pinned.add(x.toWalletId);
    }
    for (const id of w.winners) {
      const row = wallets.get(id);
      if (row && currencyBefore.has(id) && currencyBefore.get(id) !== row.currency && pinned.has(id)) {
        fail(`Резервная копия меняет валюту кошелька «${row.name}», а по нему на этом устройстве уже есть операции — импорт отменён`);
      }
    }
    // Ссылки: на что указывает импортируемая запись, то обязано существовать (в файле или уже в базе).
    for (const cat of file.categories) {
      if (cat.parentId !== null && !categories.has(cat.parentId)) {
        fail(`Резервная копия: у категории «${cat.name}» нет родительской категории`);
      }
    }
    // Вид категории и её родителя: смотрим итог, но только там, где импорт что-то изменил. Удалённые не в счёт.
    for (const cat of categories.values()) {
      if (cat.deletedAt !== null || cat.parentId === null) continue;
      const parent = categories.get(cat.parentId);
      if (parent && parent.kind !== cat.kind && (c.winners.has(cat.id) || c.winners.has(parent.id))) {
        fail(`Резервная копия: категория «${cat.name}» и её родитель разного вида`);
      }
    }
    for (const tx of file.transactions) {
      if (!wallets.has(tx.walletId) || (tx.toWalletId !== null && !wallets.has(tx.toWalletId))) {
        fail('Резервная копия: операция ссылается на несуществующий кошелёк');
      }
      if (tx.categoryId !== null && !categories.has(tx.categoryId)) {
        fail('Резервная копия: операция ссылается на несуществующую категорию');
      }
    }
    // Вид живой операции совпадает с видом её категории (у удалённой операции это не важно: её не видно, а
    // «восстановить» репозиторий всё равно не даст). Иначе расход оказался бы в категории доходов.
    for (const tx of transactions.values()) {
      if (tx.deletedAt !== null || tx.categoryId === null) continue;
      const cat = categories.get(tx.categoryId);
      if (!cat || cat.kind === tx.kind) continue;
      if (t.winners.has(tx.id)) fail(`Резервная копия: категория «${cat.name}» не подходит к виду операции`);
      if (c.winners.has(cat.id)) {
        fail(`Резервная копия меняет вид категории «${cat.name}», а по ней на этом устройстве уже есть операции — импорт отменён`);
      }
    }
    if (file.settings?.defaultWalletId && !wallets.has(file.settings.defaultWalletId)) {
      fail('Резервная копия: кошелёк по умолчанию не найден');
    }

    // Итоговые суммы не должны переполняться (иначе экран остатков сломается).
    try {
      computeBalances([...wallets.values()], [...transactions.values()]);
    } catch (e) {
      if (e instanceof RangeError) fail('Резервная копия: суммы слишком велики');
      throw e;
    }

    await db.wallets.bulkPut(w.written);
    await db.categories.bulkPut(c.written);
    await db.transactions.bulkPut(t.written);
    await db.settings.bulkPut(s.written);

    // Следующие правки этого устройства должны быть новее всего, что мы только что записали.
    // (метки файла уже проверены: не дальше «сейчас + 5 минут», поэтому берём самую большую)
    const written = [...w.written, ...c.written, ...t.written, ...s.written];
    if (written.length > 0) ctx.clock.observe(written.reduce((m, r) => (r.clientUpdatedAt > m ? r.clientUpdatedAt : m), ''));
    return tally;
  });
}
