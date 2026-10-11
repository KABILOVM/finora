import { RATES_STORAGE_KEY, type RateStorage } from './types';

/** Минимум от localStorage — чтобы подставлять заглушку в тестах. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const clone = (v: unknown): unknown => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

/** Только память: живёт до перезагрузки страницы. Запасной вариант и основа для тестов. */
export function createMemoryRateStorage(initial?: unknown): RateStorage {
  let value = clone(initial);
  return {
    get: () => clone(value),
    set: (v) => {
      value = clone(v);
    },
  };
}

function globalLocalStorage(): StorageLike | null {
  try {
    const ls = globalThis.localStorage as StorageLike | undefined;
    if (!ls) return null;
    const probe = '__finora_probe__';
    ls.setItem(probe, '1');
    (ls as Storage).removeItem(probe);
    return ls;
  } catch {
    return null; // приватный режим, запрет на хранение, нет window
  }
}

/**
 * localStorage по ключу 'finora:rates:v1' + копия в памяти. Курсы не приватны, поэтому ключ общий для всех пользователей.
 * Если localStorage недоступен, переполнен или содержит битый JSON — молча работаем из памяти (курсы пропадут только
 * при перезагрузке, а при следующем обновлении подтянутся заново).
 */
export function createRateStorage(options: { key?: string; storage?: StorageLike | null } = {}): RateStorage {
  const key = options.key ?? RATES_STORAGE_KEY;
  const disk = options.storage === undefined ? globalLocalStorage() : options.storage;
  const memory = createMemoryRateStorage();
  // false после неудачной записи: диск отстал от памяти, поэтому читаем из памяти, пока запись снова не удастся
  let diskInSync = true;
  return {
    get() {
      if (disk && diskInSync) {
        try {
          const raw = disk.getItem(key);
          if (raw !== null) return JSON.parse(raw) as unknown;
        } catch {
          // битый JSON или доступ запрещён — берём память
        }
      }
      return memory.get();
    },
    set(value) {
      memory.set(value);
      if (!disk) return;
      try {
        disk.setItem(key, JSON.stringify(value));
        diskInSync = true;
      } catch {
        diskInSync = false;
      }
    },
    // событие «storage» приходит только в ДРУГИХ вкладках, поэтому на собственные записи не реагируем
    subscribe(listener) {
      const target = globalThis as Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>>;
      if (!disk || typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return () => {};
      const onStorage = (e: StorageEvent): void => {
        if (e.key === key || e.key === null) listener(); // null — localStorage очищен целиком
      };
      target.addEventListener('storage', onStorage);
      return () => target.removeEventListener?.('storage', onStorage);
    },
  };
}
