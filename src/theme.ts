import { useSyncExternalStore } from 'react';
import { GENERATED_ACCENTS } from './lib/accentSpecs';
import { isPalette, normalizeHex, PALETTE_KEYS, triple, type Palette } from './lib/paletteBase';
import { setSkinIconPack } from './components/skinIconStore';
import { clearCustomSkin, customSkinBar, paintCustomSkin, readActiveCustomSkin, type CustomSkin } from './customSkin';
import {
  CUSTOM_SKIN,
  DEFAULT_SKIN,
  isBaseSkin,
  isSkinId,
  LEGACY_SKIN,
  parseTraits,
  resolveSkin,
  SKIN_ICON_PACKS,
  skinBar,
  skinTraits,
  type SkinId,
  type SkinTraits,
} from './skinCore';

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
type HandMadeAccentId = 'violet' | 'blue' | 'teal' | 'green' | 'orange' | 'red' | 'pink';

export type GeneratedAccentId = (typeof GENERATED_ACCENTS)[number]['id'];
/** Готовый акцент: у каждого есть блок в index.css. */
export type PresetAccentId = HandMadeAccentId | GeneratedAccentId;
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

const generated = (id: GeneratedAccentId): AccentOption => {
  const spec = GENERATED_ACCENTS.find((a) => a.id === id);
  if (!spec) throw new Error(`Нет описания акцента ${id}`);
  return { id, label: spec.label, bar: spec.bar };
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
const SKIN_KEY = 'finora-skin';
const CUSTOM_KEY = 'finora-accent-custom';
/** Готовая палитра «своего цвета» вместе с кодом, для которого она посчитана: чтобы при запуске не нужен был генератор (он грузится только в настройках). */
const CUSTOM_PALETTE_KEY = 'finora-accent-custom-palette';
/** «Живой фон и эффекты»: 'off' — выключены человеком. Хранится на устройстве, как тема. */
const FX_KEY = 'finora-fx';
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

/** Палитра, посчитанная для этого цвета и сохранённая на устройстве; null — нет, или она для другого цвета, или испорчена. */
export function readCustomPalette(hex: string): Palette | null {
  try {
    const raw = localStorage.getItem(CUSTOM_PALETTE_KEY);
    if (raw === null) return null;
    const o = JSON.parse(raw) as { hex?: unknown; p?: unknown } | null;
    return o && o.hex === hex && isPalette(o.p) ? o.p : null;
  } catch {
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
  // у клубного образа свой фон страницы, акцент на него не влияет
  const custom = root.getAttribute('data-skin') === CUSTOM_SKIN ? readActiveCustomSkin() : null;
  const forSkin = custom ? customSkinBar(custom) : skinBar(root.getAttribute('data-skin'));
  const bar = forSkin ?? (accent === CUSTOM_ACCENT ? customBar(root) : (accentById(accent) ?? VIOLET).bar);
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

/** Свой цвет вместе с готовой палитрой. */
export interface CustomAccent {
  hex: string;
  palette: Palette;
}

/** «Свой цвет» из хранилища; null — цвета нет или палитра для него ещё не сохранена (настройки досчитают её при открытии). */
function readCustom(): CustomAccent | null {
  const hex = readCustomAccent();
  const palette = hex === null ? null : readCustomPalette(hex);
  return hex !== null && palette !== null ? { hex, palette } : null;
}

/**
 * Ставит атрибут data-accent на <html> (у фиолетового — без атрибута: так работает прежняя палитра) и цвет строки состояния.
 * «Свой цвет» атрибут получает тоже, а его палитра ставится прямо на <html> переменными --ac-*: они перекрывают блоки index.css.
 * Палитра берётся из `custom` или из хранилища; если её нет (или она испорчена), применяется фиолетовый.
 */
export function applyAccent(id: AccentId, custom: CustomAccent | null = id === CUSTOM_ACCENT ? readCustom() : null): void {
  const root = document.documentElement;
  clearCustomVars(root);
  // Переменные «своего цвета» стоят прямо на <html> и перекрыли бы палитру образа, поэтому при образе их нет (цвет остаётся в хранилище)
  const palette = id === CUSTOM_ACCENT && !root.hasAttribute('data-skin') ? (custom?.palette ?? null) : null;
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

/** Выбранный образ; «Классика», если ничего не выбрано или значение испорчено. */
export function readSkinPref(): SkinId {
  try {
    const stored = localStorage.getItem(SKIN_KEY);
    if (isSkinId(stored)) return stored;
  } catch {
    /* хранилище недоступно — берём «Классику» */
  }
  return DEFAULT_SKIN;
}

/**
 * Ставит атрибут data-skin на <html> («Классика» — без атрибута; у «Сезонных» — праздничный образ по дате) и заново применяет акцент: под образом «свой цвет» не ставится,
 * а при возврате к «Классике» возвращается. Заодно перекрашивает строку состояния браузера.
 */
export function applySkin(id: SkinId): void {
  const root = document.documentElement;
  // Свой образ: всё, что нужно, лежит вместе с ним на устройстве. Его больше нет (удалили, хранилище почистили) — показываем «Классику».
  const custom = id === CUSTOM_SKIN ? readActiveCustomSkin() : null;
  if (id === CUSTOM_SKIN && custom) {
    applyCustomSkin(custom);
    return;
  }
  clearCustomSkin(root);
  const shown = id === CUSTOM_SKIN ? DEFAULT_SKIN : resolveSkin(id); // «Сезонные» превращаются в праздничный образ по сегодняшней дате
  // «Классика» и «Классика (прежняя)» палитру не задают (цвет — акцентом), поэтому data-skin у них нет; прежний вид включается своим атрибутом
  if (isBaseSkin(shown)) root.removeAttribute('data-skin');
  else root.setAttribute('data-skin', shown);
  if (shown === LEGACY_SKIN) root.setAttribute('data-look', 'legacy');
  else root.removeAttribute('data-look');
  applyTraits(skinTraits(shown));
  applyAccent(readAccentPref());
  loadSkinIcons(shown);
}

/** Ставит на страницу свой образ (src/customSkin.ts): палитру, черты, шрифт, узор, фото и набор значков выбранного готового образа. */
export function applyCustomSkin(skin: CustomSkin): void {
  const root = document.documentElement;
  root.setAttribute('data-skin', CUSTOM_SKIN);
  root.removeAttribute('data-look');
  paintCustomSkin(root, skin);
  applyTraits(parseTraits(skin.traits));
  applyAccent(readAccentPref());
  loadSkinIcons(isSkinId(skin.icons) ? skin.icons : DEFAULT_SKIN, CUSTOM_SKIN);
}

const TRAIT_KEYS = ['shape', 'material', 'nav', 'hero', 'motion', 'scene'] as const satisfies readonly (keyof SkinTraits)[];

/** Черты образа — атрибутами на <html> (data-shape, data-material, …): что значит каждое значение, описано в src/styles/look.css. */
export function applyTraits(traits: SkinTraits): void {
  const root = document.documentElement;
  for (const key of TRAIT_KEYS) root.setAttribute(`data-${key}`, traits[key]);
  window.dispatchEvent(new Event(EVENT));
}

/** Какой живой фон сейчас стоит на странице (читает src/scene). */
export const readScene = (): string => document.documentElement.getAttribute('data-scene') ?? 'none';

/** Включены ли живой фон и эффекты (по умолчанию да). */
export function readFxPref(): boolean {
  try {
    return localStorage.getItem(FX_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Ставит на <html> data-fx="off", когда эффекты выключены: CSS гасит бесконечные анимации украшений, а живой фон не запускается. */
export function applyFx(on: boolean): void {
  const root = document.documentElement;
  if (on) root.removeAttribute('data-fx');
  else root.setAttribute('data-fx', 'off');
}

export function saveFxPref(on: boolean): void {
  try {
    if (on) localStorage.removeItem(FX_KEY);
    else localStorage.setItem(FX_KEY, 'off');
  } catch {
    /* не сохранилось — выбор всё равно применится до перезагрузки */
  }
  applyFx(on);
  window.dispatchEvent(new Event(EVENT));
}

/** Свой набор значков образа: грузится лениво и ставится, если образ за это время не сменили; у образов без набора — прежние значки. */
function loadSkinIcons(id: SkinId, onPage: SkinId = id): void {
  if (!SKIN_ICON_PACKS.includes(id)) {
    setSkinIconPack(null, null);
    return;
  }
  // onPage — что должно стоять в data-skin, когда набор придёт: сам образ, а у своего образа (он берёт чужой набор) — «custom»
  void import('./skinIcons')
    .then((m) => m.loadSkinIconPack(id))
    .then((set) => {
      if (document.documentElement.getAttribute('data-skin') === onPage) setSkinIconPack(set?.pack ?? null, id, set?.extras);
    })
    .catch(() => {
      // файл набора не загрузился (нет сети, а в кеше браузера его нет): значки обычные, а не от прежнего образа
      if (document.documentElement.getAttribute('data-skin') === onPage) setSkinIconPack(null, null);
    });
}

export function saveSkinPref(id: SkinId): void {
  try {
    localStorage.setItem(SKIN_KEY, id);
  } catch {
    /* не сохранилось — образ всё равно применится до перезагрузки */
  }
  applySkin(id);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Запоминает «свой цвет» вместе с его готовой палитрой (её строит src/lib/palette.ts в настройках) и сразу выбирает его акцентом.
 * Не цвет или негодная палитра — ничего не меняет и возвращает false.
 */
export function saveCustomAccent(hex: string, palette: Palette): boolean {
  const clean = normalizeHex(hex);
  if (clean === null || !isPalette(palette)) return false;
  try {
    localStorage.setItem(CUSTOM_KEY, clean);
    localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify({ hex: clean, p: palette }));
    localStorage.setItem(ACCENT_KEY, CUSTOM_ACCENT);
  } catch {
    /* не сохранилось — цвет всё равно применится до перезагрузки */
  }
  applyAccent(CUSTOM_ACCENT, { hex: clean, palette });
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

/** Текущий образ и функция для его смены; компоненты обновляются сами. */
export function useSkinPref(): [SkinId, (id: SkinId) => void] {
  const id = useSyncExternalStore(subscribe, readSkinPref, () => DEFAULT_SKIN);
  return [id, saveSkinPref];
}

/** Включены ли живой фон и эффекты, и функция для их переключения; компоненты обновляются сами. */
export function useFxPref(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readFxPref, () => true);
  return [on, saveFxPref];
}

/** Живой фон образа на странице; компонент обновляется сам при смене образа. */
export function useScene(): string {
  return useSyncExternalStore(subscribe, readScene, () => 'none');
}

/** «Свой цвет» (#rrggbb, null — не выбирали); компонент обновляется сам. Запоминает цвет saveCustomAccent. */
export function useCustomAccent(): string | null {
  return useSyncExternalStore(subscribe, readCustomAccent, () => null);
}
