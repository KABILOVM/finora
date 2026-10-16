import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { user, waitFor } from '@/components/testUtils';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { parseForecast, type City, type Forecast } from '@/features/weather/api';
import { DEFAULT_CITIES, saveCache, saveCities, saveSelected } from '@/features/weather/store';
import WeatherWidget from './WeatherWidget';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const KHUJAND = DEFAULT_CITIES[1]!;

const sample = {
  current: { time: '2026-10-15T12:00', temperature_2m: 23.4, apparent_temperature: 22, relative_humidity_2m: 30, weather_code: 0, is_day: 1, wind_speed_10m: 2, surface_pressure: 920 },
  hourly: { time: ['2026-10-15T12:00'], temperature_2m: [23], weather_code: [0], is_day: [1], precipitation_probability: [0] },
  daily: {
    time: ['2026-10-15', '2026-10-16'],
    weather_code: [0, 61],
    temperature_2m_max: [27.6, 18],
    temperature_2m_min: [-1.2, 8],
    precipitation_probability_max: [0, 80],
    sunrise: ['2026-10-15T06:20'],
    sunset: ['2026-10-15T17:30'],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pinToday();
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  unpinToday();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const widget = () => document.querySelector('[data-testid="weather-widget"]') as HTMLElement | null;
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function choose(city: City): void {
  saveCities([...DEFAULT_CITIES]);
  saveSelected(city.id);
}
function cacheFor(city: City, ageMs: number): Forecast {
  const f = { ...parseForecast(sample), fetchedAt: new Date(Date.now() - ageMs).toISOString() };
  saveCache(city.id, f);
  return f;
}

async function open() {
  const td = opsDeps();
  await showApp(
    <>
      <WeatherWidget />
      <LocationProbe />
    </>,
    td,
    '/',
  );
  await eventually(() => expect(widget()).not.toBeNull());
}

describe('виджет «Погода» на «Главной»', () => {
  it('город не выбран — предлагает выбрать и в сеть не ходит', async () => {
    await open();
    expect(norm(widget()?.textContent)).toContain('Покажем погоду там, где вы');
    expect(norm(widget()?.textContent)).toContain('Выбрать город');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('город по умолчанию из списка, но не выбранный человеком, считается невыбранным', async () => {
    saveCities([...DEFAULT_CITIES]); // список есть, выбора нет
    await open();
    expect(norm(widget()?.textContent)).toContain('Выбрать город');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('свежий прогноз из памяти устройства — показывает без запроса: температура, состояние, днём и ночью, город', async () => {
    choose(KHUJAND);
    cacheFor(KHUJAND, 5 * 60 * 1000);
    await open();
    const text = norm(widget()?.textContent);
    expect(text).toContain('+23°');
    expect(text).toContain('Ясно');
    expect(text).toContain('Худжанд');
    expect(text).toContain('днём +28°, ночью −1°');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(widget()?.getAttribute('aria-label')).toBe('Погода, Худжанд: +23°, Ясно, днём +28°, ночью −1°. Открыть погоду');
  });

  it('старый прогноз — берёт новый с сайта погоды и показывает его', async () => {
    choose(KHUJAND);
    cacheFor(KHUJAND, 3 * 60 * 60 * 1000);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...sample, current: { ...sample.current, temperature_2m: 25.2 } }) });
    await open();
    await waitFor(() => expect(norm(widget()?.textContent)).toContain('+25°'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('api.open-meteo.com');
    expect(norm(widget()?.textContent)).not.toMatch(/на \d\d:\d\d/);
  });

  it('нет сети, но есть старый прогноз — показывает его и пишет, на какое время данные', async () => {
    choose(KHUJAND);
    const f = cacheFor(KHUJAND, 3 * 60 * 60 * 1000);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await open();
    await waitFor(() => expect(norm(widget()?.textContent)).toMatch(/на \d\d:\d\d/));
    expect(norm(widget()?.textContent)).toContain('+23°');
    expect(widget()?.getAttribute('aria-label')).toContain('Данные на ');
    expect(f.fetchedAt).toBeTruthy();
  });

  it('нет сети и прогноза нет — «Погода недоступна», без цифр', async () => {
    choose(KHUJAND);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await open();
    await waitFor(() => expect(norm(widget()?.textContent)).toContain('Погода недоступна'));
    expect(norm(widget()?.textContent)).toContain('Худжанд');
    expect(norm(widget()?.textContent)).not.toMatch(/[+−]\d+°/);
  });

  it('пока грузится — «Загружаем…» с объявлением для скринридера', async () => {
    choose(KHUJAND);
    fetchMock.mockReturnValue(new Promise(() => undefined));
    await open();
    const status = widget()?.querySelector('[role="status"]');
    expect(norm(status?.textContent)).toBe('Загружаем…');
  });

  it.each([
    ['не выбран город', () => undefined],
    ['выбран город, прогноз в памяти', () => (choose(KHUJAND), cacheFor(KHUJAND, 1000))],
  ])('нажатие открывает раздел «Погода»: %s', async (_name, setup) => {
    setup();
    await open();
    expect(currentPath()).toBe('/');
    await user.click(widget() as HTMLElement);
    expect(currentPath()).toBe('/weather');
  });
});
