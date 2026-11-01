import { useSyncExternalStore } from 'react';
import { DEFAULT_ROUND_UP_STEP, isRoundUpStep, type RoundUpStep } from '@/domain/roundUp';

/** Шаг «Копилки из мелочи» (1, 5 или 10 единиц валюты). Хранится на этом устройстве (localStorage); по умолчанию 5. */
const KEY = 'finora:round-up-step';
const listeners = new Set<() => void>();
/** Если localStorage недоступен: настройка живёт до перезагрузки страницы. */
let fallback: RoundUpStep | null = null;

export function roundUpStep(): RoundUpStep {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return fallback ?? DEFAULT_ROUND_UP_STEP;
    const n = Number(raw);
    return isRoundUpStep(n) ? n : DEFAULT_ROUND_UP_STEP; // мусор в хранилище — шаг по умолчанию
  } catch {
    return fallback ?? DEFAULT_ROUND_UP_STEP;
  }
}

export function setRoundUpStep(step: RoundUpStep): void {
  fallback = step;
  try {
    if (step === DEFAULT_ROUND_UP_STEP) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(step));
  } catch {
    // хранилище недоступно: действует значение в памяти
  }
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange); // изменили в другой вкладке
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export const useRoundUpStep = (): RoundUpStep => useSyncExternalStore(subscribe, roundUpStep, () => DEFAULT_ROUND_UP_STEP);
