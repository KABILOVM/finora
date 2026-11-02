import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { opsDeps, pinToday, showApp, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { parseForecast } from './api';
import { DEFAULT_CITIES, saveCache } from './store';
import WeatherPage from './WeatherPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const KHUJAND = DEFAULT_CITIES[1]!;
const MIN = 60_000;

/** Прогноз, загруженный в `HH:15` (текущее +14°, ясно); почасовые от HH:00: +15°, +16°, …, всё облачно. */
function forecastAt(hour: number): unknown {
  const hh = String(hour).padStart(2, '0');
  const times = Array.from({ length: 8 }, (_, i) => `2026-10-15T${String(hour + i).padStart(2, '0')}:00`);
  return {
    current: { time: `2026-10-15T${hh}:15`, temperature_2m: 14, apparent_temperature: 13, relative_humidity_2m: 40, weather_code: 0, is_day: 1, wind_speed_10m: 2, surface_pressure: 920 },
    hourly: {
      time: times,
      temperature_2m: times.map((_, i) => 15 + i),
      weather_code: times.map(() => 3),
      is_day: times.map(() => 1),
      precipitation_probability: times.map(() => 0),
    },
    daily: { time: ['2026-10-15'], weather_code: [0], temperature_2m_max: [20], temperature_2m_min: [9], precipitation_probability_max: [0], sunrise: ['2026-10-15T06:20'], sunset: ['2026-10-15T17:30'] },
  };
}

const hhmm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const strip = () => Array.from(document.querySelectorAll('[aria-labelledby="hours-title"] li')).map((li) => norm(li.textContent));
const banner = () => document.querySelector('[data-testid="weather-stale-note"]');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pinToday(); // сейчас 15.10.2026, 12:00
  localStorage.clear();
  localStorage.setItem('finora:weather:cities:v1', JSON.stringify([...DEFAULT_CITIES]));
  localStorage.setItem('finora:weather:selected:v1', JSON.stringify(KHUJAND.id));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  unpinToday();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Прогноз из памяти, загруженный `ageMs` назад; `hour` — час на часах города в момент загрузки. */
function cached(hour: number, ageMs: number): Date {
  const fetched = new Date(Date.now() - ageMs);
  saveCache(KHUJAND.id, { ...parseForecast(forecastAt(hour)), fetchedAt: fetched.toISOString() });
  return fetched;
}

async function open() {
  await showApp(<WeatherPage />, opsDeps([]), '/weather');
  await eventually(() => expect(document.querySelector('[aria-labelledby="hours-title"]')).not.toBeNull());
}

describe('страница «Погода»: свежие и устаревшие данные', () => {
  it('свежий прогноз: «Сейчас» в ленте показывает ту же температуру, что и карточка (+14°), без пометки «Данные на»', async () => {
    cached(11, MIN); // загружен минуту назад, в 11:15 → мы ещё в слоте 11:00
    await open();
    expect(norm(document.querySelector('section[aria-label^="Погода сейчас"]')?.textContent)).toContain('+14°');
    expect(strip()[0]).toContain('Сейчас');
    expect(strip()[0]).toContain('+14°'); // а не +15° по почасовому прогнозу
    expect(strip()[1]).toContain('12:00');
    expect(document.querySelector('[data-testid="weather-stale"]')).toBeNull();
    expect(banner()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('сервис ответил 503, прогнозу из памяти 2 ч 45 мин: прошедшие часы убраны, «Сейчас» — 12:00; на карточке «Данные на …»; плашка обещает повтор', async () => {
    const fetched = cached(9, 165 * MIN); // загружен в 09:15, сейчас 12:00
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await open();
    await eventually(() => expect(banner()).not.toBeNull());

    const hours = strip();
    expect(hours[0]).toContain('Сейчас');
    expect(hours[0]).toContain('+18°'); // слот 12:00: 15 + 3
    expect(hours[1]).toContain('13:00');
    expect(hours.join(' ')).not.toMatch(/09:00|10:00|11:00/);

    expect(norm(document.querySelector('[data-testid="weather-stale"]')?.textContent)).toBe(`Данные на ${hhmm(fetched)}`);
    const text = norm(banner()?.textContent);
    expect(text).toContain('Сервис погоды ответил ошибкой 503');
    expect(text).toContain(`Показаны данные на ${hhmm(fetched)}`);
    expect(text).toContain('Попробуем ещё раз автоматически');
  });

  it('ответ 429 (повторов не будет): плашка зовёт нажать кнопку обновления', async () => {
    cached(9, 165 * MIN);
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await open();
    await eventually(() => expect(norm(banner()?.textContent)).toContain('Нажмите кнопку обновления вверху'));
    expect(norm(banner()?.textContent)).not.toContain('автоматически');
  });

  it('прогноз из памяти так стар, что все его часы прошли: ленты нет, карточка и дни на месте', async () => {
    cached(3, 9 * 60 * MIN); // загружен в 03:15, сейчас 12:00, а часов в прогнозе всего 8 — до 10:00
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await showApp(<WeatherPage />, opsDeps([]), '/weather');
    await eventually(() => expect(banner()).not.toBeNull());
    expect(document.querySelector('[aria-labelledby="hours-title"]')).toBeNull();
    expect(document.querySelector('[data-testid="weather-stale"]')).not.toBeNull();
    expect(document.querySelector('section[aria-label^="Погода сейчас"]')).not.toBeNull();
  });
});
