import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readCloudConfig, type CloudConfig } from './config';

/** Ключ, под которым supabase-js хранит сессию в localStorage. */
export const AUTH_STORAGE_KEY = 'finora-auth';

/**
 * Клиент Supabase. Сессия сохраняется на устройстве и сама обновляется; адрес страницы не разбираем
 * (входа по ссылке нет); Realtime не используем — только обычные запросы и вход по паролю.
 */
export function createFinoraClient(config: CloudConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
    },
  });
}

let cached: SupabaseClient | null | undefined;

/** Клиент по настройкам из окружения; null — облако не настроено (локальный режим). Создаётся один раз. */
export function getDefaultClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const config = readCloudConfig(import.meta.env as Record<string, unknown>);
  cached = config ? createFinoraClient(config) : null;
  return cached;
}
