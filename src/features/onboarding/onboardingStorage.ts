import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { initialProgress, parseProgress, serializeProgress, type Progress } from './onboardingLogic';

/**
 * Прогресс мастера на этом устройстве, отдельно для каждого человека. Хранится в localStorage; если он недоступен
 * (частный режим, запрет), прогресс живёт в памяти до перезагрузки страницы — тогда мастер продолжат по данным в базе.
 */

export const onboardingKey = (userId: string): string => `finora:onboarding:v1:${userId}`;

const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function readRaw(userId: string): string | null {
  const key = onboardingKey(userId);
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeProgress(userId: string, progress: Progress): void {
  const key = onboardingKey(userId);
  const raw = serializeProgress(progress);
  try {
    localStorage.setItem(key, raw);
  } catch {
    memory.set(key, raw);
  }
  notify();
}

/** Только для тестов. */
export function __resetOnboardingMemory(): void {
  memory.clear();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Прогресс мастера (null — ещё ничего не сохранено) и функция его правки. */
export function useOnboardingProgress(userId: string): [Progress | null, (change: (p: Progress) => Progress) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(userId),
    () => null,
  );
  const progress = useMemo(() => parseProgress(raw), [raw]);
  const update = useCallback(
    (change: (p: Progress) => Progress) => {
      const current = parseProgress(readRaw(userId)) ?? initialProgress();
      writeProgress(userId, change(current));
    },
    [userId],
  );
  return [progress, update];
}
