import { cityId, type City, type Forecast } from './api';

const CITIES_KEY = 'finora:weather:cities:v1';
const SELECTED_KEY = 'finora:weather:selected:v1';
const CACHE_PREFIX = 'finora:weather:cache:v1:';
export const MAX_CITIES = 8;

export const DEFAULT_CITIES: readonly City[] = [
  { id: cityId(38.5598, 68.787), name: 'Душанбе', region: 'Таджикистан', lat: 38.5598, lon: 68.787 },
  { id: cityId(40.2826, 69.6222), name: 'Худжанд', region: 'Согдийская область, Таджикистан', lat: 40.2826, lon: 69.6222 },
  { id: cityId(37.8363, 68.7803), name: 'Бохтар', region: 'Хатлонская область, Таджикистан', lat: 37.8363, lon: 68.7803 },
];

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно или полно — работаем без запоминания */
  }
}

const isCity = (c: unknown): c is City =>
  typeof c === 'object' &&
  c !== null &&
  typeof (c as City).id === 'string' &&
  typeof (c as City).name === 'string' &&
  typeof (c as City).region === 'string' &&
  Number.isFinite((c as City).lat) &&
  Number.isFinite((c as City).lon);

export function loadCities(): City[] {
  const saved = read<unknown>(CITIES_KEY);
  const list = Array.isArray(saved) ? saved.filter(isCity).slice(0, MAX_CITIES) : [];
  return list.length > 0 ? list : [...DEFAULT_CITIES];
}

export function saveCities(cities: readonly City[]): void {
  write(CITIES_KEY, cities);
}

export function loadSelected(cities: readonly City[]): string {
  const id = read<unknown>(SELECTED_KEY);
  return typeof id === 'string' && cities.some((c) => c.id === id) ? id : (cities[0]?.id ?? DEFAULT_CITIES[0]!.id);
}

export function saveSelected(id: string): void {
  write(SELECTED_KEY, id);
}

/** Город, который человек сам выбрал (или определил по геолокации). null — ещё не выбирал: на «Главной» погоду не показываем и не запрашиваем. */
export function loadChosenCity(): City | null {
  const cities = loadCities();
  const id = read<unknown>(SELECTED_KEY);
  return typeof id === 'string' ? (cities.find((c) => c.id === id) ?? null) : null;
}

export function loadCache(id: string): Forecast | null {
  const f = read<Forecast>(CACHE_PREFIX + id);
  return f && typeof f === 'object' && f.current && Array.isArray(f.days) && Array.isArray(f.hours) ? f : null;
}

export function saveCache(id: string, forecast: Forecast): void {
  write(CACHE_PREFIX + id, forecast);
}

export function clearCache(id: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + id);
  } catch {
    /* ничего */
  }
}
