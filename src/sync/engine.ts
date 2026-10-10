import type { Store } from '@/db';
import type { SyncEngineApi, SyncTransport } from './transport';

/** Ключ в store.sync.getMeta/setMeta: true после первого успешного полного получения данных с сервера. */
export const META_INITIAL_PULL = 'initialPullDone';

export interface CreateSyncEngineOptions {
  store: Store;
  transport: SyncTransport;
  /**
   * Вызывается ОДИН РАЗ после первого успешного полного получения данных с сервера (до первой отправки).
   * Здесь приложение делает затравку (ensureSeeded): только теперь известно, есть ли у пользователя данные на сервере.
   * Если колбэк бросил ошибку — META_INITIAL_PULL не ставится, при следующем цикле всё повторится.
   */
  afterFirstPull?: () => Promise<void>;
  /** Просьба обновить сессию, когда сервер ответил 'auth'. true — сессия обновлена, цикл можно повторить. */
  onAuthError?: () => Promise<boolean>;
  now?: () => number;
}

export interface SyncEngine extends SyncEngineApi {
  /** Полная остановка: снимает все слушатели и таймеры. После dispose engine использовать нельзя. */
  dispose(): void;
}

// ЗАГЛУШКА-КОНТРАКТ: настоящая реализация заменит этот файл (исполнитель модуля «sync»).
export function createSyncEngine(_opts: CreateSyncEngineOptions): SyncEngine {
  throw new Error('createSyncEngine: ещё не реализован');
}
