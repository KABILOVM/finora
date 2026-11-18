import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useOptionalStore } from '@/db';

/** Как часто перечитывать сохранённый прогноз (его обновляет «Погода», когда её открывают). */
const REREAD_MS = 60_000;

// Чтение прогноза тянет за собой разбор городов и список городов по умолчанию: основному файлу это ни к чему, поэтому код грузится
// отдельным файлом, когда он понадобился (есть хранилище и настройки прочитаны).
let reader: Promise<typeof import('./weatherSky')> | null = null;
const loadReader = () => (reader ??= import('./weatherSky'));

/**
 * Код текущей погоды выбранного города из сохранённого на устройстве прогноза (см. weatherSky.ts). Ничего не запрашивает по сети:
 * прогноз обновляется там, где человек сам смотрит погоду. null — погоды нет (города нет, прогноза нет, он устарел, хранилища нет:
 * до входа, в тестах). undefined — ещё читается: пока ответа нет, эффект не показывают, чтобы сезон не мигнул перед дождём.
 */
export function useWeatherCode(): number | null | undefined {
  const store = useOptionalStore();
  const setting = useLiveQuery(async () => (store ? ((await store.settings.get())?.weather ?? null) : null), [store]);
  const [code, setCode] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!store) {
      setCode(null);
      return undefined;
    }
    if (setting === undefined) return undefined;
    let alive = true;
    let off: (() => void) | null = null;
    void loadReader().then(
      ({ cachedWeatherCode, chosenCity }) => {
        if (!alive) return;
        const read = () => setCode(cachedWeatherCode(chosenCity(setting), Date.now()));
        read();
        const timer = window.setInterval(read, REREAD_MS);
        const onShow = () => {
          if (!document.hidden) read();
        };
        document.addEventListener('visibilitychange', onShow);
        window.addEventListener('focus', read);
        window.addEventListener('storage', read);
        off = () => {
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', onShow);
          window.removeEventListener('focus', read);
          window.removeEventListener('storage', read);
        };
      },
      () => alive && setCode(null), // файл не загрузился (нет сети и нет в кэше) — погоды нет
    );
    return () => {
      alive = false;
      off?.();
    };
  }, [store, setting]);

  return code;
}
