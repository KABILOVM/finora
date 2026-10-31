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
  /**
   * Строки, которые ждут обновления схемы в облаке (таблица → id): у них задано значение в колонке, которой у сервера ещё нет
   * (отказ 'schema'). Они остаются «грязными», не уходят в карантин и до конца цикла больше не отправляются (иначе тот же отказ
   * повторялся бы на каждом проходе); остальное уходит как обычно. Операции на таком кошельке ждут вместе с ним (splitByParents).
   */
  waiting: Map<SyncTableName, Set<string>>;
}

export interface PushStats {
  /** Строк принято сервером. */
  sent: number;
  /** Строк помещено в карантин. */
  quarantined: number;
  /**
   * true — сервер отверг пачку: версия строки там ушла вперёд (другое устройство записало раньше). Отправка остановлена:
   * нужно забрать свежее и объединить (pullAll), потом отправить заново — ожидаемые версии строк к тому времени обновятся.
   */
  conflicted: boolean;
}

/** Внутренний сигнал: сервер ответил 'conflict', дальше пачку делить бессмысленно (виновных искать не надо — достаточно забрать свежее). */
class ConflictSignal extends Error {}

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

/** Что ждёт обновления схемы (по таблице строк из PushCtx.waiting) и какой раздел supabase/schema.sql добавляет нужные колонки. */
const SCHEMA_WAIT: ReadonlyArray<{ table: SyncTableName; section: string; what: string }> = [
  { table: 'wallets', section: 'раздел 11 — цели накопления', what: 'кошельки с целью и их операции' },
  { table: 'settings', section: 'раздел 13 — города для погоды', what: 'настройки' },
  { table: 'debts', section: 'раздел 14 — проценты по долгам', what: 'долги с процентами и их операции' },
];

/** Понятное человеку объяснение, почему часть записей ждёт: схема в облаке устарела. Без точки в конце (её ставит текст статуса). */
export function describeSchemaWait(tables: Iterable<SyncTableName>): string {
  const set = new Set(tables);
  const known = SCHEMA_WAIT.filter((p) => set.has(p.table));
  const what = known.map((p) => p.what);
  if (what.length === 0 || known.length < set.size) what.push(known.length > 0 ? 'другие записи' : 'некоторые записи');
  const where = known.length > 0 ? ` (${known.map((p) => p.section).join('; ')})` : '';
  return `В облаке устарела схема: выполните supabase/schema.sql целиком${where}; пока ${what.join(', ')} остаются только на этом устройстве`;
}

/**
 * Коды отказа сервера, при которых облако настроено не до конца: в нём нет таблицы, колонки или функции (Postgres 42P01 / 42703 /
 * 42883; PostgREST PGRST202 / PGRST204 / PGRST205 — «нет в кэше схемы»). Повтор тех же данных не поможет, пока не выполнен
 * supabase/schema.sql. Известные «поздние» колонки (цели, погода, проценты) сюда не попадают: их ловит транспорт и отдаёт видом 'schema'.
 */
const BROKEN_CLOUD_CODES: ReadonlySet<string> = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

/** Сервер ответил отказом из-за того, что в облаке чего-то не хватает (а не из-за временной недоступности). */
export const isBrokenCloud = (e: TransportError): boolean => e.kind === 'server' && e.code !== undefined && BROKEN_CLOUD_CODES.has(e.code);

/**
 * Понятное человеку объяснение такого отказа. Подробность от сервера (она называет таблицу или колонку, данных пользователя в ней
 * нет) обрезается. Без точки в конце (её ставит текст статуса).
 */
export function describeBrokenCloud(e: TransportError): string {
  const detail = e.message.replace(/^Ошибка сервера(?: \(\d+\))?: /, '').replace(/\.+\s*$/, '').trim();
  const tail = detail === '' ? '' : `: ${detail.length > 160 ? `${detail.slice(0, 157)}…` : detail}`;
  return `В облаке не хватает таблицы или колонки (код ${e.code})${tail}. Выполните supabase/schema.sql целиком в SQL Editor`;
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

/**
 * Отправляет пачку; при отказе 'rejected' делит пополам и ищет виновных. При отказе 'schema' строки со значением в недостающей
 * колонке откладываются до обновления схемы (PushCtx.waiting), остальные отправляются. Остальные виды ошибок уходят наверх.
 */
async function pushBatch(ctx: PushCtx, table: SyncTableName, rows: readonly Row[], depth: number, stats: PushStats): Promise<void> {
  ctx.check();
  if (depth > 0) {
    if (ctx.budget.left <= 0) throw new BisectBudgetError();
    ctx.budget.left--;
  }
  // Каждая правка несёт версию сервера, поверх которой сделана (0 — строки на сервере ещё нет): если там уже записали
  // другое, сервер отвергнет пачку, и мы сначала заберём чужое и объединим (см. PushStats.conflicted).
  const wire = rows.map((r) => toWire(table, r as never, r.serverSeq ?? 0));
  try {
    await ctx.transport.push(table, wire);
  } catch (e) {
    if (e instanceof TransportError && e.kind === 'conflict') throw new ConflictSignal();
    if (e instanceof TransportError && e.kind === 'schema') {
      // Без колонки строку со значением не отправить, не потеряв его: ждёт на устройстве. Остальным колонка не нужна (пусто).
      const cols = e.columns ?? [];
      const held = wire.map((w) => cols.some((c) => w[c] !== null && w[c] !== undefined));
      if (!held.includes(true)) throw e;
      const waiting = ctx.waiting.get(table) ?? new Set<string>();
      rows.forEach((r, i) => held[i] && waiting.add(r.id));
      ctx.waiting.set(table, waiting);
      const rest = rows.filter((_, i) => !held[i]);
      if (rest.length > 0) await pushBatch(ctx, table, rest, depth + 1, stats);
      return;
    }
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
    // отложенные и ждущие схему строки снова придут в выборке (очередь идёт от старых к новым): просим на столько больше
    const want = PUSH_BATCH + skip.size + (ctx.waiting.get(table)?.size ?? 0);
    if (want > LIST_LIMIT_MAX) break;
    const dirty = (await ctx.store.sync.listDirty(table, want)) as unknown as Row[];
    const fresh = dirty.filter((r) => !skip.has(r.id) && !ctx.waiting.get(table)?.has(r.id));
    if (fresh.length === 0) break;
    const batch = dedupById(fresh).slice(0, PUSH_BATCH);

    const { ready, deferred, blocked } = await splitByParents(ctx, table, batch);
    for (const b of blocked) stats.quarantined += await ctx.store.sync.quarantine(table, [refOf(b.row)], b.message);
    for (const r of deferred) skip.add(r.id);
    if (ready.length > 0) await pushBatch(ctx, table, ready, 0, stats);
  }
  return skip.size;
}

/**
 * Отправляет всё, что ждёт, по таблицам в порядке зависимостей (родители раньше детей). Возвращает итоги.
 * Если сервер ответил 'conflict', отправка останавливается (conflicted = true): пачку с конфликтом сервер не записал, остальные
 * таблицы ждут — после получения чужих правок и слияния вызывающий отправит всё заново (см. engine.ts).
 */
export async function pushAll(ctx: PushCtx): Promise<PushStats> {
  const stats: PushStats = { sent: 0, quarantined: 0, conflicted: false };
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let deferred = 0;
      for (const table of SYNC_TABLES) deferred += await pushTable(ctx, table, stats);
      if (deferred === 0) break;
    }
  } catch (e) {
    if (!(e instanceof ConflictSignal)) throw e;
    stats.conflicted = true;
  }
  return stats;
}
