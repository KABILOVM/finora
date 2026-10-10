import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, vi } from 'vitest';
import { ensureSeeded, exportBackup, openStore, type Store } from '@/db';
import { createSyncEngine, type CreateSyncEngineOptions, type SyncEngine } from '@/sync/engine';
import type { MemoryServer } from '@/sync/memoryServer';
import type { PulledRow, SyncTableName, WireRow } from '@/sync/tables';
import { TransportError, type SyncTransport } from '@/sync/transport';

/** Общие помощники для тестов движка: «устройства» с отдельными базами, ожидание без таймеров, шпион над транспортом. */

export const USER = '11111111-1111-4111-8111-111111111111';

export interface Device {
  deviceId: string;
  store: Store;
  engine: SyncEngine;
  /** Транспорт, как его видит движок (возможно, обёрнутый). */
  transport: SyncTransport;
}

const opened: Array<{ store: Store; engine: SyncEngine }> = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (opened.length) {
    const d = opened.pop();
    d?.engine.dispose();
    d?.store.close();
  }
});

export interface OpenDeviceOptions {
  userId?: string;
  /** Часы устройства (мс). По умолчанию настоящее время. */
  now?: () => number;
  /** Обернуть транспорт (шпион, сбои, разбор ответа). */
  wrap?: (inner: SyncTransport) => SyncTransport;
  engine?: Partial<Omit<CreateSyncEngineOptions, 'store' | 'transport'>>;
  /** Затравка после первой загрузки (как в приложении): настройки, «Наличные», категории. */
  seed?: boolean;
  /** Готовый транспорт вместо сервера в памяти (например, supabase-js + эмулятор PostgREST). Тогда server можно не передавать (null). */
  transport?: SyncTransport;
  /** Своя «браузерная» база; передать прежнюю, чтобы открыть те же данные заново (перезапуск приложения). */
  factory?: IDBFactory;
}

/** Новое устройство: своя IndexedDB, свой движок (НЕ запущен — start() вызывает тест). */
export async function openDevice(server: MemoryServer | null, deviceId: string, o: OpenDeviceOptions = {}): Promise<Device> {
  const userId = o.userId ?? USER;
  const store = await openStore(userId, {
    deviceId,
    now: o.now,
    dexie: { indexedDB: o.factory ?? new IDBFactory(), IDBKeyRange },
  });
  return assemble(server, store, deviceId, userId, o);
}

function assemble(server: MemoryServer | null, store: Store, deviceId: string, userId: string, o: OpenDeviceOptions): Device {
  const inner = o.transport ?? (server ?? fail('нужен сервер или transport')).transportFor(userId);
  const transport = o.wrap ? o.wrap(inner) : inner;
  const afterFirstPull = o.seed ? async () => void (await ensureSeeded(store)) : undefined;
  const engine = createSyncEngine({ store, transport, now: o.now, afterFirstPull, ...o.engine });
  opened.push({ store, engine });
  return { deviceId, store, engine, transport };
}

function fail(message: string): never {
  throw new Error(message);
}

const nextTurn = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Ждёт условия, отдавая управление циклу событий (setImmediate, его vitest не подменяет).
 * Работает и с настоящими, и с поддельными таймерами: время не используется, только число оборотов.
 */
export async function until(pred: () => boolean | Promise<boolean>, what = 'условие', turns = 4000): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (await pred()) return;
    await nextTurn();
  }
  throw new Error(`не дождались: ${what}`);
}

/** Дать всему, что уже запущено, закончиться (и ещё немного, чтобы лишние запросы успели проявиться). */
export async function settle(turns = 60): Promise<void> {
  for (let i = 0; i < turns; i++) await nextTurn();
}

export interface Gate {
  /** Пропустить застрявший запрос. */
  open(): void;
  /** Запрос дошёл до ворот. */
  entered: Promise<void>;
}

export interface Call {
  /** Date.now() в момент вызова (с поддельными таймерами — поддельное время). */
  at: number;
  op: 'pull' | 'push';
  table: SyncTableName;
  /** push: сколько строк; pull: курс. */
  size: number;
  ids?: string[];
}

export interface Spy {
  transport: SyncTransport;
  calls: Call[];
  pushes(table?: SyncTableName): Call[];
  pulls(table?: SyncTableName): Call[];
  /** Очередной push остановится в воротах до gate.open() (строки к этому моменту уже прочитаны движком из базы). */
  holdNextPush(): Gate;
  /** Хук перед каждым push: может бросить ошибку. */
  onPush?: (table: SyncTableName, rows: WireRow[]) => Promise<void> | void;
  /** Хук над ответом pull: может подменить строки (и сделать что угодно, пока запрос «в пути»). */
  onPull?: (table: SyncTableName, afterSeq: number, rows: PulledRow[]) => PulledRow[] | Promise<PulledRow[]>;
  /** Сервер ПРИНЯЛ данные, но ответ потерялся: следующие n вызовов push применяются, а затем бросают сетевую ошибку. */
  loseResponses: number;
}

export function spy(inner: SyncTransport): Spy {
  const calls: Call[] = [];
  const holds: Array<{ enter: () => void; gate: Promise<void> }> = [];
  const s: Spy = {
    calls,
    loseResponses: 0,
    pushes: (table) => calls.filter((c) => c.op === 'push' && (table === undefined || c.table === table)),
    pulls: (table) => calls.filter((c) => c.op === 'pull' && (table === undefined || c.table === table)),
    holdNextPush() {
      let open!: () => void;
      let enter!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      const entered = new Promise<void>((r) => (enter = r));
      holds.push({ enter, gate });
      return { open, entered };
    },
    transport: {
      async pull(table, afterSeq, limit) {
        calls.push({ at: Date.now(), op: 'pull', table, size: afterSeq });
        const rows = await inner.pull(table, afterSeq, limit);
        return s.onPull ? s.onPull(table, afterSeq, rows) : rows;
      },
      async push(table, rows) {
        calls.push({ at: Date.now(), op: 'push', table, size: rows.length, ids: rows.map((r) => String(r['id'])) });
        const hold = holds.shift();
        if (hold) {
          hold.enter();
          await hold.gate;
        }
        if (s.onPush) await s.onPush(table, rows);
        await inner.push(table, rows);
        if (s.loseResponses > 0) {
          s.loseResponses--;
          throw new TransportError('network', 'Ответ потерялся (имитация)');
        }
      },
    },
  };
  return s;
}

/** Все данные устройства в каноничном виде (резервная копия без времени экспорта). */
export async function snapshotOf(store: Store) {
  const b = await exportBackup(store);
  return { settings: b.settings, wallets: b.wallets, categories: b.categories, transactions: b.transactions };
}

export const fakeTimers = (): void => {
  // setImmediate НЕ подменяем: на нём работает fake-indexeddb
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
};
