import { describe, expect, it } from 'vitest';
import type { City, Forecast } from '@/features/weather/api';
import { cachedWeatherCode, chosenCity, MAX_WEATHER_AGE_MS } from './weatherSky';

const dushanbe: City = { id: '38.56,68.79', name: 'Душанбе', region: 'Таджикистан', lat: 38.5598, lon: 68.787 };
const khujand: City = { id: '40.28,69.62', name: 'Худжанд', region: 'Таджикистан', lat: 40.2826, lon: 69.6222 };
const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const forecast = (code: number, fetchedAt: string): Forecast =>
  ({ fetchedAt, current: { temp: 5, feels: 3, humidity: 80, code, isDay: true, wind: 2, pressure: 700, time: fetchedAt }, hours: [], days: [], sunrise: null, sunset: null }) as Forecast;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

describe('chosenCity: выбранный в «Погоде» город', () => {
  it('в настройках записан выбор — берётся он', () => {
    const text = JSON.stringify({ v: 1, selected: khujand.id, cities: [dushanbe, khujand] });
    expect(chosenCity(text, { cities: [], selectedId: null })?.name).toBe('Худжанд');
  });

  it('в настройках выбора нет — прежний выбор на этом устройстве; и там нет — города нет (прогноз без ведома не нужен)', () => {
    expect(chosenCity(null, { cities: [dushanbe, khujand], selectedId: dushanbe.id })?.name).toBe('Душанбе');
    expect(chosenCity(undefined, { cities: [dushanbe], selectedId: null })).toBeNull();
    expect(chosenCity('мусор', { cities: [dushanbe], selectedId: null })).toBeNull();
  });
});

describe('cachedWeatherCode: код погоды из сохранённого прогноза', () => {
  const caches = (map: Record<string, Forecast>) => (id: string) => map[id] ?? null;

  it('свежий прогноз — его код', () => {
    expect(cachedWeatherCode(dushanbe, NOW, caches({ [dushanbe.id]: forecast(63, ago(10 * 60_000)) }))).toBe(63);
  });

  it('прогноз старше трёх часов, чужого города или испорченный — кода нет: устаревшая погода хуже никакой', () => {
    expect(MAX_WEATHER_AGE_MS).toBe(3 * 60 * 60_000);
    expect(cachedWeatherCode(dushanbe, NOW, caches({ [dushanbe.id]: forecast(63, ago(MAX_WEATHER_AGE_MS + 1000)) }))).toBeNull();
    expect(cachedWeatherCode(dushanbe, NOW, caches({ [khujand.id]: forecast(63, ago(1000)) }))).toBeNull();
    expect(cachedWeatherCode(dushanbe, NOW, caches({ [dushanbe.id]: forecast(Number.NaN, ago(1000)) }))).toBeNull();
    expect(cachedWeatherCode(dushanbe, NOW, caches({ [dushanbe.id]: forecast(63, 'не дата') }))).toBeNull();
    expect(cachedWeatherCode(null, NOW, caches({}))).toBeNull();
  });

  it('прогноз «из будущего» (часы уехали) не считается свежим вечно', () => {
    expect(cachedWeatherCode(dushanbe, NOW, caches({ [dushanbe.id]: forecast(63, ago(-60 * 60_000)) }))).toBeNull();
  });
});
