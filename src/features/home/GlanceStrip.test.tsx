import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { user } from '@/components/testUtils';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { parseForecast, type Forecast } from '@/features/weather/api';
import { DEFAULT_CITIES, saveCache } from '@/features/weather/store';
import { GlanceStrip } from './GlanceStrip';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const KHUJAND = DEFAULT_CITIES[1]!;

/** Прогноз на «сейчас» (15.10.2026, 14:00 по Душанбе): текущий код и коды ближайших часов. */
function forecastWith(nowCode: number, hourCodes: number[], temp: number): unknown {
  return {
    current: { time: '2026-10-15T14:00', temperature_2m: temp, apparent_temperature: temp, relative_humidity_2m: 30, weather_code: nowCode, is_day: 1, wind_speed_10m: 2, surface_pressure: 920 },
    hourly: {
      time: hourCodes.map((_, i) => `2026-10-15T${14 + i}:00`),
      temperature_2m: hourCodes.map(() => temp),
      weather_code: hourCodes,
      is_day: hourCodes.map(() => 1),
      precipitation_probability: hourCodes.map(() => 0),
    },
    daily: { time: ['2026-10-15'], weather_code: [nowCode], temperature_2m_max: [temp + 3], temperature_2m_min: [temp - 5], precipitation_probability_max: [0], sunrise: ['2026-10-15T06:20'], sunset: ['2026-10-15T17:30'] },
  };
}

function cached(json: unknown): Forecast {
  const f = { ...parseForecast(json), fetchedAt: new Date(Date.now() - 60_000).toISOString() };
  saveCache(KHUJAND.id, f);
  return f;
}

beforeEach(() => {
  pinToday();
  localStorage.clear();
  localStorage.setItem('finora:weather:cities:v1', JSON.stringify([...DEFAULT_CITIES]));
  localStorage.setItem('finora:weather:selected:v1', JSON.stringify(KHUJAND.id));
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  unpinToday();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const advice = () => document.querySelector('[data-testid="weather-advice"]') as HTMLElement | null;
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function open() {
  await showApp(
    <>
      <GlanceStrip base="TJS" />
      <LocationProbe />
    </>,
    opsDeps([]),
    '/',
  );
  await eventually(() => {
    const w = document.querySelector('[data-testid="weather-widget"]');
    expect(w).not.toBeNull();
    expect(w?.hasAttribute('aria-busy')).toBe(false);
  });
}

describe('совет по погоде под полосой «Курсы и погода»', () => {
  it('дождь — «возьмите зонт», нажатие открывает «Погоду»', async () => {
    cached(forecastWith(63, [63, 63, 0, 0, 0, 0], 18));
    await open();
    await eventually(() => expect(advice()).not.toBeNull());
    expect(norm(advice()?.textContent)).toBe('Сейчас дождь — возьмите зонт');
    await user.click(advice() as HTMLElement);
    expect(currentPath()).toBe('/weather');
  });

  it('снег — «оденьтесь потеплее»', async () => {
    cached(forecastWith(73, [73, 73, 3, 3, 3, 3], -3));
    await open();
    await eventually(() => expect(norm(advice()?.textContent)).toBe('Сейчас снег — оденьтесь потеплее'));
  });

  it('дождь ожидается позже — называет время', async () => {
    cached(forecastWith(0, [0, 0, 61, 61, 0, 0], 18));
    await open();
    await eventually(() => expect(norm(advice()?.textContent)).toBe('К 16:00 ожидается небольшой дождь — возьмите зонт'));
  });

  it('без осадков строки нет, а сама полоса на месте', async () => {
    cached(forecastWith(0, [0, 1, 2, 3, 0, 0], 22));
    await open();
    expect(advice()).toBeNull();
    expect(document.querySelector('[data-testid="home-glance"]')).not.toBeNull();
    expect(norm(document.querySelector('[data-testid="weather-widget"]')?.textContent)).toContain('+22°');
  });

  it('город не выбран — погоды нет, и совета нет', async () => {
    localStorage.clear();
    await open();
    expect(advice()).toBeNull();
  });
});
