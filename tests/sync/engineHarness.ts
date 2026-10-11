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

/**
 * НАСТОЯЩИЕ часы и таймер, снятые при загрузке помощника — до того, как тест включит поддельные таймеры (fakeTimers, vi.useFakeTimers).
 * Ожидание условий обязано ограничиваться НАСТОЯЩИМ временем, а не числом оборотов цикла событий: часть работы идёт вне цикла
 * (см. «Незавершённые дайджесты» ниже), и на загруженной машине тысяча оборотов пролетает за 20 мс, а такая работа не успевает.
 */
const realNow = performance.now.bind(performance);
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

/** Сколько настоящих миллисекунд ждём условие по умолчанию (тест целиком ограничен testTimeout в vite.config.ts — 20 с). */
const WAIT_MS = 15_000;

/**
 * Незавершённые дайджесты WebCrypto. Приложение считает id затравки через crypto.subtle.digest (src/db/ids.ts), а он в Node выполняется
 * в пуле потоков, ВНЕ цикла событий: сколько оборотов (setImmediate) пройдёт до его ответа, зависит от загрузки машины
 * (проверено: от 1 до ~1000 оборотов на один вызов; затравка делает их несколько подряд). Поэтому счётчик оборотов не годится
 * как «подождать, пока всё закончится»: помощник считает дайджесты в пути и ждёт их по-настоящему. Сам дайджест не подменяется.
 */
let digestsInFlight = 0;
{
  const subtle = globalThis.crypto?.subtle as (SubtleCrypto & { __counted?: true }) | undefined;
  if (subtle && typeof subtle.digest === 'function' && !subtle.__counted) {
    const real = subtle.digest.bind(subtle);
    const counted = ((...args: Parameters<SubtleCrypto['digest']>) => {
      digestsInFlight++;
      const p = real(...args);
      const done = (): void => void digestsInFlight--;
      p.then(done, done);
      return p;
    }) as SubtleCrypto['digest'];
    subtle.digest = counted;
    subtle.__counted = true;
  }
}

const nextTurn = (): Promise<void> => new Promise((r) => setImmediate(r));
/** Короткая НАСТОЯЩАЯ пауза: отдаёт процессор остальным потокам (пул потоков, другие тесты), чтобы ожидание не крутилось вхолостую. */
const realPause = (): Promise<void> => new Promise((r) => realSetTimeout(r, 1));

/**
 * Ждёт условия, отдавая управление циклу событий (setImmediate, его vitest не подменяет), но не дольше timeoutMs НАСТОЯЩЕГО
 * времени (производительность `performance.now` fakeTimers() не трогает). Работает и с настоящими, и с поддельными таймерами:
 * поддельное время не используется.
 */
export async function until(pred: () => boolean | Promise<boolean>, what = 'условие', timeoutMs = WAIT_MS): Promise<void> {
  const deadline = realNow() + timeoutMs;
  for (let i = 0; ; i++) {
    if (await pred()) return;
    if (realNow() > deadline) throw new Error(`не дождались: ${what} (${timeoutMs} мс настоящего времени)`);
    await (i % 64 === 63 ? realPause() : nextTurn());
  }
}

/**
 * Дать всему, что уже запущено, закончиться (и ещё немного, чтобы лишние запросы успели проявиться): проходит `turns` оборотов
 * подряд, в которых нет дайджестов в пути. Дайджест в пути обнуляет счёт — он ещё продолжит работу (запись затравки и т. д.).
 */
export async function settle(turns = 60, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = realNow() + timeoutMs;
  for (let quiet = 0; quiet < turns; ) {
    if (digestsInFlight > 0) {
      quiet = 0;
      if (realNow() > deadline) throw new Error(`не дождались: окончания дайджестов (${timeoutMs} мс настоящего времени)`);
      await realPause();
    } else {
      quiet++;
      await nextTurn();
    }
  }
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
