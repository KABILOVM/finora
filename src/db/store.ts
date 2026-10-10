import type { DexieOptions } from 'dexie';
import { createCategoriesRepo, type CategoriesRepo } from './categoriesRepo';
import { createClock } from './clock';
import { FinoraDB, META_LAST_STAMP } from './database';
import { getDeviceId } from './deviceId';
import { ValidationError } from './errors';
import type { RepoContext } from './repoContext';
import { createSettingsRepo, type SettingsRepo } from './settingsRepo';
import { createSyncOps, type SyncOps } from './syncOps';
import { createTransactionsRepo, type TransactionsRepo } from './transactionsRepo';
import { createWalletsRepo, type WalletsRepo } from './walletsRepo';

export interface Store {
  readonly userId: string;
  readonly deviceId: string;
  readonly db: FinoraDB;
  readonly wallets: WalletsRepo;
  readonly categories: CategoriesRepo;
  readonly transactions: TransactionsRepo;
  readonly settings: SettingsRepo;
  readonly sync: SyncOps;
  /**
   * Подписка на локальные изменения: срабатывает после каждой записи через репозиторий, затравку или импорт
   * (синхронизатор по ней запускает отправку). На загрузку данных с сервера и на markPushed НЕ срабатывает.
   */
  onLocalChange(listener: () => void): () => void;
  close(): void;
}

/** Необязательные настройки открытия — для тестов и особых случаев; приложению они не нужны. */
export interface OpenStoreOptions {
  /** Id установки; по умолчанию берётся из localStorage (см. deviceId.ts). */
  deviceId?: string;
  /** Источник времени (мс) для часов. */
  now?: () => number;
  /** Параметры Dexie (например, другая реализация indexedDB). */
  dexie?: DexieOptions;
}

const contexts = new WeakMap<Store, RepoContext>();

/** Внутренний доступ к часам и уведомлениям для backup.ts. Не часть публичного API. */
export function internalContext(store: Store): RepoContext {
  const ctx = contexts.get(store);
  if (!ctx) throw new Error('Это не хранилище Finora: откройте его через openStore()');
  return ctx;
}

/** Просит браузер не вычищать данные при нехватке места. Отказ или отсутствие API — не ошибка. */
function requestPersistence(): void {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (storage && typeof storage.persist === 'function') {
      void Promise.resolve(storage.persist()).catch(() => undefined);
    }
  } catch {
    // недоступно (например, в тестах)
  }
}

export async function openStore(userId: string, options: OpenStoreOptions = {}): Promise<Store> {
  if (typeof userId !== 'string' || userId.trim() === '' || userId.length > 128 || /[\u0000-\u001f]/.test(userId)) {
    throw new ValidationError('Не удалось открыть данные: некорректный идентификатор пользователя');
  }
  const deviceId = options.deviceId ?? getDeviceId();
  const db = new FinoraDB(userId, options.dexie);
  try {
    await db.open();
  } catch (e) {
    db.close();
    throw new Error(`Не удалось открыть локальную базу данных: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  requestPersistence();

  const savedStamp = (await db.meta.get(META_LAST_STAMP))?.value;
  const clock = createClock({
    deviceId,
    now: options.now,
    load: () => (typeof savedStamp === 'string' ? savedStamp : null),
    save: (stamp) => db.meta.put({ key: META_LAST_STAMP, value: stamp }),
  });

  const listeners = new Set<() => void>();
  let closed = false;
  const notify = () => {
    if (closed) return;
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // ошибка подписчика не должна ломать запись
      }
    }
  };

  const ctx: RepoContext = { userId, deviceId, db, clock, notify };
  const store: Store = {
    userId,
    deviceId,
    db,
    wallets: createWalletsRepo(ctx),
    categories: createCategoriesRepo(ctx),
    transactions: createTransactionsRepo(ctx),
    settings: createSettingsRepo(ctx),
    sync: createSyncOps(db, clock),
    onLocalChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
      db.close();
    },
  };
  contexts.set(store, ctx);
  return store;
}
