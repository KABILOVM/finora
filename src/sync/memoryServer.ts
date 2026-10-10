import type { PulledRow, SyncTableName } from './tables';
import type { SyncTransport, TransportErrorKind } from './transport';

/**
 * Сервер в памяти, повторяющий семантику supabase/schema.sql (LWW, зажим меток, server_seq, изоляция пользователей, отказ пачки целиком).
 * Нужен для тестов, демо-режима и сценариев отказов. Обязан проходить tests/sync/conformance.ts.
 */
export interface MemoryServer {
  /** Транспорт от имени пользователя. */
  transportFor(userId: string): SyncTransport;
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

// ЗАГЛУШКА-КОНТРАКТ: настоящая реализация заменит этот файл (исполнитель модуля «sync»).
export function createMemoryServer(_opts?: MemoryServerOptions): MemoryServer {
  throw new Error('createMemoryServer: ещё не реализован');
}
