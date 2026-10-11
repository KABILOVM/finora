/**
 * Случайный id установки приложения. Нужен, чтобы при равной метке времени два устройства
 * одинаково выбирали победителя (см. clientUpdatedAt + deviceId в domain/types.ts).
 * Хранится в localStorage; если он недоступен (приватный режим, запрет) — живёт в памяти до перезагрузки.
 */

export const DEVICE_ID_KEY = 'finora:deviceId';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

let memoryId: string | null = null;

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // доступ к localStorage сам может бросить исключение
  }
}

function isValidId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 8 && v.length <= 64 && !/\s/.test(v);
}

/** Возвращает id этой установки; создаёт при первом обращении. Параметр storage нужен только тестам. */
export function getDeviceId(storage: KeyValueStorage | null = defaultStorage()): string {
  if (storage) {
    try {
      const saved = storage.getItem(DEVICE_ID_KEY);
      if (isValidId(saved)) return saved;
      const fresh = randomId();
      storage.setItem(DEVICE_ID_KEY, fresh);
      return fresh;
    } catch {
      // хранилище не работает — падаем в запасной вариант ниже
    }
  }
  memoryId ??= randomId();
  return memoryId;
}
