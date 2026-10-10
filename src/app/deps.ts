import type { SupabaseClient } from '@supabase/supabase-js';
import { FinoraDB, openStore, type Store } from '@/db';
import { apiProvider } from '@/rates/api';
import { nbtProvider } from '@/rates/nbt';
import { serverProvider, type RatesClient } from '@/rates/server';
import { createRateService } from '@/rates/service';
import { createRateStorage } from '@/rates/storage';
import type { RateProvider, RateService } from '@/rates/types';
import { createSyncEngine, type CreateSyncEngineOptions, type SyncEngine } from '@/sync/engine';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import type { SyncTransport } from '@/sync/transport';

/**
 * Всё, что приложение «берёт из внешнего мира» при сборке сеанса. В боевом коде — настоящее (defaultDeps),
 * в тестах — подмена (без сети и без настоящего сервера).
 */
export interface SessionDeps {
  /** Открыть локальную базу пользователя. */
  openStore(userId: string): Promise<Store>;
  createTransport(client: SupabaseClient): SyncTransport;
  createEngine(options: CreateSyncEngineOptions): SyncEngine;
  /** Сервис курсов. client — null в локальном режиме (тогда источник «сервер» не используется). */
  createRates(client: SupabaseClient | null): RateService;
  /** Физически удалить локальную базу пользователя с этого устройства. */
  deleteLocalData(userId: string): Promise<void>;
}

export function createDefaultRates(client: SupabaseClient | null): RateService {
  const providers: RateProvider[] = [];
  if (client) providers.push(serverProvider(client as unknown as RatesClient));
  providers.push(nbtProvider(), apiProvider());
  return createRateService({ providers, storage: createRateStorage() });
}

export const defaultDeps: SessionDeps = {
  openStore: (userId) => openStore(userId),
  createTransport: (client) => createSupabaseTransport(client),
  createEngine: (options) => createSyncEngine(options),
  createRates: createDefaultRates,
  async deleteLocalData(userId) {
    // Экземпляр базы нужен только для имени и удаления; открытые соединения Dexie закрывает сама.
    await new FinoraDB(userId).delete();
  },
};
