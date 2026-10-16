import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchForecast, type City, type Forecast } from './api';
import { loadCache, saveCache } from './store';

/** Прогноз моложе этого не перезапрашиваем при открытии экрана. */
export const FRESH_MS = 20 * 60 * 1000;

/**
 * Прогноз для города: сначала показывает сохранённый на устройстве, свежий (моложе 20 минут) оставляет как есть, иначе тянет новый
 * и при возврате сети обновляет снова. `city === null` — места нет, запросов нет. Ошибка сети не стирает старые данные.
 */
export function useForecast(city: City | null) {
  const [data, setData] = useState<Forecast | null>(() => (city ? loadCache(city.id) : null));
  const [loading, setLoading] = useState(city !== null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctrl.current?.abort();
    if (!city) return;
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    try {
      const f = await fetchForecast(city, c.signal);
      if (c.signal.aborted) return;
      saveCache(city.id, f);
      setData(f);
      setError(null);
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Не удалось получить погоду');
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [city]);

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
    return () => ctrl.current?.abort();
  }, [city, load]);

  useEffect(() => {
    if (!city) return undefined;
    const onOnline = () => void load();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [city, load]);

  return { data, loading, error, reload: load };
}
