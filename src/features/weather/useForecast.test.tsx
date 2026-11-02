import { act, renderHook } from '@/rates/__fixtures__/reactTestkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseForecast, type City } from './api';
import { saveCache } from './store';
import { RETRY_MS, useForecast } from './useForecast';

const CITY: City = { id: '38.56,68.79', name: 'Душанбе', region: 'Таджикистан', lat: 38.5598, lon: 68.787 };

const sample = {
  current: { time: '2026-10-15T12:00', temperature_2m: 23.4, apparent_temperature: 22, relative_humidity_2m: 30, weather_code: 0, is_day: 1, wind_speed_10m: 2, surface_pressure: 920 },
  hourly: { time: ['2026-10-15T12:00'], temperature_2m: [23], weather_code: [0], is_day: [1], precipitation_probability: [0] },
  daily: { time: ['2026-10-15'], weather_code: [0], temperature_2m_max: [27], temperature_2m_min: [9], precipitation_probability_max: [0], sunrise: ['2026-10-15T06:20'], sunset: ['2026-10-15T17:30'] },
};

const ok = () => ({ ok: true, status: 200, json: async () => sample });
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Дать завершиться запросам и их обработке. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('useForecast: повтор после временного сбоя', () => {
  it('503: пробует ещё раз через 5, 15 и 45 секунд, потом перестаёт', async () => {
    fetchMock.mockResolvedValue(bad(503));
    const { result } = renderHook(() => useForecast(CITY));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('Сервис погоды ответил ошибкой 503');
    expect(result.current.retrying).toBe(true);

    await wait(RETRY_MS[0]! - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await wait(RETRY_MS[1]!);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await wait(RETRY_MS[2]!);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // три повтора исчерпаны: сами больше не ходим
    expect(result.current.retrying).toBe(false);
    expect(result.current.error).not.toBeNull();
    await wait(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('повтор получился — ошибка уходит, данные новые, повторов больше нет', async () => {
    fetchMock.mockResolvedValueOnce(bad(503)).mockResolvedValue(ok());
    const { result } = renderHook(() => useForecast(CITY));
    await settle();
    expect(result.current.error).not.toBeNull();
    await wait(RETRY_MS[0]!);
    expect(result.current.error).toBeNull();
    expect(result.current.retrying).toBe(false);
    expect(result.current.data?.current.temp).toBe(23.4);
    await wait(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('нет связи и «не ответили вовремя» — тоже временный сбой', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(ok());
    const { result } = renderHook(() => useForecast(CITY));
    await settle();
    expect(result.current.error).toBe('Нет связи с сервисом погоды');
    expect(result.current.retrying).toBe(true);
    await wait(RETRY_MS[0]!);
    expect(result.current.error).toBeNull();
  });

  it.each([404, 429])('ответ %i повторами не мучаем', async (status) => {
    fetchMock.mockResolvedValue(bad(status));
    const { result } = renderHook(() => useForecast(CITY));
    await settle();
    expect(result.current.error).toBe(`Сервис погоды ответил ошибкой ${status}`);
    expect(result.current.retrying).toBe(false);
    await wait(2 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('мусор в ответе — не временный сбой, без повторов', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ current: {} }) });
    const { result } = renderHook(() => useForecast(CITY));
    await settle();
    expect(result.current.error).toBe('В ответе нет текущей погоды');
    expect(result.current.retrying).toBe(false);
  });

  it('повтор не стирает старые данные: показываем прежние, пока не получится', async () => {
    const old = { ...parseForecast(sample), fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() };
    saveCache(CITY.id, old);
    fetchMock.mockResolvedValue(bad(503));
    const { result } = renderHook(() => useForecast(CITY));
    await settle();
    expect(result.current.data?.fetchedAt).toBe(old.fetchedAt);
    expect(result.current.error).not.toBeNull();
    await wait(RETRY_MS[0]!);
    expect(result.current.data?.fetchedAt).toBe(old.fetchedAt);
  });

  it('«обновить» вручную начинает отсчёт попыток заново и сразу ходит в сеть', async () => {
    fetchMock.mockResolvedValue(bad(503));
    const { result } = renderHook(() => useForecast(CITY));
    await settle();
    await wait(RETRY_MS[0]! + RETRY_MS[1]! + RETRY_MS[2]!);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.retrying).toBe(false);

    fetchMock.mockClear();
    await act(async () => {
      await result.current.reload();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.retrying).toBe(true); // снова три попытки
    await wait(RETRY_MS[0]!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('закрытие экрана отменяет назначенный повтор', async () => {
    fetchMock.mockResolvedValue(bad(503));
    const { result, unmount } = renderHook(() => useForecast(CITY));
    await settle();
    expect(result.current.retrying).toBe(true);
    unmount();
    await wait(2 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('вернулась сеть — обновляет сразу, не дожидаясь повтора', async () => {
    fetchMock.mockResolvedValueOnce(bad(503)).mockResolvedValue(ok());
    const { result } = renderHook(() => useForecast(CITY));
    await settle();
    expect(result.current.error).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.retrying).toBe(false);
  });
});
