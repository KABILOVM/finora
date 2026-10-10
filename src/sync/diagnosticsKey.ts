/**
 * Какой ключ Supabase лежит в сборке приложения (VITE_SUPABASE_ANON_KEY).
 * В браузер можно отдавать только публичный ключ (anon / publishable). Секретный (service_role / sb_secret_) открывает
 * всю базу в обход защиты строк, а всё, что есть в VITE_*, вшивается в публичные файлы сайта.
 * Сам ключ никуда не записывается и в сообщения не попадает: наружу идёт только его вид.
 */

export type ApiKeyKind = 'public' | 'secret' | 'unknown';

/** Роль из JWT старого образца (anon key / service_role key); null, если это не JWT. */
function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const b64 = (parts[1] as string).replace(/-/g, '+').replace(/_/g, '/');
    const json: unknown = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    const role = typeof json === 'object' && json !== null ? (json as { role?: unknown }).role : undefined;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

/** Вид ключа: 'secret' — нельзя держать в приложении; 'public' — можно; 'unknown' — определить не удалось (ничего не утверждаем). */
export function classifyApiKey(key: unknown): ApiKeyKind {
  if (typeof key !== 'string') return 'unknown';
  const k = key.trim();
  if (k.startsWith('sb_secret_')) return 'secret';
  if (k.startsWith('sb_publishable_')) return 'public';
  const role = jwtRole(k);
  if (role === 'service_role') return 'secret';
  if (role === 'anon') return 'public';
  return 'unknown';
}

/** Сообщение для шага «Связь с сервером»; null — тревожиться не о чем. */
export function secretKeyMessage(key: unknown): string | null {
  if (classifyApiKey(key) !== 'secret') return null;
  return (
    'ОПАСНО: в VITE_SUPABASE_ANON_KEY лежит секретный ключ (service_role). Он открывает всю базу в обход защиты, ' +
    'а значения VITE_* вшиваются в публичные файлы сайта: любой, кто откроет сайт, может прочитать и изменить все данные. ' +
    'Что сделать: в Supabase (Project Settings → API) возьмите публичный ключ (anon или publishable), вставьте его в ' +
    'VITE_SUPABASE_ANON_KEY (на хостинге и в .env) и пересоберите приложение. Если сайт с этим ключом уже был выложен, ' +
    'считайте ключ утёкшим и замените его в той же панели Supabase.'
  );
}
