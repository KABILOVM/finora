import { useSyncExternalStore } from 'react';

/** Включены ли подсказки «лимит на исходе». Хранится на этом устройстве (localStorage); по умолчанию включены. */
const KEY = 'finora:budget-alerts';
const listeners = new Set<() => void>();
/** Если localStorage недоступен: настройка живёт до перезагрузки страницы. */
let fallback: boolean | null = null;

export function budgetAlertsEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return fallback ?? true;
  }
}

export function setBudgetAlertsEnabled(on: boolean): void {
  fallback = on;
  try {
    if (on) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, 'off');
  } catch {
    // хранилище недоступно: действует значение в памяти
  }
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange); // переключили в другой вкладке
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export const useBudgetAlertsEnabled = (): boolean => useSyncExternalStore(subscribe, budgetAlertsEnabled, () => true);
