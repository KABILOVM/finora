import {
  SERVER_COLUMNS,
  checkConstraints,
  checkForeignKeys,
  coerceRow,
  formatTimestamp,
  rejected,
  type Rec,
} from './memoryRules';
import { SYNC_TABLES, TABLE_SPECS, type PulledRow, type SyncTableName, type WireRow } from './tables';
import type { SessionAwareTransport } from './session';
import { TransportError, type SyncTransport, type TransportErrorKind } from './transport';

/**
 * Сервер в памяти, повторяющий семантику supabase/schema.sql (LWW, зажим меток, server_seq, изоляция пользователей, отказ пачки целиком).
 * Нужен для тестов, демо-режима и сценариев отказов. Обязан проходить tests/sync/conformance.ts.
 */
export interface MemoryServer {
  /** Транспорт от имени пользователя (как боевой, умеет сказать, чей у него токен). */
  transportFor(userId: string): SessionAwareTransport;
  /** Транспорт «без входа»: pull/push бросают TransportError('auth'). */
  signedOutTransport(): SyncTransport;
  /** false — любой запрос бросает TransportError('network'). */
  setOnline(online: boolean): void;
  /** Следующие `times` запросов (по умолчанию 1) падают с ошибкой указанного вида. */
  failNext(kind: TransportErrorKind, times?: number): void;
  /** Задержка ответа, мс (для тестов гонок). */
  setLatency(ms: number): void;
  /** Содержимое таблицы пользователя (для проверок), по возрастанию server_seq. */
  dump(userId: string, table: SyncTableName): PulledRow[];
  /** Текущее серверное время. */
  now(): Date;
}

export interface MemoryServerOptions {
  now?: () => number;
}

const FIVE_MINUTES = 5 * 60_000;

/** Строка в хранилище: неизменяемая (правка заменяет объект целиком). */
interface Stored {
  readonly userId: string;
  readonly seq: number;
  readonly updatedMs: number;
  readonly data: Rec;
}

/** Таблица целиком (id уникален глобально, как первичный ключ в схеме) + порядок по server_seq. */
class TableStore {
  private readonly byId = new Map<string, Stored>();
  /** Версии строк в порядке записи; замещённые версии отсеиваются лениво. */
  private order: Stored[] = [];
  private stale = 0;

  get(id: string): Stored | undefined {
    return this.byId.get(id);
  }

  put(id: string, row: Stored): void {
    if (this.byId.has(id)) this.stale++;
    this.byId.set(id, row);
    this.order.push(row);
  }

  /** Строки пользователя с seq > after, по возрастанию, не больше limit. */
  select(userId: string, after: number, limit: number): Stored[] {
    if (this.stale > 0) {
      this.order = this.order.filter((r) => this.byId.get(String(r.data['id'])) === r);
      this.stale = 0;
    }
    // order отсортирован по seq (записи идут в порядке выдачи номеров): ищем первую строку с seq > after бинарным поиском
    let lo = 0;
    let hi = this.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.order[mid] as Stored).seq > after) hi = mid;
      else lo = mid + 1;
    }
    const out: Stored[] = [];
    for (let i = lo; i < this.order.length && out.length < limit; i++) {
      const r = this.order[i] as Stored;
      if (r.userId === userId) out.push(r);
    }
    return out;
  }
}

/** Строка для выдачи: как отдаёт PostgREST (числа — числами, время — строкой с «+00:00»). */
function emit(table: SyncTableName, r: Stored): PulledRow {
  const out: WireRow = {};
  for (const c of TABLE_SPECS[table].columns) {
    const v = r.data[c.column] ?? null;
    out[c.column] = c.type === 'ts' && typeof v === 'number' ? formatTimestamp(v) : v;
  }
  out['user_id'] = r.userId;
  out['server_seq'] = r.seq;
  out['server_updated_at'] = formatTimestamp(r.updatedMs);
  return out as PulledRow;
}

/** Сравнение device_id по кодам символов, как collate "C" (не по правилам языка). */
function compareDevice(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const FAIL_TEXT: Record<TransportErrorKind, { message: string; code?: string }> = {
  network: { message: 'Нет связи с сервером (имитация сбоя)' },
  auth: { message: 'JWT expired (имитация сбоя)', code: 'PGRST301' },
  rejected: { message: 'Сервер отверг запрос (имитация сбоя)', code: '23514' },
  server: { message: 'Сервер недоступен (имитация сбоя)', code: '500' },
};

export function createMemoryServer(opts: MemoryServerOptions = {}): MemoryServer {
  const clock = opts.now ?? Date.now;
  const tables = Object.fromEntries(SYNC_TABLES.map((t) => [t, new TableStore()])) as Record<SyncTableName, TableStore>;
  /** Журнал «меток из будущего» (private.sync_future_stamps): ключ → метка, присвоенная при первой встрече. */
  const futureLedger = new Map<string, number>();
  let seqCounter = 0;
  let online = true;
  let latencyMs = 0;
  const failures: TransportErrorKind[] = [];

  /** Запрос дошёл до сервера: сеть, имитация сбоя. Дальше сервер работает синхронно (запрос атомарен). */
  function arrive(): void {
    if (!online) throw new TransportError('network', 'Нет связи с сервером (сервер в памяти выключен)');
    const kind = failures.shift();
    if (kind !== undefined) {
      const t = FAIL_TEXT[kind];
      throw new TransportError(kind, t.message, t.code);
    }
  }

  /** Ответ уходит с задержкой: сервер уже сделал дело (как в жизни), клиент ждёт ответа. */
  async function respond(): Promise<void> {
    if (latencyMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
    else await Promise.resolve();
  }

  /** Метка правки, как её хранит сервер (private.sync_stamp). staged — записи журнала этой пачки, ещё не зафиксированные. */
  function stampFor(
    userId: string,
    table: SyncTableName,
    id: string,
    device: string,
    rawMs: number,
    limitMs: number,
    staged: Map<string, number>,
  ): number {
    const key = `${userId}|${table}|${id}|${device}|${rawMs}`;
    const seen = staged.get(key) ?? futureLedger.get(key);
    if (seen !== undefined) return seen;
    if (rawMs <= limitMs) return rawMs;
    if ([...device].length <= 64) staged.set(key, limitMs);
    return limitMs;
  }

  function push(userId: string, table: SyncTableName, rows: WireRow[]): void {
    if (!(SYNC_TABLES as readonly string[]).includes(table)) throw new TypeError(`Неизвестная таблица: ${String(table)}`);
    if (!Array.isArray(rows)) throw new TypeError('rows: ожидался массив');
    if (rows.length === 0) return;

    // Как PostgREST: колонки — объединение ключей пачки; неизвестная колонка отвергает запрос до базы.
    const known = new Set<string>([...TABLE_SPECS[table].columns.map((c) => c.column), ...SERVER_COLUMNS]);
    const batchCols = new Set<string>();
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new TransportError('server', 'Тело запроса: ожидался массив объектов', 'PGRST102');
      }
      for (const k of Object.keys(row)) {
        if (!known.has(k)) throw new TransportError('server', `Could not find the '${k}' column of '${table}' in the schema cache`, 'PGRST204');
        batchCols.add(k);
      }
    }

    // Дальше — «одна транзакция»: всё считаем в черновике и фиксируем, только если ни одна строка не отвергнута.
    // Порядок проверок такой же, как у Postgres: каждая строка по очереди (типы → триггер → NOT NULL/CHECK → конфликт),
    // а внешние ключи проверяются в самом конце оператора.
    const limitMs = clock() + FIVE_MINUTES;
    const nowMs = clock();
    const stagedLedger = new Map<string, number>();
    const stagedRows = new Map<string, Stored>();
    const touched = new Set<string>(); // строки, которые этот оператор уже вставил или изменил
    const stagedOf = (id: string): Stored | undefined => stagedRows.get(id) ?? tables[table].get(id);
    const parentExists = (parent: 'wallets' | 'categories', uid: string, id: string): boolean => tables[parent].get(id)?.userId === uid;
    const store = tables[table];
    const foreignKeyChecks: Array<() => void> = [];

    for (const wire of rows) {
      const incoming = coerceRow(table, wire);
      const id = String(incoming['id']);
      const device = String(incoming['device_id']);

      // 1) триггер на вставку: user_id ставит сервер, метки зажимаются, номер выдаётся (даже если дальше сработает конфликт)
      const proposed: Rec = { ...incoming };
      const createdMs = Math.min(Number(proposed['created_at']), limitMs);
      proposed['created_at'] = createdMs;
      proposed['client_updated_at'] = stampFor(userId, table, id, device, Number(proposed['client_updated_at']), limitMs, stagedLedger);
      seqCounter++;

      // 2) проверки на предложенную строку выполняются ДО разбора конфликта
      checkConstraints(table, proposed, userId);

      const existing = stagedOf(id);
      if (!existing) {
        foreignKeyChecks.push(() => checkForeignKeys(table, proposed, userId, parentExists));
        stagedRows.set(id, { userId, seq: seqCounter, updatedMs: nowMs, data: proposed });
        touched.add(id);
        continue;
      }

      // 3) конфликт по id: чужую строку менять нельзя (политика RLS даёт ошибку, а не молчаливый пропуск)
      if (existing.userId !== userId) {
        throw rejected(`new row violates row-level security policy (USING expression) for table "${table}"`, '42501');
      }
      // две строки пачки с одним id: Postgres отвергает оператор, если строку уже трогала эта же команда
      if (touched.has(id)) throw rejected('ON CONFLICT DO UPDATE command cannot affect row a second time', '21000');

      // 4) триггер на правку: DO UPDATE SET берёт значения предложенной строки по всем колонкам пачки, кроме id
      const next: Rec = { ...existing.data };
      for (const c of TABLE_SPECS[table].columns) {
        if (c.column !== 'id' && batchCols.has(c.column)) next[c.column] = proposed[c.column] ?? null;
      }
      next['created_at'] = existing.data['created_at'] ?? null;
      next['client_updated_at'] = stampFor(userId, table, id, device, Number(next['client_updated_at']), limitMs, stagedLedger);
      const oldStamp = Number(existing.data['client_updated_at']);
      const newStamp = Number(next['client_updated_at']);
      const oldDevice = String(existing.data['device_id']);
      if (newStamp < oldStamp || (newStamp === oldStamp && compareDevice(String(next['device_id']), oldDevice) <= 0)) {
        continue; // устаревшая правка или повтор: строка не меняется, ошибки нет
      }
      checkConstraints(table, next, userId);
      foreignKeyChecks.push(() => checkForeignKeys(table, next, userId, parentExists));
      seqCounter++;
      stagedRows.set(id, { userId, seq: seqCounter, updatedMs: nowMs, data: next });
      touched.add(id);
    }
    for (const check of foreignKeyChecks) check();

    // Фиксация. Номера внутри пачки уже возрастают; в хранилище строки кладём в порядке номеров.
    for (const [key, value] of stagedLedger) futureLedger.set(key, value);
    const toWrite = [...stagedRows.entries()].sort((a, b) => a[1].seq - b[1].seq);
    for (const [id, row] of toWrite) store.put(id, row);
  }

  function pull(userId: string, table: SyncTableName, afterSeq: number, limit: number): PulledRow[] {
    if (!(SYNC_TABLES as readonly string[]).includes(table)) throw new TypeError(`Неизвестная таблица: ${String(table)}`);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new RangeError(`afterSeq: ${afterSeq}`);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`limit: ${limit}`);
    return tables[table].select(userId, afterSeq, limit).map((r) => emit(table, r));
  }

  const normalizeUser = (userId: string): string => {
    if (typeof userId !== 'string' || userId.trim() === '') throw new TypeError('userId: ожидалась непустая строка');
    return userId.toLowerCase();
  };

  return {
    transportFor(userId) {
      const uid = normalizeUser(userId);
      return {
        currentUserId: async () => uid,
        async pull(table, afterSeq, limit) {
          arrive();
          const rows = pull(uid, table, afterSeq, limit);
          await respond();
          return rows;
        },
        async push(table, rows) {
          if (Array.isArray(rows) && rows.length === 0) return; // пустая пачка — пустой запрос, сервер не трогаем
          arrive();
          push(uid, table, rows);
          await respond();
        },
      };
    },

    signedOutTransport() {
      const refuse = async (): Promise<never> => {
        arrive();
        await respond();
        throw new TransportError('auth', 'Нужно войти в систему', '28000');
      };
      return { pull: refuse, push: refuse };
    },

    setOnline(value) {
      online = value;
    },

    failNext(kind, times = 1) {
      if (!Number.isInteger(times) || times < 1) throw new RangeError(`times: ожидалось целое от 1, получено ${times}`);
      for (let i = 0; i < times; i++) failures.push(kind);
    },

    setLatency(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`ms: ожидалось неотрицательное число, получено ${ms}`);
      latencyMs = ms;
    },

    dump(userId, table) {
      return tables[table].select(normalizeUser(userId), 0, Number.MAX_SAFE_INTEGER).map((r) => emit(table, r));
    },

    now: () => new Date(clock()),
  };
}
