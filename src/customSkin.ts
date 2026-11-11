import { isPalette, PALETTE_KEYS, triple, type Palette } from './lib/paletteBase';
import { parseTraits, traitsLine } from './skinCore';

/**
 * Свои образы: человек собирает их сам в конструкторе (Настройки → Оформление → Образы → «Свой образ»). Здесь только то, что нужно
 * при запуске приложения: чтение сохранённых образов, их применение к странице и хранилище фото. Сам конструктор лежит отдельно
 * (src/features/skins) и грузится, только когда его открывают.
 *
 * Всё хранится на этом устройстве и в облако не уходит: список образов — в localStorage, фото — в отдельной базе браузера
 * (IndexedDB «finora-skin-photos»), потому что картинка в localStorage не помещается.
 */
export interface CustomSkin {
  /** Внутренний номер: по нему же лежат фото образа («<id>:bg» и «<id>:hero»). */
  id: string;
  name: string;
  /** Главный цвет (#rrggbb), из которого собрана палитра: чтобы открыть образ в конструкторе с тем же цветом. */
  hex: string;
  /** Второй цвет (#rrggbb) или null — тогда он подобран по главному. */
  hex2: string | null;
  /** Готовая палитра (её строит src/lib/palette.ts в конструкторе): при запуске генератор не нужен. */
  palette: Palette;
  /** Черты образа одной строкой, как в src/skinCore.ts. */
  traits: string;
  /** Шрифт заголовков (значение font-family) или пустая строка — шрифт приложения. */
  head: string;
  /** Узор фона (значение background-image) или пустая строка; patternSize — его шаг (background-size). */
  pattern: string;
  patternSize: string;
  /** Образ, чей набор значков взят (id из src/skinCore.ts), или null — обычные значки. */
  icons: string | null;
  /** Есть ли своё фото на фон страницы и на карточку «Всего». */
  bgPhoto: boolean;
  heroPhoto: boolean;
  /** Насколько фото фона закрыто цветом страницы, 0.4–0.9: больше — спокойнее фон и лучше читается текст. */
  veil: number;
}

const LIST_KEY = 'finora-skin-custom';
const ACTIVE_KEY = 'finora-skin-custom-active';
/** Сколько своих образов можно сохранить. */
export const MAX_CUSTOM_SKINS = 12;

const isString = (v: unknown): v is string => typeof v === 'string';
const HEX = /^#[0-9a-f]{6}$/;

/** Проверяет одну запись из хранилища: чужое или испорченное значение не должно сломать запуск. */
function parseOne(raw: unknown): CustomSkin | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isString(o.id) || !/^[a-z0-9]{1,24}$/.test(o.id) || !isString(o.name) || !isString(o.hex) || !HEX.test(o.hex) || !isPalette(o.palette)) return null;
  const veil = typeof o.veil === 'number' && Number.isFinite(o.veil) ? Math.min(0.9, Math.max(0.4, o.veil)) : 0.7;
  return {
    id: o.id,
    name: o.name.slice(0, 40),
    hex: o.hex,
    hex2: isString(o.hex2) && HEX.test(o.hex2) ? o.hex2 : null,
    palette: o.palette,
    traits: traitsLine(parseTraits(isString(o.traits) ? o.traits : null)),
    // значения уходят в CSS-переменные: скобки и точки с запятой в шрифте не нужны, а в узоре допустимы только градиенты
    head: isString(o.head) && /^[\w\s,'-]{0,200}$/.test(o.head) ? o.head : '',
    pattern: isString(o.pattern) && /^[\w\s,.%()/#-]{0,600}$/.test(o.pattern) && !/url|image-set|;/i.test(o.pattern) ? o.pattern : '',
    patternSize: isString(o.patternSize) && /^[\w\s.%]{0,40}$/.test(o.patternSize) ? o.patternSize : '',
    icons: isString(o.icons) && /^[a-z0-9]{1,24}$/.test(o.icons) ? o.icons : null,
    bgPhoto: o.bgPhoto === true,
    heroPhoto: o.heroPhoto === true,
    veil,
  };
}

/** Сохранённые свои образы (пустой список — если их нет или хранилище недоступно). */
export function readCustomSkins(): CustomSkin[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.flatMap((r) => parseOne(r) ?? []).slice(0, MAX_CUSTOM_SKINS) : [];
  } catch {
    return [];
  }
}

/** Записывает список; false — не поместилось или хранилище недоступно. */
export function writeCustomSkins(list: readonly CustomSkin[]): boolean {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM_SKINS)));
    return true;
  } catch {
    return false;
  }
}

export function readActiveCustomId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function writeActiveCustomId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* не сохранилось — образ всё равно применится до перезагрузки */
  }
}

/** Свой образ, выбранный сейчас; null — такого больше нет (удалили, хранилище почистили). */
export function readActiveCustomSkin(): CustomSkin | null {
  const id = readActiveCustomId();
  return id === null ? null : (readCustomSkins().find((s) => s.id === id) ?? null);
}

/* ───────────── фото ───────────── */

const DB_NAME = 'finora-skin-photos';
const STORE = 'photos';
export type PhotoSlot = 'bg' | 'hero';
export const photoKey = (skinId: string, slot: PhotoSlot): string => `${skinId}:${slot}`;

function openPhotos(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Хранилище фото не открылось'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openPhotos();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Хранилище фото недоступно'));
    });
  } finally {
    db.close();
  }
}

/** Фото образа; null — его нет или хранилище недоступно (закрытый режим браузера). */
export async function loadPhoto(key: string): Promise<Blob | null> {
  try {
    const value: unknown = await withStore('readonly', (s) => s.get(key));
    return value instanceof Blob ? value : null;
  } catch {
    return null;
  }
}

export const savePhoto = (key: string, blob: Blob): Promise<unknown> => withStore('readwrite', (s) => s.put(blob, key));

export async function deletePhoto(key: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(key));
  } catch {
    /* удалять нечего */
  }
}

/* ───────────── применение к странице ───────────── */

/** Адреса фото, выданные браузером для нынешнего образа: их нужно освободить, когда образ сменился. */
let photoUrls: string[] = [];
/** Номер применения: фото читаются не сразу, и если за это время выбрали другой образ, старое фото ставить нельзя. */
let generation = 0;

const VARS = ['--skin-head', '--skin-pattern', '--skin-pattern-size', '--skin-line', '--skin-veil', '--skin-photo', '--skin-art', '--skin-art-content'];

/** Убирает со страницы всё, что поставил свой образ (переменные палитры, шрифт, узор, фото). */
export function clearCustomSkin(root: HTMLElement): void {
  generation += 1;
  for (const key of PALETTE_KEYS) root.style.removeProperty(`--cs-${key}`);
  for (const name of VARS) root.style.removeProperty(name);
  root.removeAttribute('data-photo');
  root.removeAttribute('data-hero-photo');
  for (const url of photoUrls) URL.revokeObjectURL(url);
  photoUrls = [];
}

/**
 * Ставит свой образ: палитра уходит в переменные --cs-* (блок `:root[data-skin='custom']` в look.css берёт цвета из них), шрифт и узор —
 * в те же переменные, что у готовых образов. Фото читаются из хранилища чуть позже и появляются, когда прочитаны.
 */
export function paintCustomSkin(root: HTMLElement, skin: CustomSkin): void {
  clearCustomSkin(root);
  const mine = generation;
  for (const key of PALETTE_KEYS) root.style.setProperty(`--cs-${key}`, triple(skin.palette[key]));
  root.style.setProperty('--skin-head', skin.head !== '' ? skin.head : "'Onest', ui-sans-serif, system-ui, sans-serif");
  root.style.setProperty('--skin-pattern', skin.pattern !== '' ? skin.pattern : 'none');
  if (skin.patternSize !== '') root.style.setProperty('--skin-pattern-size', skin.patternSize);
  root.style.setProperty('--skin-line', triple(skin.palette['accent-l']));
  root.style.setProperty('--skin-veil', String(skin.veil));
  const put = (slot: PhotoSlot, apply: (url: string) => void) => {
    void loadPhoto(photoKey(skin.id, slot)).then((blob) => {
      if (blob === null || mine !== generation) return;
      const url = URL.createObjectURL(blob);
      photoUrls.push(url);
      apply(url);
    });
  };
  if (skin.bgPhoto) {
    put('bg', (url) => {
      root.style.setProperty('--skin-photo', `url("${url}")`);
      root.setAttribute('data-photo', '');
    });
  }
  if (skin.heroPhoto) {
    put('hero', (url) => {
      root.style.setProperty('--skin-art', `url("${url}")`);
      root.style.setProperty('--skin-art-content', "''");
      root.setAttribute('data-hero-photo', '');
    });
  }
}

/** Цвет строки состояния браузера у своего образа: фон страницы из его палитры. */
export const customSkinBar = (skin: CustomSkin): { light: string; dark: string } => {
  const hex = (rgb: readonly [number, number, number]): string => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return { light: hex(skin.palette['bg-l']), dark: hex(skin.palette['bg-d']) };
};
