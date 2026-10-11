import { useSyncExternalStore } from 'react';

/**
 * Тема оформления: «светлая» (по умолчанию), «тёмная» или «как в системе». Хранится на самом устройстве (localStorage),
 * в облако не уходит: на телефоне и на компьютере тема может быть разной.
 */
export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'finora-theme';
const EVENT = 'finora-theme-change';
const LIGHT_COLOR = '#eceefb';
const DARK_COLOR = '#080a18';

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* хранилище недоступно (например, закрытый режим) — берём тему по умолчанию */
  }
  return 'light';
}

/** Какая тема видна на самом деле (для «как в системе» — по настройке устройства). */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  const dark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

/** Ставит атрибут на <html> и цвет строки состояния браузера. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') {
    root.removeAttribute('data-theme');
    root.style.colorScheme = 'light dark';
  } else {
    root.setAttribute('data-theme', pref);
    root.style.colorScheme = pref;
  }
  // В index.html два meta theme-color (для светлой и тёмной системы). Явный выбор перекрывает оба.
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((m) => {
    const media = m.getAttribute('media') ?? '';
    const systemColor = media.includes('dark') ? DARK_COLOR : LIGHT_COLOR;
    m.setAttribute('content', pref === 'system' ? systemColor : pref === 'dark' ? DARK_COLOR : LIGHT_COLOR);
  });
}

export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* не сохранилось — тема всё равно применится до перезагрузки */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

/** Текущий выбор темы и функция для его смены; компоненты обновляются сами. */
export function useThemePref(): [ThemePref, (pref: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, readThemePref, () => 'light' as ThemePref);
  return [pref, saveThemePref];
}
