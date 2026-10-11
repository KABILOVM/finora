import type { Store } from '@/db';
import type { LocalRow } from '@/domain/types';
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
      ? 'запись связана с кошельком, категорией, долгом или регулярным платежом, которых нет на сервере'
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

/** Ссылка строки на родителя: поле строки (camelCase) → таблица родителя. Порядок отправки (SYNC_TABLES) ставит родителей раньше детей. */
interface ParentRef {
  field: string;
  parent: SyncTableName;
}

/**
 * Кто от кого зависит (составные внешние ключи в supabase/schema.sql):
 * операции — от кошельков, категорий, долгов и регулярных платежей; регулярные платежи — от кошельков, категорий и долгов;
 * бюджеты — от категорий; долги, кошельки, категории и настройки ни от кого.
 */
const PARENTS: Partial<Record<SyncTableName, readonly ParentRef[]>> = {
  transactions: [
    { field: 'walletId', parent: 'wallets' },
    { field: 'toWalletId', parent: 'wallets' },
    { field: 'categoryId', parent: 'categories' },
    { field: 'debtId', parent: 'debts' },
    { field: 'recurringRuleId', parent: 'recurring_rules' },
  ],
  recurring_rules: [
    { field: 'walletId', parent: 'wallets' },
    { field: 'toWalletId', parent: 'wallets' },
    { field: 'categoryId', parent: 'categories' },
    { field: 'debtId', parent: 'debts' },
  ],
  budgets: [{ field: 'categoryId', parent: 'categories' }],
};

/** Как назвать родителя человеку в сообщении «Не отправлена: …». */
function labelOf(parent: SyncTableName, row: Record<string, unknown>): string {
  const str = (k: string): string => (typeof row[k] === 'string' ? (row[k] as string) : '');
  switch (parent) {
    case 'wallets':
      return `кошелёк «${str('name')}»`;
    case 'categories':
      return `категория «${str('name')}»`;
    case 'debts':
      return `долг «${str('counterparty')}»`;
    case 'recurring_rules':
      return str('note') === '' ? 'регулярный платёж' : `регулярный платёж «${str('note')}»`;
    default:
      return 'связанная запись';
  }
}

const keyOf = (parent: SyncTableName, id: string): string => `${parent}:${id}`;

/** Ссылки строки на родителей (только заполненные): [таблица родителя, id]. */
function refsOf(table: SyncTableName, row: Row): Array<[SyncTableName, string]> {
  const out: Array<[SyncTableName, string]> = [];
  for (const { field, parent } of PARENTS[table] ?? []) {
    const id = row[field];
    if (typeof id === 'string') out.push([parent, id]);
  }
  return out;
}

/** id родителей по таблицам (только те таблицы, на которые строки реально ссылаются). */
function idsByParent(table: SyncTableName, rows: readonly Row[]): Map<SyncTableName, Set<string>> {
  const ids = new Map<SyncTableName, Set<string>>();
  for (const row of rows) {
    for (const [parent, id] of refsOf(table, row)) {
      const set = ids.get(parent) ?? new Set<string>();
      set.add(id);
      ids.set(parent, set);
    }
  }
  return ids;
}

/**
 * Строка ссылается на кошельки, категории, долги, регулярные платежи (см. PARENTS). Если такой родитель в карантине — строку
 * не отправляем (сервер всё равно ответит отказом по внешнему ключу), а помечаем понятным сообщением. Если родитель ещё ждёт
 * отправки (его создали или исправили уже после прохода по его таблице) — откладываем до следующего прохода, а не отправляем
 * и не ловим ложный отказ.
 */
async function splitByParents(ctx: PhaseCtx, table: SyncTableName, rows: Row[]): Promise<Split> {
  if (!PARENTS[table]) return { ready: rows, deferred: [], blocked: [] };
  const { db } = ctx.store;
  const state = new Map<string, { quarantined: boolean; label: string }>();
  for (const [parent, ids] of idsByParent(table, rows)) {
    const found = await db.syncTable(parent).bulkGet([...ids]);
    for (const p of found) {
      if (p && p.dirty === 1) state.set(keyOf(parent, p.id), { quarantined: p.syncError !== null, label: labelOf(parent, p as unknown as Record<string, unknown>) });
    }
  }

  const out: Split = { ready: [], deferred: [], blocked: [] };
  for (const row of rows) {
    const dirty = refsOf(table, row).flatMap(([parent, id]) => {
      const s = state.get(keyOf(parent, id));
      return s ? [s] : [];
    });
    const stuck = dirty.find((s) => s.quarantined);
    if (stuck) out.blocked.push({ row, message: `${BLOCKED_PREFIX}${stuck.label} не принят(а) сервером` });
    else if (dirty.length > 0) out.deferred.push(row);
    else out.ready.push(row);
  }
  return out;
}

/**
 * Строки, застрявшие в карантине только из-за родителя, возвращаются в очередь, как только родитель перестал быть отвергнутым
 * (человек исправил родителя и сервер его принял, либо пришла серверная версия). Собственные отказы строк не трогаем.
 */
async function releaseBlocked(ctx: PhaseCtx, table: SyncTableName): Promise<void> {
  if (!PARENTS[table]) return;
  const { db } = ctx.store;
  const own = db.syncTable(table);
  const findStuck = () =>
    own
      .where('dirty')
      .equals(1)
      .filter((t) => t.syncError !== null && t.syncError.startsWith(BLOCKED_PREFIX))
      .toArray() as unknown as Promise<Row[]>;
  const first = await findStuck();
  if (first.length === 0) return; // обычный случай: ждать нечего, транзакцию не открываем
  const parentTables = [...idsByParent(table, first).keys()];
  await db.transaction('rw', [own, ...parentTables.map((p) => db.syncTable(p))], async () => {
    const stuck = await findStuck();
    if (stuck.length === 0) return;
    const rejected = new Set<string>();
    for (const [parent, ids] of idsByParent(table, stuck)) {
      for (const p of await db.syncTable(parent).bulkGet([...ids])) {
        if (p && p.dirty === 1 && p.syncError !== null) rejected.add(keyOf(parent, p.id));
      }
    }
    const free = stuck.filter((t) => !refsOf(table, t).some(([parent, id]) => rejected.has(keyOf(parent, id))));
    if (free.length > 0) await own.bulkPut(free.map((t) => ({ ...t, syncError: null })) as never);
  });
}

async function pushTable(ctx: PushCtx, table: SyncTableName, stats: PushStats): Promise<number> {
  await releaseBlocked(ctx, table);
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
