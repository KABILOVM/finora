import type { City, Forecast } from '@/features/weather/api';
import { loadCache, loadLegacyPlaces, type LegacyPlaces } from '@/features/weather/store';
import { parseWeather } from '@/domain/weatherPlaces';

/** Прогноз старше этого для эффектов не годится: вчерашний дождь за окном не идёт. */
export const MAX_WEATHER_AGE_MS = 3 * 60 * 60_000;

/**
 * Город, выбранный человеком в «Погоде»: из настроек (ездят между устройствами), а пока там пусто — прежний выбор на этом
 * устройстве. null — человек город не выбирал: прогноз без его ведома не запрашивается, эффектам брать погоду неоткуда.
 */
export function chosenCity(weatherSetting: string | null | undefined, legacy: LegacyPlaces = loadLegacyPlaces()): City | null {
  const saved = parseWeather(weatherSetting);
  const { cities, selectedId } = saved ? { cities: saved.cities as City[], selectedId: saved.selected } : legacy;
  return cities.find((c) => c.id === selectedId) ?? null;
}

/**
 * Код погоды из прогноза, который «Погода» уже сохранила на устройстве; сама ничего не запрашивает. null — города нет, прогноза нет,
 * он испорчен, старше MAX_WEATHER_AGE_MS или из будущего (часы устройства переводили).
 */
export function cachedWeatherCode(city: City | null, nowMs: number, load: (cityId: string) => Forecast | null = loadCache): number | null {
  if (city === null) return null;
  const forecast = load(city.id);
  if (!forecast) return null;
  const age = nowMs - Date.parse(forecast.fetchedAt);
  const code = forecast.current.code;
  return Number.isFinite(age) && age >= 0 && age <= MAX_WEATHER_AGE_MS && Number.isFinite(code) ? code : null;
}
