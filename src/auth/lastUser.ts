import { isSafeUserId, type AuthUser } from './config';

/** Кто последним вошёл на этом устройстве. Нужен, чтобы без сети открыть ЕГО локальные данные. */
export const LAST_USER_KEY = 'finora:lastUser';

export function readLastUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { id, email } = parsed as { id?: unknown; email?: unknown };
    if (!isSafeUserId(id)) return null;
    return { id, email: typeof email === 'string' ? email : '' };
  } catch {
    return null; // хранилище недоступно или запись повреждена
  }
}

export function writeLastUser(user: AuthUser): void {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify({ id: user.id, email: user.email }));
  } catch {
    // приватный режим / переполнение: без запоминания офлайн-старт будет недоступен, но вход работает
  }
}

export function clearLastUser(): void {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // нечего очищать
  }
}
