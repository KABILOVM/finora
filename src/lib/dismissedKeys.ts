import { useCallback, useSyncExternalStore } from 'react';

/**
 * «Скрыть» для подсказок интерфейса: список ключей, которые человек убрал, хранится на этом устройстве (localStorage) отдельно для
 * каждого человека и каждого вида подсказок. В облако не уходит, поэтому на другом устройстве подсказка может появиться ещё раз.
 * Если хранилище недоступно (приватный режим, переполнено), скрытое помнится до перезагрузки страницы.
 */

/** Сколько ключей помним: старые вытесняются, чтобы список не рос бесконечно. */
export const DISMISSED_MAX = 200;

const NONE: readonly string[] = [];
/** Что известно в этой вкладке: источник правды после первого чтения (и когда localStorage недоступен). */
const known = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();

const storageKey = (namespace: string, userId: string): string => `finora:dismissed:${namespace}:${userId}`;

function parse(raw: string | null): readonly string[] {
  if (raw === null) return NONE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NONE;
    const keys = parsed.filter((k): k is string => typeof k === 'string').slice(-DISMISSED_MAX);
    return keys.length === 0 ? NONE : keys;
  } catch {
    return NONE;
  }
}

/** Ключи, скрытые человеком (один и тот же массив, пока ничего не менялось: так нужно useSyncExternalStore). */
export function readDismissed(namespace: string, userId: string): readonly string[] {
  const key = storageKey(namespace, userId);
  const cached = known.get(key);
  if (cached) return cached;
  let keys: readonly string[] = NONE;
  try {
    keys = parse(window.localStorage.getItem(key));
  } catch {
    // хранилище недоступно: начинаем с пустого списка
  }
  known.set(key, keys);
  return keys;
}

function emit(): void {
  for (const l of listeners) l();
}

function write(namespace: string, userId: string, keys: readonly string[]): void {
  const key = storageKey(namespace, userId);
  const next = keys.slice(-DISMISSED_MAX);
  known.set(key, next);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // хранилище недоступно: действует список в памяти
  }
  emit();
}

/** Скрыть ключ. Уже скрытый — без изменений. */
export function dismissKey(namespace: string, userId: string, value: string): void {
  const cur = readDismissed(namespace, userId);
  if (!cur.includes(value)) write(namespace, userId, [...cur, value]);
}

/** Вернуть ключ (для «Отменить»). */
export function restoreKey(namespace: string, userId: string, value: string): void {
  const cur = readDismissed(namespace, userId);
  if (cur.includes(value)) write(namespace, userId, cur.filter((k) => k !== value));
}

/** Забыть всё прочитанное (тесты и смена человека): следующее чтение возьмёт данные из хранилища. */
export function forgetDismissedCache(): void {
  known.clear();
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = () => {
    known.clear(); // скрыли в другой вкладке
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export interface Dismissed {
  hidden: ReadonlySet<string>;
  dismiss: (key: string) => void;
  restore: (key: string) => void;
}

/** Скрытые ключи этого вида подсказок и функции «скрыть» / «вернуть». */
export function useDismissedKeys(namespace: string, userId: string): Dismissed {
  const keys = useSyncExternalStore(
    subscribe,
    () => readDismissed(namespace, userId),
    () => NONE,
  );
  const dismiss = useCallback((key: string) => dismissKey(namespace, userId, key), [namespace, userId]);
  const restore = useCallback((key: string) => restoreKey(namespace, userId, key), [namespace, userId]);
  // Set пересоздаётся только вместе с массивом: keys не меняется, пока ничего не скрыли
  return { hidden: toSet(keys), dismiss, restore };
}

const sets = new WeakMap<readonly string[], ReadonlySet<string>>();
function toSet(keys: readonly string[]): ReadonlySet<string> {
  let s = sets.get(keys);
  if (!s) {
    s = new Set(keys);
    sets.set(keys, s);
  }
  return s;
}
