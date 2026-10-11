import { computeBalances } from '@/domain/balances';
import type { Category, Entity, LocalFields, LocalRow, Settings, SyncFields, Transaction, Wallet } from '@/domain/types';
import { TABLE_SPECS, type SyncTableName } from '@/sync/tables';
import { BACKUP_FORMAT, BACKUP_VERSION, parseBackup, type BackupFile } from './backupSchema';
import { fail } from './errors';
import { defaultId, FINORA_NAMESPACE, isUuid, uuidV5 } from './ids';
import { writeTx } from './repoContext';
import { SEED_SLUGS } from './seed';
import { internalContext, type Store } from './store';
import { compareVersion, TRANSFER_CREATES_MONEY_TEXT, transferCreatesMoney } from './validate';

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

export interface ImportOptions {
  /**
   * Чья это копия (id пользователя, в чьей базе она сделана), если известно и блока настроек в файле нет.
   * Тогда стартовые кошелёк и категории копии совпадут со стартовыми записями этого аккаунта, а не продублируются.
   */
  sourceUserId?: string;
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
 * Свои id для чужой копии. На сервере первичный ключ id ОДИН НА ВСЕХ пользователей: запись с id, который уже занят
 * чужой строкой (копия другого или старого аккаунта, копия из локального режима, загруженная во второй аккаунт),
 * сервер отвергает навсегда (нет прав на чужую строку), и она висит «не принята сервером» без шанса уйти.
 * Поэтому каждый id из такого файла заменяется на производный от (этот пользователь + прежний id), а все ссылки
 * (родитель категории, кошелёк и категория операции) переписываются так же. Производный id не случаен: тот же файл
 * второй раз даёт те же id, поэтому повторная загрузка ничего не плодит (записи сливаются по правилу «новее побеждает»),
 * и два устройства одного аккаунта, загрузив один файл, получают одни и те же записи. Ссылка на запись, которой нет в файле,
 * остаётся как есть: её существование проверит импорт.
 */
async function withAccountIds(file: BackupFile, userId: string, sourceUserId?: string): Promise<BackupFile> {
  // Стартовые записи (кошелёк «Наличные», категории) у каждого пользователя свои, но выводятся из его id по одним и тем же slug.
  // Если известно, чья это копия, её стартовые записи сопоставляются со стартовыми записями ЭТОГО пользователя, а не плодят дубли.
  const seeded = new Map<string, string>();
  if (sourceUserId !== undefined && isUuid(sourceUserId)) {
    for (const slug of SEED_SLUGS) seeded.set(await defaultId(sourceUserId, slug), await defaultId(userId, slug));
  }
  const derive = async (kind: string, ids: readonly string[]): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    for (const id of ids) out.set(id, seeded.get(id) ?? (await uuidV5(FINORA_NAMESPACE, `${userId}:import:${kind}:${id}`)));
    return out;
  };
  const [w, c, t] = await Promise.all([
    derive('wallet', file.wallets.map((x) => x.id)),
    derive('category', file.categories.map((x) => x.id)),
    derive('transaction', file.transactions.map((x) => x.id)),
  ]);
  const pick = (m: Map<string, string>, id: string | null): string | null => (id === null ? null : (m.get(id) ?? id));
  return {
    ...file,
    wallets: file.wallets.map((x) => ({ ...x, id: w.get(x.id) ?? x.id })),
    categories: file.categories.map((x) => ({ ...x, id: c.get(x.id) ?? x.id, parentId: pick(c, x.parentId) })),
    transactions: file.transactions.map((x) => ({
      ...x,
      id: t.get(x.id) ?? x.id,
      walletId: pick(w, x.walletId) ?? x.walletId,
      toWalletId: pick(w, x.toWalletId),
      categoryId: pick(c, x.categoryId),
    })),
  };
}

/**
 * Импорт резервной копии.
 *  1) Весь файл проверяется до первой записи (структура, типы, границы, дубли id): ошибка — в базе ничего не меняется.
 *  2) Слияние по id по правилу «новее побеждает»: импорт НИКОГДА не затирает более новые локальные данные.
 *     Тот же файл второй раз ничего не заменяет — и когда в нём метки из будущего (они подрезаются одинаково, см. backupSchema.ts).
 *  3) Копия не может сделать то, что запретили бы репозитории: сменить валюту кошелька с операциями или вид категории
 *     с живыми операциями (иначе суммы поменяли бы смысл) — такой файл отвергается целиком.
 *  4) Всё записывается одной транзакцией; импортированное помечается dirty и уйдёт в облако.
 *  5) Копия с блоком настроек ДРУГОГО аккаунта отвергается. Копия БЕЗ блока настроек принимается: восстановить свои данные
 *     в новый аккаунт после потери старого — законный сценарий, отказ его сломал бы (принятое решение, не упущение).
 *     Такая копия — не своя (свою всегда сопровождает блок настроек с id этого аккаунта): её записи получают СВОИ id
 *     (см. withAccountIds), иначе они столкнулись бы на сервере с чужими строками с теми же id и ушли бы в карантин.
 *     Копия со своим блоком настроек сохраняет id: те же записи уже могут быть на сервере и на других устройствах.
 */
export async function importBackup(store: Store, data: unknown, options: ImportOptions = {}): Promise<ImportResult> {
  const ctx = internalContext(store);
  const parsed = parseBackup(data, { userId: store.userId, nowMs: Date.now() });
  // id считаются ДО транзакции Dexie: ожидание не-Dexie промисов (crypto) внутри неё закрыло бы транзакцию
  const file = parsed.settings === null ? await withAccountIds(parsed, store.userId, options.sourceUserId) : parsed;
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
    // Кольцо родителей (A → B → A) оставило бы категории без корня и зациклило дерево: репозиторий такое не создаёт.
    for (const id of c.winners) {
      const seen = new Set<string>();
      for (let cur: string | null = id; cur !== null; cur = categories.get(cur)?.parentId ?? null) {
        if (seen.has(cur)) fail(`Резервная копия: категория «${categories.get(id)?.name ?? id}» входит в кольцо родительских категорий (цикл)`);
        seen.add(cur);
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
    // Перевод в одной валюте не зачисляет больше, чем списал (как и в репозитории). Смотрим живые операции из файла.
    for (const tx of transactions.values()) {
      if (!t.winners.has(tx.id) || tx.deletedAt !== null || tx.kind !== 'transfer' || tx.toWalletId === null) continue;
      const from = wallets.get(tx.walletId);
      const to = wallets.get(tx.toWalletId);
      if (from && to && transferCreatesMoney(from.currency, to.currency, tx.amountMinor, tx.toAmountMinor)) {
        fail(`Резервная копия, перевод от ${tx.occurredOn}: ${TRANSFER_CREATES_MONEY_TEXT}`);
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
