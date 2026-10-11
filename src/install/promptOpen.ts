import { useSyncExternalStore } from 'react';

/** Открыто ли сейчас окно установки (маленькая подсказка на «Главной» в это время молчит). */
let open = false;
const listeners = new Set<() => void>();

export function setInstallPromptOpen(v: boolean): void {
  if (open === v) return;
  open = v;
  listeners.forEach((l) => l());
}

export function useInstallPromptOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => open,
    () => false,
  );
}
