import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncTransport } from './transport';

export interface SupabaseTransportOptions {
  /** Таймаут одного запроса, мс. По умолчанию 15000. */
  timeoutMs?: number;
}

// ЗАГЛУШКА-КОНТРАКТ: настоящая реализация заменит этот файл (исполнитель модуля «sync»).
export function createSupabaseTransport(_client: SupabaseClient, _opts?: SupabaseTransportOptions): SyncTransport {
  throw new Error('createSupabaseTransport: ещё не реализован');
}
