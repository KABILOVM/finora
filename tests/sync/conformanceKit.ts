import { expect } from 'vitest';
import { TransportError, type SyncTransport } from '@/sync/transport';
import type { PulledRow, SyncTableName } from '@/sync/tables';
import { makeWallet } from './factories';

/**
 * Общий набор сценариев для ВСЕХ реализаций сервера синхронизации (PGlite, позже MemoryTransport).
 * Сценарии написаны против интерфейса SyncTransport; время берётся у сервера (harness.now()), а не из фабрик.
 */
export interface ServerHarness {
  /** Клиент от имени пользователя (пользователь заводится сам). */
  transportFor(userId: string): SyncTransport;
  /** Текущее время сервера. */
  now(): Date;
  /** Все строки таблицы в обход проверок доступа (если реализация это умеет). */
  adminRows?(table: SyncTableName): Promise<Record<string, unknown>[]>;
  /** Клиент без входа. Если не задан, сценарий 10 пропускается (и это видно в отчёте vitest). */
  signedOutTransport?(): SyncTransport;
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const iso = (ms: number): string => new Date(ms).toISOString();
export const must = <T>(v: T | null | undefined, what: string): T => {
  if (v === null || v === undefined) throw new Error(`нет значения: ${what}`);
  return v;
};
export const newId = (): string => makeWallet().id;
export const markerUuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** Забрать таблицу целиком постранично. */
export async function pullAll(t: SyncTransport, table: SyncTableName, afterSeq = 0, page = 500): Promise<PulledRow[]> {
  const out: PulledRow[] = [];
  let cur = afterSeq;
  for (;;) {
    const rows = await t.pull(table, cur, page);
    out.push(...rows);
    if (rows.length < page) return out;
    cur = must(rows[rows.length - 1], 'последняя строка страницы').server_seq;
  }
}

export const find = async (t: SyncTransport, table: SyncTableName, id: string): Promise<PulledRow | undefined> =>
  (await pullAll(t, table)).find((r) => r.id === id);

export async function failure(p: Promise<unknown>): Promise<TransportError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'ожидалась ошибка TransportError').toBeInstanceOf(TransportError);
  return err as TransportError;
}

export async function expectRejected(p: Promise<unknown>): Promise<void> {
  const err = await failure(p);
  expect(err.kind, err.message).toBe('rejected');
  expect(err.retryable).toBe(false);
}

export interface Stamp {
  clientUpdatedAt: string;
  deviceId: string;
  deletedAt?: string | null;
  createdAt?: string;
}
