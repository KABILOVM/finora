import { useSyncExternalStore } from 'react';

/**
 * Только что внесённая операция: её строку в списке (на «Главной» и в «Операциях») подсвечиваем и прокручиваем к ней — чтобы
 * человек сразу видел, куда попала запись. Помним одну операцию и недолго; хранится только в памяти вкладки.
 */

/** Сколько строка остаётся подсвеченной. */
export const FRESH_MS = 4000;

let fresh: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

/** Операцию только что сохранили: подсветить её строку. */
export function markSaved(id: string): void {
  fresh = id;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    fresh = null;
    timer = null;
    emit();
  }, FRESH_MS);
  emit();
}

/** Для тестов: забыть подсветку, оставшуюся от предыдущего теста. */
export function resetSavedForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  fresh = null;
  emit();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** true — эту операцию только что сохранили (в ближайшие секунды её строка подсвечена). */
export const useIsFresh = (id: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => fresh === id,
    () => false,
  );
