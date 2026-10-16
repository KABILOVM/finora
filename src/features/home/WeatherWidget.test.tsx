import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { user, waitFor } from '@/components/testUtils';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import type { Store } from '@/db';
import { stringifyWeather } from '@/domain/weatherPlaces';
import { parseForecast, type City, type Forecast } from '@/features/weather/api';
import { DEFAULT_CITIES, saveCache } from '@/features/weather/store';
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

/** Прежнее хранилище устройства (до переезда в настройки): человек уже выбирал этот город здесь. */
function choose(city: City): void {
  localStorage.setItem('finora:weather:cities:v1', JSON.stringify([...DEFAULT_CITIES]));
  localStorage.setItem('finora:weather:selected:v1', JSON.stringify(city.id));
}
/** Города в настройках (так они приходят с другого устройства). */
const weatherOf = (selected: City | null, cities: readonly City[] = DEFAULT_CITIES) =>
  stringifyWeather({ selected: selected?.id ?? null, cities: [...cities] });
function cacheFor(city: City, ageMs: number): Forecast {
  const f = { ...parseForecast(sample), fetchedAt: new Date(Date.now() - ageMs).toISOString() };
  saveCache(city.id, f);
  return f;
}

async function open(setup?: (s: Store) => Promise<unknown>) {
  const td = opsDeps([], { setup: setup ? async (s) => void (await setup(s)) : undefined });
  await showApp(
    <>
      <WeatherWidget />
      <LocationProbe />
    </>,
    td,
    '/',
  );
  // пока читаются настройки, на месте карточки мерцающая заглушка (aria-busy): ждём настоящую
  await eventually(() => {
    expect(widget()).not.toBeNull();
    expect(widget()?.hasAttribute('aria-busy')).toBe(false);
  });
  return td;
}

describe('виджет «Погода» на «Главной»', () => {
  it('город не выбран — предлагает определить место или выбрать город и в сеть не ходит', async () => {
    await open();
    expect(norm(widget()?.textContent)).toContain('Определить место');
    expect(widget()?.querySelector('a[aria-label="Выбрать город"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('город по умолчанию из списка, но не выбранный человеком, считается невыбранным', async () => {
    localStorage.setItem('finora:weather:cities:v1', JSON.stringify([...DEFAULT_CITIES])); // список есть, выбора нет
    await open();
    expect(widget()?.querySelector('a[aria-label="Выбрать город"]')).not.toBeNull();
    expect(norm(widget()?.textContent)).toContain('Определить место');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('свежий прогноз из памяти устройства — показывает без запроса: температура и город; состояние и «днём/ночью» — в имени ссылки', async () => {
    choose(KHUJAND);
    cacheFor(KHUJAND, 5 * 60 * 1000);
    await open();
    const text = norm(widget()?.textContent);
    expect(text).toContain('+23°');
    expect(text).toContain('Худжанд');
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
    expect(widget()?.getAttribute('aria-label')).not.toContain('Данные на ');
  });

  it('нет сети, но есть старый прогноз — показывает его и пишет, на какое время данные', async () => {
    choose(KHUJAND);
    const f = cacheFor(KHUJAND, 3 * 60 * 60 * 1000);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await open();
    await waitFor(() => expect(widget()?.getAttribute('aria-label')).toMatch(/Данные на \d\d:\d\d/));
    expect(norm(widget()?.textContent)).toContain('+23°');
    expect(widget()?.querySelector('[title^="Данные на"]')).not.toBeNull(); // жёлтая точка у карточки
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

  it('нажатие на карточку с погодой открывает раздел «Погода»', async () => {
    choose(KHUJAND);
    cacheFor(KHUJAND, 1000);
    await open();
    expect(currentPath()).toBe('/');
    await user.click(widget() as HTMLElement);
    expect(currentPath()).toBe('/weather');
  });

  describe('выбор в настройках (приходит с другого устройства)', () => {
    const KH = DEFAULT_CITIES[1]!;
    const BO = DEFAULT_CITIES[2]!;

    it('город из настроек показывается без всякого выбора на этом устройстве', async () => {
      cacheFor(KH, 1000);
      await open((s) => s.settings.update({ weather: weatherOf(KH) }));
      expect(norm(widget()?.textContent)).toContain('Худжанд');
      expect(norm(widget()?.textContent)).toContain('+23°');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('настройки главнее прежнего выбора на устройстве', async () => {
      choose(KH);
      cacheFor(KH, 1000);
      cacheFor(BO, 1000);
      await open((s) => s.settings.update({ weather: weatherOf(BO) }));
      expect(norm(widget()?.textContent)).toContain('Бохтар');
      expect(norm(widget()?.textContent)).not.toContain('Худжанд');
    });

    it('выбор сменили на другом устройстве, пока главная открыта, — карточка переключается сама', async () => {
      cacheFor(KH, 1000);
      cacheFor(BO, 1000);
      const td = await open((s) => s.settings.update({ weather: weatherOf(KH) }));
      expect(norm(widget()?.textContent)).toContain('Худжанд');
      await storeOf(td).settings.update({ weather: weatherOf(BO) });
      await waitFor(() => expect(norm(widget()?.textContent)).toContain('Бохтар'));
    });

    it('настройки испорчены или от незнакомой версии — как «ничего не выбрано», без ошибок', async () => {
      const td = await open((s) => s.db.settings.update(s.userId, { weather: '{"v":9}' }).then(() => undefined));
      expect(norm(widget()?.textContent)).toContain('Определить место');
      expect(storeOf(td)).toBeTruthy();
    });

    it('добавили город на другом устройстве, а выбранный прежний — прогноз заново не запрашивается', async () => {
      cacheFor(KH, 1000);
      const td = await open((s) => s.settings.update({ weather: weatherOf(KH) }));
      const bigger = [...DEFAULT_CITIES, { id: '1.00,1.00', name: 'Ещё', region: '', lat: 1, lon: 1 }];
      await storeOf(td).settings.update({ weather: weatherOf(KH, bigger) });
      await waitFor(() => expect(norm(widget()?.textContent)).toContain('Худжанд'));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('место не выбрано: «Определить место» и «Выбрать город»', () => {
    const button = () => widget()?.querySelector('button') as HTMLButtonElement;
    const setGeo = (getCurrentPosition: (ok: (p: unknown) => void, fail: (e: { code: number }) => void) => void) =>
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'geolocation');
    });

    it('«Выбрать город» ведёт в раздел «Погода»', async () => {
      await open();
      await user.click(widget()!.querySelector('a') as HTMLElement);
      expect(currentPath()).toBe('/weather');
    });

    it('местоположение спрашивается только по нажатию, а не при открытии главной', async () => {
      const ask = vi.fn();
      setGeo(ask);
      await open();
      expect(ask).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('устройство назвало место → оно запоминается (с округлением) и выбирается, берётся прогноз и показывается погода', async () => {
      setGeo((ok) => ok({ coords: { latitude: 37.50321, longitude: 70.24987 } }));
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => sample });
      const td = await open();
      await user.click(button());
      await waitFor(() => expect(norm(widget()?.textContent)).toContain('+23°'));
      expect(norm(widget()?.textContent)).toContain('Моё местоположение');
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.searchParams.get('latitude')).toBe('37.5');
      expect(url.searchParams.get('longitude')).toBe('70.25');
      // выбор лёг в настройки (они уедут на другие устройства), а прежнее хранилище устройства не трогали
      const saved = JSON.parse((await storeOf(td).settings.get())!.weather!) as { selected: string; cities: { id: string; here?: true }[] };
      expect(saved.selected).toBe('37.50,70.25');
      expect(saved.cities.find((c) => c.here)).toMatchObject({ id: '37.50,70.25', lat: 37.5, lon: 70.25 });
      expect(saved.cities.slice(0, 3).map((c) => c.id)).toEqual(DEFAULT_CITIES.map((c) => c.id));
      expect(localStorage.getItem('finora:weather:selected:v1')).toBeNull();
    });

    it('отказ в доступе — понятное сообщение, прогноза нет, карточка остаётся с выбором города', async () => {
      setGeo((_ok, fail) => fail({ code: 1 }));
      const td = await open();
      await user.click(button());
      const alert = await waitFor(() => {
        const a = widget()?.querySelector('[role="alert"]');
        if (!a) throw new Error('нет сообщения');
        return a;
      });
      expect(norm(alert.textContent)).toContain('Доступ к местоположению не разрешён');
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await storeOf(td).settings.get())?.weather).toBeNull();
      expect(widget()?.querySelector('a[aria-label="Выбрать город"]')).not.toBeNull();
    });

    it('кнопка занята, пока устройство отвечает: второе нажатие не плодит запросов', async () => {
      const ask = vi.fn();
      setGeo(ask);
      await open();
      await user.click(button());
      await waitFor(() => expect(button().disabled).toBe(true));
      expect(button().getAttribute('aria-busy')).toBe('true');
      await user.click(button());
      expect(ask).toHaveBeenCalledTimes(1);
    });
  });
});
