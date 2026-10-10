import type { Store } from '@/db';
import type { LocalRow, Transaction } from '@/domain/types';
import { SYNC_TABLES, toWire, type SyncTableName } from './tables';
import { TransportError, type SyncTransport } from './transport';

/**
 * Фаза «отправка»: локальные записи, ждущие отправки, уходят на сервер пачками.
 * Сервер принимает пачку целиком или отвергает целиком, поэтому при отказе виновные строки ищутся делением пачки пополам,
 * а остальные уходят как обычно. Правила целостности (что считать отправленным) — в store.sync (markPushed / quarantine).
 */

export const PUSH_BATCH = 200;
/** Сколько лишних запросов на поиск виновных можно потратить за один цикл. Больше — признак системной беды: останавливаемся. */
export const BISECT_BUDGET = 600;
/** Во сколько проходов по таблицам повторять отправку, если операции ждут ещё не ушедших родителей. */
const MAX_ROUNDS = 3;
/** Страховка от бесконечного цикла, если человек правит записи быстрее, чем они уходят. */
const MAX_BATCHES_PER_TABLE = 2000;
const LIST_LIMIT_MAX = 10_000; // потолок store.sync.listDirty

/** Так начинается сообщение у операции, которую не отправили из-за отвергнутого родителя (по нему её отличают от собственных отказов). */
const BLOCKED_PREFIX = 'Не отправлена: ';

export interface PhaseCtx {
  store: Store;
  transport: SyncTransport;
  /** Бросает, если движок уже выключен (dispose). */
  check(): void;
}

export interface PushCtx extends PhaseCtx {
  /** Остаток запросов на поиск виновных в этом цикле. */
  budget: { left: number };
}

export interface PushStats {
  /** Строк принято сервером. */
  sent: number;
  /** Строк помещено в карантин. */
  quarantined: number;
}

export class BisectBudgetError extends Error {
  constructor() {
    super('Сервер отвергает слишком много записей сразу — продолжим позже');
    this.name = 'BisectBudgetError';
  }
}

/** Понятное человеку объяснение отказа сервера (по коду Postgres). */
export function describeRejection(err: TransportError): string {
  const code = err.code ?? '';
  const why =
    code === '23503'
      ? 'запись связана с кошельком или категорией, которых нет на сервере'
      : code === '23514'
        ? 'значение вне допустимых границ'
        : code === '23502'
          ? 'не заполнено обязательное поле'
          : code === '23505'
            ? 'такая запись уже есть'
            : code === '42501'
              ? 'нет прав на эту запись'
              : code === '21000'
                ? 'запись повторилась в одной отправке'
                : code.startsWith('22')
                  ? 'значение записано в неверном виде'
                  : '';
  const head = why === '' ? 'Сервер не принял запись' : `Сервер не принял запись: ${why}`;
  return code === '' ? head : `${head} (код ${code})`;
}

interface Versioned {
  id: string;
  clientUpdatedAt: string;
  deviceId: string;
}

const newer = (a: Versioned, b: Versioned): boolean =>
  a.clientUpdatedAt !== b.clientUpdatedAt ? a.clientUpdatedAt > b.clientUpdatedAt : a.deviceId > b.deviceId;

/** В пачке не бывает двух строк с одним id (Postgres отвергнет пачку целиком): остаётся версия с большей меткой. */
export function dedupById<T extends Versioned>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const cur = best.get(r.id);
    if (!cur || newer(r, cur)) best.set(r.id, r);
  }
  return [...best.values()];
}

const refOf = (r: Versioned) => ({ id: r.id, clientUpdatedAt: r.clientUpdatedAt, deviceId: r.deviceId });

type Row = LocalRow<Versioned & Record<string, unknown>>;

/** Отправляет пачку; при отказе 'rejected' делит пополам и ищет виновных. Остальные виды ошибок уходят наверх. */
async function pushBatch(ctx: PushCtx, table: SyncTableName, rows: readonly Row[], depth: number, stats: PushStats): Promise<void> {
  ctx.check();
  if (depth > 0) {
    if (ctx.budget.left <= 0) throw new BisectBudgetError();
    ctx.budget.left--;
  }
  try {
    await ctx.transport.push(
      table,
      rows.map((r) => toWire(table, r as never)),
    );
  } catch (e) {
    if (!(e instanceof TransportError) || e.kind !== 'rejected') throw e;
    if (rows.length === 1) {
      const row = rows[0] as Row;
      stats.quarantined += await ctx.store.sync.quarantine(table, [refOf(row)], describeRejection(e));
      return;
    }
    const mid = rows.length >> 1;
    await pushBatch(ctx, table, rows.slice(0, mid), depth + 1, stats);
    await pushBatch(ctx, table, rows.slice(mid), depth + 1, stats);
    return;
  }
  await ctx.store.sync.markPushed(
    table,
    rows.map((r) => refOf(r)),
  );
  stats.sent += rows.length;
}

interface Split {
  ready: Row[];
  /** Родитель ещё не ушёл на сервер (но и не отвергнут): отправим в следующем проходе. */
  deferred: Row[];
  /** Родитель отвергнут сервером: отправлять бессмысленно. */
  blocked: Array<{ row: Row; message: string }>;
}

/**
 * Операция ссылается на кошельки и категорию. Если такой родитель в карантине — операцию не отправляем (сервер всё равно
 * ответит отказом по внешнему ключу), а помечаем понятным сообщением. Если родитель ещё ждёт отправки (его создали или
 * исправили уже после прохода по кошелькам) — откладываем до следующего прохода, а не отправляем и не ловим ложный отказ.
 */
async function splitByParents(ctx: PhaseCtx, table: SyncTableName, rows: Row[]): Promise<Split> {
  if (table !== 'transactions') return { ready: rows, deferred: [], blocked: [] };
  const txs = rows as unknown as LocalRow<Transaction>[];
  const walletIds = new Set<string>();
  const categoryIds = new Set<string>();
  for (const t of txs) {
    walletIds.add(t.walletId);
    if (t.toWalletId) walletIds.add(t.toWalletId);
    if (t.categoryId) categoryIds.add(t.categoryId);
  }
  const { db } = ctx.store;
  const [wallets, categories] = await Promise.all([db.wallets.bulkGet([...walletIds]), db.categories.bulkGet([...categoryIds])]);
  const state = new Map<string, { quarantined: boolean; label: string }>();
  for (const w of wallets) if (w && w.dirty === 1) state.set(`w:${w.id}`, { quarantined: w.syncError !== null, label: `кошелёк «${w.name}»` });
  for (const c of categories) if (c && c.dirty === 1) state.set(`c:${c.id}`, { quarantined: c.syncError !== null, label: `категория «${c.name}»` });

  const out: Split = { ready: [], deferred: [], blocked: [] };
  rows.forEach((row, i) => {
    const t = txs[i] as LocalRow<Transaction>;
    const parents = [`w:${t.walletId}`, t.toWalletId ? `w:${t.toWalletId}` : null, t.categoryId ? `c:${t.categoryId}` : null];
    const dirty = parents.flatMap((k) => {
      const s = k === null ? undefined : state.get(k);
      return s ? [s] : [];
    });
    const stuck = dirty.find((s) => s.quarantined);
    if (stuck) out.blocked.push({ row, message: `${BLOCKED_PREFIX}${stuck.label} не принят(а) сервером` });
    else if (dirty.length > 0) out.deferred.push(row);
    else out.ready.push(row);
  });
  return out;
}

/**
 * Операции, застрявшие в карантине только из-за родителя, возвращаются в очередь, как только родитель перестал быть отвергнутым
 * (человек исправил кошелёк или категорию и сервер их принял, либо пришла серверная версия). Собственные отказы операций не трогаем.
 */
async function releaseBlocked(ctx: PhaseCtx): Promise<void> {
  const { db } = ctx.store;
  await db.transaction('rw', [db.transactions, db.wallets, db.categories], async () => {
    const stuck = await db.transactions
      .where('dirty')
      .equals(1)
      .filter((t) => t.syncError !== null && t.syncError.startsWith(BLOCKED_PREFIX))
      .toArray();
    if (stuck.length === 0) return;
    const walletIds = new Set<string>();
    const categoryIds = new Set<string>();
    for (const t of stuck) {
      walletIds.add(t.walletId);
      if (t.toWalletId) walletIds.add(t.toWalletId);
      if (t.categoryId) categoryIds.add(t.categoryId);
    }
    const rejected = new Set<string>();
    for (const w of await db.wallets.bulkGet([...walletIds])) if (w && w.dirty === 1 && w.syncError !== null) rejected.add(w.id);
    for (const c of await db.categories.bulkGet([...categoryIds])) if (c && c.dirty === 1 && c.syncError !== null) rejected.add(c.id);
    const free = stuck.filter((t) => ![t.walletId, t.toWalletId, t.categoryId].some((id) => id !== null && rejected.has(id)));
    if (free.length > 0) await db.transactions.bulkPut(free.map((t) => ({ ...t, syncError: null })));
  });
}

async function pushTable(ctx: PushCtx, table: SyncTableName, stats: PushStats): Promise<number> {
  if (table === 'transactions') await releaseBlocked(ctx);
  const skip = new Set<string>();
  for (let guard = 0; guard < MAX_BATCHES_PER_TABLE; guard++) {
    ctx.check();
    // отложенные строки всегда в начале очереди (она идёт от старых к новым): просим на столько больше
    const want = PUSH_BATCH + skip.size;
    if (want > LIST_LIMIT_MAX) break;
    const dirty = (await ctx.store.sync.listDirty(table, want)) as unknown as Row[];
    const fresh = dirty.filter((r) => !skip.has(r.id));
    if (fresh.length === 0) break;
    const batch = dedupById(fresh).slice(0, PUSH_BATCH);

    const { ready, deferred, blocked } = await splitByParents(ctx, table, batch);
    for (const b of blocked) stats.quarantined += await ctx.store.sync.quarantine(table, [refOf(b.row)], b.message);
    for (const r of deferred) skip.add(r.id);
    if (ready.length > 0) await pushBatch(ctx, table, ready, 0, stats);
  }
  return skip.size;
}

/** Отправляет всё, что ждёт, по таблицам в порядке зависимостей (родители раньше детей). Возвращает итоги. */
export async function pushAll(ctx: PushCtx): Promise<PushStats> {
  const stats: PushStats = { sent: 0, quarantined: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let deferred = 0;
    for (const table of SYNC_TABLES) deferred += await pushTable(ctx, table, stats);
    if (deferred === 0) break;
  }
  return stats;
}
