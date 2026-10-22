import { useCallback, useSyncExternalStore } from 'react';
import { TAG_MAX, TAG_MIN } from './trips';

/**
 * «Режим поездки»: пока поездка начата, новые операции получают её метку (`#Самарканд`) сами. Это настройка ЭТОГО устройства
 * (localStorage, отдельно для каждого человека): в облако не уходит — метки уже лежат в заметках самих операций. Если хранилище
 * недоступно (приватный режим, переполнено), поездка помнится до перезагрузки страницы.
 */

const TAG_ONLY = new RegExp(`^[\\p{L}\\p{N}_-]{${TAG_MIN},${TAG_MAX}}$`, 'u');
const storageKey = (userId: string): string => `finora:active-trip:${userId}`;

/** Что известно в этой вкладке: источник правды после первого чтения (и когда localStorage недоступен). */
const known = new Map<string, string | null>();
const listeners = new Set<() => void>();

const valid = (raw: string | null): string | null => (raw !== null && TAG_ONLY.test(raw) ? raw : null);

/** Метка начатой поездки; null — поездка не начата. */
export function readActiveTrip(userId: string): string | null {
  const key = storageKey(userId);
  if (known.has(key)) return known.get(key) ?? null;
  let tag: string | null = null;
  try {
    tag = valid(window.localStorage.getItem(key));
  } catch {
    // хранилище недоступно: поездка не начата
  }
  known.set(key, tag);
  return tag;
}

/** Начать поездку с меткой `tag` (null — закончить). Негодная метка — то же, что «закончить». */
export function setActiveTrip(userId: string, tag: string | null): void {
  const key = storageKey(userId);
  const next = valid(tag);
  known.set(key, next);
  try {
    if (next === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, next);
  } catch {
    // хранилище недоступно: действует значение в памяти
  }
  for (const l of listeners) l();
}

/** Забыть всё прочитанное (тесты и смена человека): следующее чтение возьмёт данные из хранилища. */
export function forgetActiveTripCache(): void {
  known.clear();
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = () => {
    known.clear(); // поездку начали или закончили в другой вкладке
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export interface ActiveTrip {
  /** Метка начатой поездки; null — не начата. */
  tag: string | null;
  start: (tag: string) => void;
  end: () => void;
}

export function useActiveTrip(userId: string): ActiveTrip {
  const tag = useSyncExternalStore(
    subscribe,
    () => readActiveTrip(userId),
    () => null,
  );
  const start = useCallback((t: string) => setActiveTrip(userId, t), [userId]);
  const end = useCallback(() => setActiveTrip(userId, null), [userId]);
  return { tag, start, end };
}
