/**
 * Настройки облака. Берутся из переменных окружения Vite (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
 * Нет настроек — приложение работает в ЛОКАЛЬНОМ РЕЖИМЕ: один пользователь на устройстве, без входа и синхронизации.
 */

export interface CloudConfig {
  url: string;
  anonKey: string;
}

/** Фиксированный пользователь локального режима. От его id зависит имя локальной базы — менять нельзя. */
export const LOCAL_USER_ID = 'local-device';

export interface AuthUser {
  id: string;
  email: string;
}

export const LOCAL_USER: AuthUser = { id: LOCAL_USER_ID, email: '' };

/** Значения из .env.example: если их оставили как есть, облака на самом деле нет. */
const PLACEHOLDER = /YOUR-PROJECT-REF|xxx/i;

export interface EnvLike {
  VITE_SUPABASE_URL?: unknown;
  VITE_SUPABASE_ANON_KEY?: unknown;
}

/**
 * Читает настройки облака. Возвращает null, если их нет или они явно неверны (не адрес https/http, пустой ключ,
 * заготовка из .env.example): тогда приложение честно работает локально, а не падает при первом запросе.
 */
export function readCloudConfig(env: EnvLike): CloudConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
  if (url === '' || anonKey === '') return null;
  if (PLACEHOLDER.test(url) || PLACEHOLDER.test(anonKey)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ''), anonKey };
}

/** Безопасный для openStore идентификатор пользователя: непустой, не длиннее 128, без управляющих символов. */
export function isSafeUserId(id: unknown): id is string {
  return typeof id === 'string' && id.trim() !== '' && id.length <= 128 && !/[\u0000-\u001f]/.test(id);
}
