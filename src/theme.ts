import { useSyncExternalStore } from 'react';
import { GENERATED_ACCENTS } from './lib/accentSpecs';
import { buildPalette, normalizeHex, paletteFromHex, paletteHex, PALETTE_KEYS, triple, type Palette } from './lib/palette';

/**
 * Тема оформления: «светлая» (по умолчанию), «тёмная» или «как в системе». Хранится на самом устройстве (localStorage),
 * в облако не уходит: на телефоне и на компьютере тема может быть разной.
 */
export type ThemePref = 'light' | 'dark' | 'system';

/**
 * Цвет акцента: одна из готовых палитр (src/index.css, блоки data-accent) или «свой цвет», палитру которого строит
 * src/lib/palette.ts. Хранится так же, как тема, — на устройстве. Фиолетовый — прежняя палитра приложения; она действует,
 * пока ничего не выбрано.
 */
const HAND_MADE = ['violet', 'blue', 'teal', 'green', 'orange', 'red', 'pink'] as const;

export type GeneratedAccentId = (typeof GENERATED_ACCENTS)[number]['id'];
/** Готовый акцент: у каждого есть блок в index.css. */
export type PresetAccentId = (typeof HAND_MADE)[number] | GeneratedAccentId;
/** «Свой цвет»: палитру строит приложение, блока в index.css нет; сам цвет лежит в finora-accent-custom. */
export const CUSTOM_ACCENT = 'custom';
export type AccentId = PresetAccentId | typeof CUSTOM_ACCENT;

export interface AccentOption {
  id: PresetAccentId;
  /** Название в настройках. */
  label: string;
  /** Цвет строки состояния браузера (meta theme-color) в светлой и тёмной теме: это фон страницы, --ac-bg-l и --ac-bg-d в index.css. */
  bar: { light: string; dark: string };
}

const VIOLET: AccentOption = { id: 'violet', label: 'Фиолетовый', bar: { light: '#eceefb', dark: '#080a18' } };

/** Цвет строки состояния для палитры: фон светлой и тёмной темы. */
const barOf = (p: Palette): AccentOption['bar'] => ({ light: paletteHex(p, 'bg-l'), dark: paletteHex(p, 'bg-d') });

const generated = (id: GeneratedAccentId): AccentOption => {
  const spec = GENERATED_ACCENTS.find((a) => a.id === id);
  if (!spec) throw new Error(`Нет описания акцента ${id}`);
  return { id, label: spec.label, bar: barOf(buildPalette(spec)) };
};

/**
 * Порядок — как в настройках: по кругу оттенков, затем спокойные. Каждому акценту должен соответствовать блок в index.css
 * (это проверяет src/accents.test.ts). Фиолетовый всегда первый.
 */
export const ACCENTS: readonly AccentOption[] = [
  VIOLET,
  generated('purple'),
  generated('orchid'),
  generated('magenta'),
  { id: 'pink', label: 'Розовый', bar: { light: '#faebf0', dark: '#15070e' } },
  generated('crimson'),
  { id: 'red', label: 'Красный', bar: { light: '#fbebe8', dark: '#170705' } },
  generated('coral'),
  { id: 'orange', label: 'Оранжевый', bar: { light: '#faebe6', dark: '#160703' } },
  generated('peach'),
  generated('amber'),
  generated('mustard'),
  generated('olive'),
  generated('lime'),
  { id: 'green', label: 'Зелёный', bar: { light: '#e7f2e8', dark: '#030d04' } },
  generated('emerald'),
  generated('mint'),
  { id: 'teal', label: 'Бирюзовый', bar: { light: '#e1f2f2', dark: '#000e0e' } },
  generated('cyan'),
  generated('sky'),
  { id: 'blue', label: 'Синий', bar: { light: '#e8effb', dark: '#040c18' } },
  generated('lavender'),
  generated('slate'),
  generated('graphite'),
  generated('brown'),
  generated('sand'),
];

export const DEFAULT_ACCENT: AccentId = VIOLET.id;

const KEY = 'finora-theme';
const ACCENT_KEY = 'finora-accent';
const CUSTOM_KEY = 'finora-accent-custom';
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

/** Сохранённый «свой цвет» (#rrggbb) или null, если его не выбирали или значение испорчено. */
export function readCustomAccent(): string | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw === null ? null : normalizeHex(raw);
  } catch {
    /* хранилище недоступно — своего цвета нет */
    return null;
  }
}

export function readAccentPref(): AccentId {
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    // «свой цвет» без сохранённого цвета (стёрли хранилище частично) — как не выбранный
    if (stored === CUSTOM_ACCENT) return readCustomAccent() !== null ? CUSTOM_ACCENT : DEFAULT_ACCENT;
    const found = accentById(stored);
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
  const accent = root.getAttribute('data-accent');
  const bar = accent === CUSTOM_ACCENT ? customBar(root) : (accentById(accent) ?? VIOLET).bar;
  // В index.html два meta theme-color (для светлой и тёмной системы). Явный выбор темы перекрывает оба.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const systemDark = (m.getAttribute('media') ?? '').includes('dark');
    const dark = theme === 'dark' || (theme !== 'light' && systemDark);
    m.setAttribute('content', dark ? bar.dark : bar.light);
  });
}

/** Фон страницы у «своего цвета»: берётся из переменных, которые applyAccent поставил на <html>. */
function customBar(root: HTMLElement): AccentOption['bar'] {
  const hex = (name: string, fallback: string): string => {
    const parts = root.style.getPropertyValue(name).trim().split(' ').map(Number);
    return parts.length === 3 && parts.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)
      ? `#${parts.map((c) => c.toString(16).padStart(2, '0')).join('')}`
      : fallback;
  };
  return { light: hex('--ac-bg-l', VIOLET.bar.light), dark: hex('--ac-bg-d', VIOLET.bar.dark) };
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

/** Убирает с <html> палитру «своего цвета» (переменные --ac-*), чтобы снова работали блоки index.css. */
function clearCustomVars(root: HTMLElement): void {
  for (const key of PALETTE_KEYS) root.style.removeProperty(`--ac-${key}`);
}

/**
 * Ставит атрибут data-accent на <html> (у фиолетового — без атрибута: так работает прежняя палитра) и цвет строки состояния.
 * «Свой цвет» атрибут получает тоже, а его палитра ставится прямо на <html> переменными --ac-*: они перекрывают блоки index.css.
 * Цвет берётся из `customHex` или из хранилища; если его нет (или он испорчен), применяется фиолетовый.
 */
export function applyAccent(id: AccentId, customHex: string | null = id === CUSTOM_ACCENT ? readCustomAccent() : null): void {
  const root = document.documentElement;
  clearCustomVars(root);
  const palette = id === CUSTOM_ACCENT && customHex !== null ? paletteFromHex(customHex) : null;
  if (palette) {
    for (const key of PALETTE_KEYS) root.style.setProperty(`--ac-${key}`, triple(palette[key]));
    root.setAttribute('data-accent', CUSTOM_ACCENT);
  } else if (id === DEFAULT_ACCENT || id === CUSTOM_ACCENT) root.removeAttribute('data-accent');
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

/** Запоминает «свой цвет» и сразу выбирает его акцентом. Не цвет (испорченная строка) — ничего не меняет и возвращает false. */
export function saveCustomAccent(hex: string): boolean {
  const clean = normalizeHex(hex);
  if (clean === null || paletteFromHex(clean) === null) return false;
  try {
    localStorage.setItem(CUSTOM_KEY, clean);
    localStorage.setItem(ACCENT_KEY, CUSTOM_ACCENT);
  } catch {
    /* не сохранилось — цвет всё равно применится до перезагрузки */
  }
  applyAccent(CUSTOM_ACCENT, clean);
  window.dispatchEvent(new Event(EVENT));
  return true;
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

/**
 * «Свой цвет» (#rrggbb, null — не выбирали) и функция, которая запоминает цвет и выбирает его акцентом.
 * Хранилище читается заново на каждый кадр, поэтому значение берём строкой (одинаковая строка — без перерисовки).
 */
export function useCustomAccent(): [string | null, (hex: string) => boolean] {
  const hex = useSyncExternalStore(subscribe, readCustomAccent, () => null);
  return [hex, saveCustomAccent];
}
