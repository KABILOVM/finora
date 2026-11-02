import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchForecast, WeatherError, type City, type Forecast } from './api';
import { loadCache, saveCache } from './store';

/** Прогноз моложе этого не перезапрашиваем при открытии экрана. */
export const FRESH_MS = 20 * 60 * 1000;

/** Паузы перед повторами после временного сбоя (сервис ответил 5xx, нет связи, не ответил вовремя): три попытки, дальше — только вручную. */
export const RETRY_MS: readonly number[] = [5_000, 15_000, 45_000];

/**
 * Прогноз для города: сначала показывает сохранённый на устройстве, свежий (моложе 20 минут) оставляет как есть, иначе тянет новый
 * и при возврате сети обновляет снова. После временного сбоя (например, 503) сам пробует ещё раз через 5, 15 и 45 секунд; ответ 4xx
 * (в том числе «слишком часто») повторами не мучаем. `city === null` — места нет, запросов нет. Ошибка сети не стирает старые данные.
 * `retrying` — следующая попытка уже назначена.
 */
export function useForecast(city: City | null) {
  const [data, setData] = useState<Forecast | null>(() => (city ? loadCache(city.id) : null));
  const [loading, setLoading] = useState(city !== null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setRetrying(false);
  }, []);

  /** `auto` — запуск по таймеру повтора; любой другой (обновить, вернулась сеть, открыли экран) начинает отсчёт попыток заново. */
  const load = useCallback(
    async function run(auto: unknown = false): Promise<void> {
      stop();
      ctrl.current?.abort();
      if (!city) return;
      if (auto !== true) attempt.current = 0;
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      try {
        const f = await fetchForecast(city, c.signal);
        if (c.signal.aborted) return;
        saveCache(city.id, f);
        setData(f);
        setError(null);
        attempt.current = 0;
      } catch (e) {
        if (c.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Не удалось получить погоду');
        const wait = RETRY_MS[attempt.current];
        if (e instanceof WeatherError && e.transient && wait !== undefined) {
          attempt.current += 1;
          setRetrying(true);
          timer.current = setTimeout(() => void run(true), wait);
        }
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    },
    [city, stop],
  );

  useEffect(() => {
    if (!city) {
      setData(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    const cached = loadCache(city.id);
    setData(cached);
    setError(null);
    const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < FRESH_MS;
    if (fresh) setLoading(false);
    else void load();
    return () => {
      ctrl.current?.abort();
      stop();
    };
  }, [city, load, stop]);

  useEffect(() => {
    if (!city) return undefined;
    const onOnline = () => void load();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [city, load]);

  return { data, loading, error, retrying, reload: load };
}
