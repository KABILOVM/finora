import type { Forecast, HourPoint } from './api';

const HOUR_MS = 60 * 60 * 1000;

/** Сколько прошло с загрузки прогноза. Время испорчено или часы устройства отстают — считаем, что только что. */
export function elapsedMs(forecast: Forecast, now: Date): number {
  const age = now.getTime() - Date.parse(forecast.fetchedAt);
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}

/**
 * Номер слота в `forecast.hours`, в котором мы сейчас. Слот 0 — час, в который прогноз загружен; прогноз из памяти (или тот, что
 * не удалось обновить) мог быть загружен давно, и тогда «сейчас» — один из следующих слотов, а предыдущие уже прошли.
 */
export function slotIndex(forecast: Forecast, now: Date): number {
  const minutes = Number(forecast.current.time.slice(14, 16));
  const into = Number.isFinite(minutes) ? minutes * 60_000 : 0;
  return Math.floor((into + elapsedMs(forecast, now)) / HOUR_MS);
}

export interface HourSlot {
  hour: HourPoint;
  /** Этот слот — текущий час (в ленте он подписан «Сейчас»). */
  now: boolean;
}

/**
 * Часы для ленты «По часам»: от текущего слота и дальше, прошедшие отброшены. Пока прогноз свежий (слот 0), «сейчас» берётся из
 * текущей погоды, а не из почасовой: иначе в карточке было бы +14°, а в «Сейчас» рядом — +15°. У прогноза из памяти текущий слот —
 * почасовая оценка на этот час: это лучшее, что известно, а что данные не свежие, сказано на странице отдельно.
 */
export function hoursFrom(forecast: Forecast, now: Date): HourSlot[] {
  const first = slotIndex(forecast, now);
  return forecast.hours.slice(first).map((h, i) => ({
    hour: i === 0 && first === 0 ? { ...h, temp: forecast.current.temp, code: forecast.current.code, isDay: forecast.current.isDay } : h,
    now: i === 0,
  }));
}
