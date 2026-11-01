/**
 * Лёгкая часть палитры акцента: список переменных, типы, разбор кода цвета, запись «R G B» и проверка готовой палитры. Нужна основному
 * файлу приложения (src/theme.ts ставит палитру «своего цвета» при запуске), поэтому здесь нет генератора: он лежит в src/lib/palette.ts
 * и грузится только в настройках (и в тестах).
 */

export type Rgb = readonly [number, number, number];

/** Все переменные палитры без префикса «--ac-», в порядке, как они записаны в index.css. */
export const PALETTE_KEYS = [
  'bg-l',
  'surface-2-l',
  'text-l',
  'muted-l',
  'border-l',
  'border-strong-l',
  'brand-l',
  'brand-hover-l',
  'accent-l',
  'hero-l',
  'orb-1-l',
  'orb-2-l',
  'orb-3-l',
  'glass-shadow-l',
  'bg-d',
  'surface-d',
  'surface-2-d',
  'text-d',
  'muted-d',
  'border-d',
  'border-strong-d',
  'brand-d',
  'brand-hover-d',
  'on-brand-d',
  'accent-d',
  'hero-from-d',
  'hero-d',
  'orb-1-d',
  'orb-2-d',
  'orb-3-d',
  'logo-from',
  'logo-to',
  'logo-glyph',
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Readonly<Record<PaletteKey, Rgb>>;

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** «#4f46e5», «4f46e5» или «#f00» → '#rrggbb' в нижнем регистре; всё остальное — null. */
export function normalizeHex(raw: string): string | null {
  const m = HEX.exec(raw.trim());
  if (!m) return null;
  const digits = (m[1] ?? '').toLowerCase();
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits}`;
}

/** «R G B» — так значения записаны в index.css. */
export const triple = ([r, g, b]: Rgb): string => `${r} ${g} ${b}`;

/** Это палитра: все переменные на месте и каждая — три целых канала 0–255. Нужна там, где палитру читают из хранилища: оно не доверенный источник. */
export function isPalette(value: unknown): value is Palette {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return PALETTE_KEYS.every((k) => {
    const c = o[k];
    return Array.isArray(c) && c.length === 3 && c.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255);
  });
}
