/*
 * Погода: Open-Meteo (https://open-meteo.com) — бесплатно, без ключа, CORS открыт. Города ищет их же геокодер.
 * Данные открыты по лицензии CC BY 4.0, поэтому на странице есть ссылка-подпись «Open-Meteo».
 */

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 10_000;

export interface City {
  id: string;
  name: string;
  /** Область/страна для подписи. */
  region: string;
  lat: number;
  lon: number;
  /** true — место определено по геолокации устройства (такое в списке только одно, оно заменяется при новом определении). */
  here?: true;
}

export interface HourPoint {
  /** «ЧЧ:ММ» местного времени города. */
  time: string;
  temp: number;
  code: number;
  isDay: boolean;
  /** Вероятность осадков, %. */
  rain: number | null;
}

export interface DayPoint {
  /** ГГГГ-ММ-ДД */
  date: string;
  code: number;
  min: number;
  max: number;
  rain: number | null;
}

export interface Forecast {
  fetchedAt: string;
  current: {
    temp: number;
    feels: number;
    humidity: number;
    code: number;
    isDay: boolean;
    /** м/с */
    wind: number;
    /** мм рт. ст. */
    pressure: number;
    time: string;
  };
  hours: HourPoint[];
  days: DayPoint[];
  sunrise: string | null;
  sunset: string | null;
}

export class WeatherError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function cityId(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/** Ответ геокодера → города. Мусорные записи пропускаются. */
export function parseCities(json: unknown): City[] {
  if (!isObj(json)) return [];
  const out: City[] = [];
  for (const raw of arr(json.results)) {
    if (!isObj(raw)) continue;
    const lat = num(raw.latitude);
    const lon = num(raw.longitude);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (typeof raw.name !== 'string' || raw.name.trim() === '') continue;
    const region = [raw.admin1, raw.country].filter((x): x is string => typeof x === 'string' && x !== '').join(', ');
    out.push({ id: cityId(lat, lon), name: raw.name.slice(0, 80), region: region.slice(0, 120), lat, lon });
  }
  return out;
}

const HPA_TO_MMHG = 0.750062;

/** Ответ прогноза → Forecast. Бросает WeatherError, если нет текущей погоды. */
export function parseForecast(json: unknown, now: Date = new Date()): Forecast {
  if (!isObj(json) || !isObj(json.current)) throw new WeatherError('Неожиданный ответ сервиса погоды');
  const c = json.current;
  const temp = num(c.temperature_2m);
  const code = num(c.weather_code);
  if (temp === null || code === null || typeof c.time !== 'string') throw new WeatherError('В ответе нет текущей погоды');

  const hourly = isObj(json.hourly) ? json.hourly : {};
  const times = arr(hourly.time);
  const startKey = `${c.time.slice(0, 13)}:00`;
  const hours: HourPoint[] = [];
  for (let i = 0; i < times.length && hours.length < 24; i += 1) {
    const t = times[i];
    const ht = num(arr(hourly.temperature_2m)[i]);
    const hc = num(arr(hourly.weather_code)[i]);
    if (typeof t !== 'string' || t < startKey || ht === null || hc === null) continue;
    hours.push({
      time: t.slice(11, 16),
      temp: ht,
      code: hc,
      isDay: arr(hourly.is_day)[i] !== 0,
      rain: num(arr(hourly.precipitation_probability)[i]),
    });
  }

  const daily = isObj(json.daily) ? json.daily : {};
  const dates = arr(daily.time);
  const days: DayPoint[] = [];
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const max = num(arr(daily.temperature_2m_max)[i]);
    const min = num(arr(daily.temperature_2m_min)[i]);
    const dc = num(arr(daily.weather_code)[i]);
    if (typeof date !== 'string' || max === null || min === null || dc === null) continue;
    days.push({ date, code: dc, min, max, rain: num(arr(daily.precipitation_probability_max)[i]) });
  }

  const sun = (key: string): string | null => {
    const v = arr(daily[key])[0];
    return typeof v === 'string' && v.length >= 16 ? v.slice(11, 16) : null;
  };

  return {
    fetchedAt: now.toISOString(),
    current: {
      temp,
      feels: num(c.apparent_temperature) ?? temp,
      humidity: num(c.relative_humidity_2m) ?? 0,
      code,
      isDay: c.is_day !== 0,
      wind: num(c.wind_speed_10m) ?? 0,
      pressure: Math.round((num(c.surface_pressure) ?? 0) * HPA_TO_MMHG),
      time: c.time,
    },
    hours,
    days,
    sunrise: sun('sunrise'),
    sunset: sun('sunset'),
  };
}

async function getJson(url: string, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new WeatherError(`Сервис погоды ответил ошибкой ${res.status}`);
    return await res.json();
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof WeatherError) throw e;
    throw new WeatherError(ctrl.signal.aborted ? 'Сервис погоды не ответил вовремя' : 'Нет связи с сервисом погоды');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function forecastUrl(city: Pick<City, 'lat' | 'lon'>): string {
  const q = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,surface_pressure',
    hourly: 'temperature_2m,weather_code,is_day,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '7',
    wind_speed_unit: 'ms',
  });
  return `${FORECAST_URL}?${q.toString()}`;
}

export async function fetchForecast(city: Pick<City, 'lat' | 'lon'>, signal?: AbortSignal, fetchFn?: typeof fetch): Promise<Forecast> {
  return parseForecast(await getJson(forecastUrl(city), signal, fetchFn));
}

export async function searchCities(query: string, signal?: AbortSignal, fetchFn?: typeof fetch): Promise<City[]> {
  const name = query.trim();
  if (name.length < 2) return [];
  const q = new URLSearchParams({ name, count: '8', language: 'ru', format: 'json' });
  return parseCities(await getJson(`${GEOCODING_URL}?${q.toString()}`, signal, fetchFn));
}
