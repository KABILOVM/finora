import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useOptionalStore } from '@/db';
import type { SyncEngineApi, SyncStatus } from './transport';

/**
 * Связка движка синхронизации с интерфейсом. ДОГОВОР: экспорты и их смысл не менять.
 *  - engine === null — «локальный режим» (облако не настроено или не вошли): синхронизации нет, и интерфейс
 *    не должен рисовать «Синхронизировано». Проверять через useSyncEnabled().
 *  - Провайдер запускает движок при монтировании и останавливает при размонтировании.
 *  - engine.getStatus() обязан возвращать ОДИН И ТОТ ЖЕ объект, пока статус не изменился
 *    (иначе useSyncExternalStore зациклится).
 */

const LOCAL_STATUS: SyncStatus = { phase: 'idle', pending: 0, quarantined: 0, lastSyncedAt: null, lastError: null };
const noopSubscribe = () => () => undefined;
const getLocalStatus = () => LOCAL_STATUS;

const SyncContext = createContext<SyncEngineApi | null>(null);

export function SyncProvider({ engine, children }: { engine: SyncEngineApi | null; children: ReactNode }) {
  useEffect(() => {
    if (!engine) return undefined;
    engine.start();
    return () => engine.stop();
  }, [engine]);
  return <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>;
}

/**
 * Текущий статус синхронизации. В локальном режиме — нейтральный статус (см. useSyncEnabled).
 * Очередь («ждут отправки», «не принято сервером») берётся не меньшей, чем в самой базе: соседняя вкладка того же устройства
 * пишет в ту же базу своим хранилищем, и движок этой вкладки об её записи не знает. Без этого бейдж писал бы «Синхронизировано»
 * при неотправленной записи. Меньше, чем насчитал движок, число не становится.
 */
export function useSyncStatus(): SyncStatus {
  const engine = useContext(SyncContext);
  const store = useOptionalStore();
  const status = useSyncExternalStore(
    engine ? (cb) => engine.subscribe(cb) : noopSubscribe,
    engine ? () => engine.getStatus() : getLocalStatus,
  );
  const queue = useLiveQuery(() => (engine && store ? store.sync.counts() : undefined), [engine, store]);
  return useMemo(() => {
    if (!queue || (queue.pending <= status.pending && queue.quarantined <= status.quarantined)) return status;
    return { ...status, pending: Math.max(status.pending, queue.pending), quarantined: Math.max(status.quarantined, queue.quarantined) };
  }, [status, queue]);
}

/** false в локальном режиме: данные есть только на этом устройстве. */
export function useSyncEnabled(): boolean {
  return useContext(SyncContext) !== null;
}

/** Ручной запуск («Синхронизировать сейчас»). В локальном режиме — пустышка. */
export function useSyncNow(): () => Promise<void> {
  const engine = useContext(SyncContext);
  return () => (engine ? engine.syncNow('manual') : Promise.resolve());
}
