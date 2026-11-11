import { useSyncExternalStore } from 'react';

/** Избранные образы: список их названий-идентификаторов на этом устройстве (в облако не уходит, как и сам выбор образа). */
const KEY = 'finora-skin-favs';
const EVENT = 'finora-skin-favs-change';

/** Один и тот же массив, пока список не изменился: иначе useSyncExternalStore перерисовывал бы страницу без конца. */
let cache: { raw: string | null; list: readonly string[] } = { raw: null, list: [] };

export function readFavs(): readonly string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* хранилище недоступно — избранного нет */
  }
  if (raw === cache.raw) return cache.list;
  let list: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (Array.isArray(parsed)) list = parsed.filter((v): v is string => typeof v === 'string' && /^[a-z0-9:]{1,40}$/.test(v)).slice(0, 200);
  } catch {
    /* испорченное значение — как пустой список */
  }
  cache = { raw, list };
  return list;
}

/** Добавляет образ в избранное или убирает его оттуда. */
export function toggleFav(key: string): void {
  const now = readFavs();
  const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* не сохранилось */
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

const EMPTY: readonly string[] = [];

/** Избранные образы; компонент обновляется сам. */
export const useFavs = (): readonly string[] => useSyncExternalStore(subscribe, readFavs, () => EMPTY);
