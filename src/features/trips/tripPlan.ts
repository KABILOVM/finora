import { useCallback, useSyncExternalStore } from 'react';
import type { IsoDate } from '@/domain/types';
import { isValidIsoDate } from '@/lib/dates';
import { PLAN_DAYS_MAX, PLAN_DAYS_MIN, type TripPlan } from './tripRates';
import { tagKey } from './trips';

/**
 * План поездки: на сколько дней рассчитаны деньги («сколько можно тратить в день»). Как и «режим поездки» (activeTrip.ts), это
 * настройка ЭТОГО устройства: localStorage, отдельно для каждого человека и каждой поездки; в облако не уходит. Хранилище
 * недоступно (приватный режим) — план помнится до перезагрузки страницы.
 */

const storageKey = (userId: string, key: string): string => `finora:trip-plan:${userId}:${key}`;

const known = new Map<string, TripPlan | null>();
const listeners = new Set<() => void>();

/** Разбор сохранённого значения: всё, что не похоже на план, — «плана нет». */
export function parsePlan(raw: string | null): TripPlan | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const { startOn, days } = v as { startOn?: unknown; days?: unknown };
    if (!isValidIsoDate(startOn) || typeof days !== 'number' || !Number.isInteger(days)) return null;
    if (days < PLAN_DAYS_MIN || days > PLAN_DAYS_MAX) return null;
    return { startOn, days };
  } catch {
    return null;
  }
}

/** Число дней из поля ввода: целое от 1 до 365; иначе null. */
export function parseDays(text: string): number | null {
  const s = text.replace(/\s/g, '');
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= PLAN_DAYS_MIN && n <= PLAN_DAYS_MAX ? n : null;
}

export function readTripPlan(userId: string, tag: string): TripPlan | null {
  const key = storageKey(userId, tagKey(tag));
  if (known.has(key)) return known.get(key) ?? null;
  let plan: TripPlan | null = null;
  try {
    plan = parsePlan(window.localStorage.getItem(key));
  } catch {
    // хранилище недоступно: плана нет
  }
  known.set(key, plan);
  return plan;
}

/** Задать план поездки (null — убрать). */
export function setTripPlan(userId: string, tag: string, plan: { startOn: IsoDate; days: number } | null): void {
  const key = storageKey(userId, tagKey(tag));
  const next = plan === null ? null : parsePlan(JSON.stringify(plan));
  known.set(key, next);
  try {
    if (next === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // хранилище недоступно: действует значение в памяти
  }
  for (const l of listeners) l();
}

/** Забыть всё прочитанное (тесты и смена человека). */
export function forgetTripPlanCache(): void {
  known.clear();
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = () => {
    known.clear(); // план изменили в другой вкладке
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export interface TripPlanState {
  plan: TripPlan | null;
  set: (plan: TripPlan | null) => void;
}

export function useTripPlan(userId: string, tag: string | null): TripPlanState {
  const plan = useSyncExternalStore(
    subscribe,
    () => (tag === null ? null : readTripPlan(userId, tag)),
    () => null,
  );
  const set = useCallback(
    (next: TripPlan | null) => {
      if (tag !== null) setTripPlan(userId, tag, next);
    },
    [userId, tag],
  );
  return { plan, set };
}
