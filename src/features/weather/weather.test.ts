import { describe, expect, it, vi } from 'vitest';
import { WeatherError, fetchForecast, forecastUrl, parseCities, parseForecast, searchCities } from './api';
import { conditionOf, formatTemp } from './conditions';

const sample = {
  current: { time: '2026-10-16T14:15', temperature_2m: 21.4, apparent_temperature: 20, relative_humidity_2m: 40, weather_code: 2, is_day: 1, wind_speed_10m: 3.2, surface_pressure: 920 },
  hourly: {
    time: ['2026-10-16T13:00', '2026-10-16T14:00', '2026-10-16T15:00'],
    temperature_2m: [20, 21, 22],
    weather_code: [1, 2, 3],
    is_day: [1, 1, 0],
    precipitation_probability: [0, 10, 60],
  },
  daily: {
    time: ['2026-10-16', '2026-10-17'],
    weather_code: [2, 61],
    temperature_2m_max: [24, 18],
    temperature_2m_min: [9, 8],
    precipitation_probability_max: [10, 80],
    sunrise: ['2026-10-16T06:20', '2026-10-17T06:21'],
    sunset: ['2026-10-16T17:30', '2026-10-17T17:29'],
  },
};

describe('parseForecast', () => {
  it('разбирает текущую погоду, часы начиная с текущего и дни', () => {
    const f = parseForecast(sample);
    expect(f.current).toMatchObject({ temp: 21.4, feels: 20, humidity: 40, code: 2, isDay: true, wind: 3.2, pressure: 690 });
    expect(f.hours.map((h) => h.time)).toEqual(['14:00', '15:00']);
    expect(f.hours[1]).toMatchObject({ isDay: false, rain: 60 });
    expect(f.days).toHaveLength(2);
    expect(f.sunrise).toBe('06:20');
    expect(f.sunset).toBe('17:30');
  });
  it('мусор → WeatherError', () => {
    expect(() => parseForecast(null)).toThrow(WeatherError);
    expect(() => parseForecast({ current: { time: 'x' } })).toThrow(WeatherError);
    expect(() => parseForecast({ current: { time: '2026-10-16T14:15', temperature_2m: 'hot', weather_code: 1 } })).toThrow(WeatherError);
  });
  it('пропущенные поля почасовых/дневных данных не ломают разбор', () => {
    const f = parseForecast({ current: sample.current });
    expect(f.hours).toEqual([]);
    expect(f.days).toEqual([]);
    expect(f.sunrise).toBeNull();
  });
});

describe('геокодер и запросы', () => {
  it('parseCities отбрасывает записи без координат/имени', () => {
    const cities = parseCities({
      results: [
        { name: 'Душанбе', latitude: 38.56, longitude: 68.77, admin1: 'Душанбе', country: 'Таджикистан' },
        { name: 'Плохой', latitude: 'x', longitude: 1 },
        { name: '', latitude: 1, longitude: 1 },
        { name: 'Вне мира', latitude: 120, longitude: 0 },
        null,
      ],
    });
    expect(cities).toEqual([{ id: '38.56,68.77', name: 'Душанбе', region: 'Душанбе, Таджикистан', lat: 38.56, lon: 68.77 }]);
    expect(parseCities({})).toEqual([]);
  });
  it('адрес прогноза содержит нужные поля', () => {
    const u = new URL(forecastUrl({ lat: 38.56, lon: 68.77 }));
    expect(u.origin).toBe('https://api.open-meteo.com');
    expect(u.searchParams.get('timezone')).toBe('auto');
    expect(u.searchParams.get('wind_speed_unit')).toBe('ms');
  });
  it('fetchForecast: HTTP-ошибка и обрыв сети дают понятные ошибки', async () => {
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchForecast({ lat: 1, lon: 1 }, undefined, bad as never)).rejects.toThrow(/500/);
    const down = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchForecast({ lat: 1, lon: 1 }, undefined, down as never)).rejects.toThrow(/Нет связи/);
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sample });
    await expect(fetchForecast({ lat: 1, lon: 1 }, undefined, ok as never)).resolves.toMatchObject({ current: { temp: 21.4 } });
  });
  it('searchCities: короткий запрос не ходит в сеть', async () => {
    const f = vi.fn();
    await expect(searchCities(' а ', undefined, f as never)).resolves.toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('подписи', () => {
  it('температура со знаком', () => {
    expect(formatTemp(23.4)).toBe('+23°');
    expect(formatTemp(-4.6)).toBe('−5°');
    expect(formatTemp(-0.2)).toBe('0°');
    expect(formatTemp(0)).toBe('0°');
  });
  it('коды WMO', () => {
    expect(conditionOf(0).label).toBe('Ясно');
    expect(conditionOf(95).kind).toBe('storm');
    expect(conditionOf(999).label).toBe('Нет данных');
  });
});
