import type { City } from './api';
import { MAX_CITIES } from './store';

export interface PlacesChange {
  cities: City[];
  /** Какой город теперь выбран. */
  selectedId: string;
}

/**
 * Добавляет город в список и выбирает его. Место «я здесь» заменяет прежнее такое же, а не копится рядом. Город с тем же местом,
 * что уже есть в списке под настоящим названием, второй раз не добавляется — просто выбирается (даже если его «нашла» геолокация).
 * Найденный по названию город заменяет «я здесь» с теми же координатами. null — список полон (8 городов) и заменять нечего.
 */
export function withCity(cities: readonly City[], city: City): PlacesChange | null {
  const named = cities.find((c) => c.id === city.id && !c.here);
  if (named) return { cities: [...cities], selectedId: named.id };
  const rest = cities.filter((c) => c.id !== city.id && !(city.here && c.here));
  if (rest.length >= MAX_CITIES) return null;
  return { cities: [...rest, city], selectedId: city.id };
}

/** Убирает город. Последний не убирается. Если убрали выбранный, выбирается первый из оставшихся. */
export function withoutCity(cities: readonly City[], selectedId: string, id: string): PlacesChange | null {
  if (cities.length <= 1) return null;
  const next = cities.filter((c) => c.id !== id);
  if (next.length === cities.length) return null;
  return { cities: next, selectedId: selectedId === id ? next[0]!.id : selectedId };
}
