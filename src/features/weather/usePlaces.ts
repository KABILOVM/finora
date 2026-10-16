import { useCallback, useMemo, useRef } from 'react';
import { useSettings, useStore } from '@/db';
import { parseWeather, stringifyWeather } from '@/domain/weatherPlaces';
import type { City } from './api';
import type { PlacesChange } from './places';
import { loadLegacyPlaces } from './store';

const sameSpot = (a: City, b: City) => a.id === b.id && a.name === b.name && a.region === b.region && a.lat === b.lat && a.lon === b.lon;

/**
 * Города для погоды и выбранный город. Хранятся в настройках и ездят между устройствами; пока в настройках пусто, показываем то,
 * что человек выбрал раньше на этом устройстве (прежнее хранилище, только чтение), а до выбора — города по умолчанию.
 * `chosen` — выбранный город или null, если человек ещё не выбирал (тогда прогноз без его ведома не запрашивается).
 */
export function usePlaces() {
  const store = useStore();
  const settings = useSettings();
  const weather = settings?.weather ?? null;
  const legacy = useMemo(loadLegacyPlaces, []);

  const { cities, selectedId } = useMemo(() => {
    const saved = parseWeather(weather);
    return saved ? { cities: saved.cities as City[], selectedId: saved.selected } : legacy;
  }, [weather, legacy]);

  // Тот же город — тот же объект: иначе любая правка списка (другой город добавили или убрали) перезапрашивала бы прогноз.
  const prev = useRef<City | null>(null);
  const chosen = useMemo(() => {
    const c = cities.find((x) => x.id === selectedId) ?? null;
    if (c && prev.current && sameSpot(prev.current, c)) return prev.current;
    prev.current = c;
    return c;
  }, [cities, selectedId]);

  const commit = useCallback(
    async (change: PlacesChange): Promise<void> => {
      await store.settings.update({ weather: stringifyWeather({ selected: change.selectedId, cities: change.cities }) });
    },
    [store],
  );

  return { ready: settings !== undefined, cities, selectedId, chosen, commit };
}
