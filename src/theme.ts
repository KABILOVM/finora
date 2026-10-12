import { useSyncExternalStore } from 'react';

/**
 * Тема оформления: «светлая» (по умолчанию), «тёмная» или «как в системе». Хранится на самом устройстве (localStorage),
 * в облако не уходит: на телефоне и на компьютере тема может быть разной.
 */
export type ThemePref = 'light' | 'dark' | 'system';

/**
 * Цвет акцента: одна из готовых палитр (src/index.css, блоки data-accent). Хранится так же, как тема, — на устройстве.
 * Фиолетовый — прежняя палитра приложения; она действует, пока ничего не выбрано.
 */
export type AccentId = 'violet' | 'blue' | 'teal' | 'green' | 'orange' | 'red' | 'pink';

export interface AccentOption {
  id: AccentId;
  /** Название в настройках. */
  label: string;
  /** Цвет строки состояния браузера (meta theme-color) в светлой и тёмной теме: это фон страницы, --ac-bg-l и --ac-bg-d в index.css. */
  bar: { light: string; dark: string };
}

const VIOLET: AccentOption = { id: 'violet', label: 'Фиолетовый', bar: { light: '#eceefb', dark: '#080a18' } };

/** Порядок — как в настройках. Каждому акценту должен соответствовать блок в index.css (это проверяет src/accents.test.ts). */
export const ACCENTS: readonly AccentOption[] = [
  VIOLET,
  { id: 'blue', label: 'Синий', bar: { light: '#e8effb', dark: '#040c18' } },
  { id: 'teal', label: 'Бирюзовый', bar: { light: '#e1f2f2', dark: '#000e0e' } },
  { id: 'green', label: 'Зелёный', bar: { light: '#e7f2e8', dark: '#030d04' } },
  { id: 'orange', label: 'Оранжевый', bar: { light: '#faebe6', dark: '#160703' } },
  { id: 'red', label: 'Красный', bar: { light: '#fbebe8', dark: '#170705' } },
  { id: 'pink', label: 'Розовый', bar: { light: '#faebf0', dark: '#15070e' } },
];

export const DEFAULT_ACCENT: AccentId = VIOLET.id;

const KEY = 'finora-theme';
const ACCENT_KEY = 'finora-accent';
const EVENT = 'finora-theme-change';

const accentById = (id: string | null): AccentOption | undefined => ACCENTS.find((a) => a.id === id);

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* хранилище недоступно (например, закрытый режим) — берём тему по умолчанию */
  }
  return 'light';
}

export function readAccentPref(): AccentId {
  try {
    const found = accentById(localStorage.getItem(ACCENT_KEY));
    if (found) return found.id;
  } catch {
    /* хранилище недоступно — берём акцент по умолчанию */
  }
  return DEFAULT_ACCENT;
}

/** Какая тема видна на самом деле (для «как в системе» — по настройке устройства). */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  const dark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

/**
 * Цвет строки состояния браузера = фон страницы при нынешних теме и акценте. Всё читается с <html>, поэтому
 * applyTheme и applyAccent можно вызывать в любом порядке.
 */
function paintBar(): void {
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme'); // атрибута нет — тема «как в системе»
  const bar = (accentById(root.getAttribute('data-accent')) ?? VIOLET).bar;
  // В index.html два meta theme-color (для светлой и тёмной системы). Явный выбор темы перекрывает оба.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const systemDark = (m.getAttribute('media') ?? '').includes('dark');
    const dark = theme === 'dark' || (theme !== 'light' && systemDark);
    m.setAttribute('content', dark ? bar.dark : bar.light);
  });
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
  paintBar();
}

/** Ставит атрибут data-accent на <html> (у фиолетового — без атрибута: так работает прежняя палитра) и цвет строки состояния. */
export function applyAccent(id: AccentId): void {
  const root = document.documentElement;
  if (id === DEFAULT_ACCENT) root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', id);
  paintBar();
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

export function saveAccentPref(id: AccentId): void {
  try {
    localStorage.setItem(ACCENT_KEY, id);
  } catch {
    /* не сохранилось — акцент всё равно применится до перезагрузки */
  }
  applyAccent(id);
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

/** Текущий цвет акцента и функция для его смены; компоненты обновляются сами. */
export function useAccentPref(): [AccentId, (id: AccentId) => void] {
  const id = useSyncExternalStore(subscribe, readAccentPref, () => DEFAULT_ACCENT);
  return [id, saveAccentPref];
}
