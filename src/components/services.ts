import { useEffect, useSyncExternalStore } from 'react';
import { SERVICES, SERVICE_GROUPS, type ServiceMeta } from './serviceData';

/**
 * Логотипы популярных сервисов (Netflix, Spotify, Claude, PayPal…) для значков категорий и кошельков. В поле icon хранится «s:<id>»,
 * схема данных не меняется. Каталог (id, название, цвет плитки) маленький и лежит в основном файле; сами пути логотипов — в
 * serviceLogos/logos-<группа>.ts, их создаёт scripts/gen-services.cjs. Каждая группа грузится отдельным файлом и только тогда, когда
 * на экране появился её сервис (файлы лежат в офлайн-кэше приложения, как и всё остальное).
 */
export { SERVICES, SERVICE_GROUPS };
export type { ServiceMeta };

/** Логотип: [viewBox, путь]. Рисуется одним цветом. */
export type Logo = readonly [viewBox: string, path: string];
type GroupLogos = Readonly<Record<string, Logo>>;

const BY_ID: ReadonlyMap<string, ServiceMeta> = new Map(SERVICES.map((s) => [s.id, s]));

export const serviceById = (id: string): ServiceMeta | undefined => BY_ID.get(id);

/** Значение поля icon для сервиса. */
export const serviceValue = (id: string): string => `s:${id}`;

/** Загрузчики по группам. Новая группа в gen-services.cjs — новая строка здесь (тест следит, чтобы они совпадали). */
export const LOGO_LOADERS: ReadonlyMap<string, () => Promise<{ LOGOS: GroupLogos }>> = new Map([
  ['media', () => import('./serviceLogos/logos-media')],
  ['work', () => import('./serviceLogos/logos-work')],
  ['cloud', () => import('./serviceLogos/logos-cloud')],
  ['pay', () => import('./serviceLogos/logos-pay')],
  ['social', () => import('./serviceLogos/logos-social')],
  ['games', () => import('./serviceLogos/logos-games')],
  ['shop', () => import('./serviceLogos/logos-shop')],
]);

const loaded = new Map<string, GroupLogos>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/** Загружает логотипы группы (один раз). Никогда не отклоняется: при сбое значок остаётся пустой плиткой, а следующий показ попробует снова. */
export function loadServiceLogos(group: string): Promise<void> {
  const load = LOGO_LOADERS.get(group);
  if (!load || loaded.has(group)) return Promise.resolve();
  let pending = loading.get(group);
  if (!pending) {
    pending = load()
      .then(
        (m) => {
          loaded.set(group, m.LOGOS);
        },
        (e: unknown) => {
          console.error('Не удалось загрузить логотипы сервисов:', e);
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

/** Логотип сервиса; null, пока файл его группы грузится (или такого сервиса нет). */
export function useServiceLogo(id: string): Logo | null {
  const group = BY_ID.get(id)?.group ?? '';
  const logos = useSyncExternalStore(subscribe, () => loaded.get(group));
  useEffect(() => {
    void loadServiceLogos(group);
  }, [group]);
  return logos?.[id] ?? null;
}

/** Строка для сравнения: без регистра, пробелов, знаков и точек («Apple Music» = «applemusic», «Booking.com» = «bookingcom»). */
const squash = (s: string): string => s.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, '');

/** Ключ для поиска (id, название, слова-синонимы) → id сервиса. При совпадении ключей побеждает сервис, стоящий в списке выше. */
const KEYS = new Map<string, string>();
for (const s of SERVICES) {
  for (const raw of [s.id, s.name, ...(s.keys ?? [])]) {
    const k = squash(raw);
    if (k !== '' && !KEYS.has(k)) KEYS.set(k, s.id);
  }
}

/**
 * Сервис по названию категории: «Netflix», «Подписка на нетфликс», «Apple Music», «Телеграм-канал».
 * Узнаёт только целые слова (и пары слов), не начала: «Виза» или «Киви» сервисами не считаются.
 */
export function findServiceByName(name: string): ServiceMeta | undefined {
  const whole = KEYS.get(squash(name));
  if (whole !== undefined) return BY_ID.get(whole);
  const words = name.toLocaleLowerCase('ru').split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1];
    const id = (next !== undefined ? KEYS.get(word + next) : undefined) ?? (word.length >= 2 ? KEYS.get(word) : undefined);
    if (id !== undefined) return BY_ID.get(id);
  }
  return undefined;
}
