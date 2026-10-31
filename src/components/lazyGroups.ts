import { useEffect, useSyncExternalStore } from 'react';

/**
 * Данные, которые лежат отдельными файлами по группам и грузятся лениво (логотипы сервисов, дополнительные значки): группа загружается один раз,
 * только когда на экране появился её элемент. Файлы лежат в офлайн-кэше приложения, как и всё остальное.
 * `loaders` читается в момент загрузки (не при создании): тесты подменяют загрузчик, чтобы проверить сбой.
 */
export function createLazyGroups<M, T>(
  loaders: ReadonlyMap<string, () => Promise<M>>,
  pick: (module: M) => Readonly<Record<string, T>>,
  failureText: string,
) {
  const loaded = new Map<string, Readonly<Record<string, T>>>();
  const loading = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();

  /** Загружает группу (один раз). Никогда не отклоняется: при сбое элемент остаётся пустой плиткой, а следующий показ попробует снова. */
  function load(group: string): Promise<void> {
    const loader = loaders.get(group);
    if (!loader || loaded.has(group)) return Promise.resolve();
    let pending = loading.get(group);
    if (!pending) {
      pending = loader()
        .then(
          (m) => {
            loaded.set(group, pick(m));
          },
          (e: unknown) => {
            console.error(failureText, e);
          },
        )
        .finally(() => {
          loading.delete(group);
          for (const notify of listeners) notify();
        });
      loading.set(group, pending);
    }
    return pending;
  }

  const subscribe = (notify: () => void): (() => void) => {
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  };

  /** Данные группы; undefined, пока файл грузится (или такой группы нет). Сама запускает загрузку. */
  function useGroup(group: string): Readonly<Record<string, T>> | undefined {
    const data = useSyncExternalStore(subscribe, () => loaded.get(group));
    useEffect(() => {
      void load(group);
    }, [group]);
    return data;
  }

  return { load, useGroup };
}
