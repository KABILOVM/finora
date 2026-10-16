/**
 * Города для погоды, которые хранятся в настройках (Settings.weather) и ездят между устройствами одним текстом.
 * Формат: {"v":1,"selected":"37.50,70.25"|null,"cities":[{"id","name","region","lat","lon","here"?}]}.
 * Читаем мягко (незнакомое или испорченное = «ничего не выбрано», приложение работает дальше), пишем строго и всегда в одном
 * каноническом виде — чтобы одинаковое содержимое давало одинаковый текст и не плодило лишних правок.
 */

export const WEATHER_MAX_CITIES = 8;
/** Не больше, чем CHECK settings_weather_len на сервере (раздел 13 supabase/schema.sql). */
export const WEATHER_MAX_CHARS = 8000;
const NAME_MAX = 80;
const REGION_MAX = 120;
const ID_MAX = 32;

export interface WeatherCity {
  /** Идентификатор места: «широта,долгота» с двумя знаками. */
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  /** true — место определено по геолокации устройства; такое в списке только одно. */
  here?: true;
}

export interface WeatherPlaces {
  /** Выбранный город. null — человек ещё ничего не выбирал. */
  selected: string | null;
  cities: WeatherCity[];
}

export type WeatherRead = { ok: true; places: WeatherPlaces } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (error: string): WeatherRead => ({ ok: false, error });

/** Без управляющих символов (в названиях им делать нечего, а в JSON они раздули бы текст шестисимвольными записями). */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

function readCity(raw: unknown, index: number): { city: WeatherCity } | { error: string } {
  const where = `город ${index + 1}`;
  if (!isObj(raw)) return { error: `${where}: ожидался объект` };
  const { id, name, region, lat, lon, here } = raw;
  if (typeof id !== 'string' || id === '' || id.length > ID_MAX) return { error: `${where}: некорректный идентификатор` };
  if (typeof name !== 'string') return { error: `${where}: нет названия` };
  const cleanName = clean(name);
  if (cleanName === '' || [...cleanName].length > NAME_MAX) return { error: `${where}: название от 1 до ${NAME_MAX} знаков` };
  if (typeof region !== 'string') return { error: `${where}: нет региона` };
  const cleanRegion = clean(region);
  if ([...cleanRegion].length > REGION_MAX) return { error: `${where}: регион длиннее ${REGION_MAX} знаков` };
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) return { error: `${where}: широта вне диапазона` };
  if (typeof lon !== 'number' || !Number.isFinite(lon) || Math.abs(lon) > 180) return { error: `${where}: долгота вне диапазона` };
  if (here !== undefined && here !== true) return { error: `${where}: некорректная отметка места` };
  const city: WeatherCity = { id, name: cleanName, region: cleanRegion, lat, lon };
  if (here === true) city.here = true;
  return { city };
}

/** Разбирает текст настройки. Любое отклонение — `ok: false` с причиной по-русски. */
export function readWeather(text: unknown): WeatherRead {
  if (typeof text !== 'string') return bad('ожидался текст');
  if (text.length > WEATHER_MAX_CHARS) return bad(`длиннее ${WEATHER_MAX_CHARS} знаков`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad('это не JSON');
  }
  if (!isObj(json) || json['v'] !== 1) return bad('неизвестная версия записи');
  const rawCities = json['cities'];
  if (!Array.isArray(rawCities) || rawCities.length < 1 || rawCities.length > WEATHER_MAX_CITIES) {
    return bad(`городов должно быть от 1 до ${WEATHER_MAX_CITIES}`);
  }
  const cities: WeatherCity[] = [];
  for (let i = 0; i < rawCities.length; i += 1) {
    const r = readCity(rawCities[i], i);
    if ('error' in r) return bad(r.error);
    cities.push(r.city);
  }
  if (new Set(cities.map((c) => c.id)).size !== cities.length) return bad('города повторяются');
  if (cities.filter((c) => c.here).length > 1) return bad('место по геолокации может быть только одно');
  const selected = json['selected'];
  if (selected !== null && (typeof selected !== 'string' || !cities.some((c) => c.id === selected))) return bad('выбранного города нет в списке');
  return { ok: true, places: { selected, cities } };
}

/** Мягкое чтение: null, если записи нет или она непонятна. */
export function parseWeather(text: string | null | undefined): WeatherPlaces | null {
  if (text === null || text === undefined) return null;
  const r = readWeather(text);
  return r.ok ? r.places : null;
}

function canonical(places: WeatherPlaces): string {
  return JSON.stringify({
    v: 1,
    selected: places.selected,
    cities: places.cities.map((c) =>
      c.here ? { id: c.id, name: c.name, region: c.region, lat: c.lat, lon: c.lon, here: true } : { id: c.id, name: c.name, region: c.region, lat: c.lat, lon: c.lon },
    ),
  });
}

/**
 * Канонический текст (названия очищены от управляющих символов). Бросает, если места не проходят проверку, — так в настройки
 * не попадёт мусор.
 */
export function stringifyWeather(places: WeatherPlaces): string {
  const r = readWeather(canonical(places));
  if (!r.ok) throw new RangeError(`Погода: ${r.error}`);
  return canonical(r.places);
}
