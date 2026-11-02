/**
 * Генератор палитры акцента: из одного оттенка (и «яркости») получает все переменные темы, которые в src/index.css записаны
 * для каждого акцента вручную (--ac-bg-l, --ac-brand-d, …). Нужен для «Своего цвета» в настройках и для готовых акцентов,
 * блоки которых в index.css выпущены этим же генератором (`npm run gen:accents`, проверка — src/accents.test.ts).
 *
 * Как устроено: цвета считаются в OKLCH (равномерном по восприятию пространстве) по таблице «светлота / насыщенность /
 * сдвиг оттенка» для каждой переменной — таблица снята с ручных палитр приложения, поэтому новые акценты выглядят родными.
 * Затем яркость нужных цветов подгоняется шагами, пока не выполнятся ТЕ ЖЕ контрасты WCAG, что проверяет src/accents.test.ts:
 * текст ≥ 4.5:1, рамки полей ≥ 3:1, белое на кнопке ≥ 4.5:1 и так далее. Любой оттенок, даже жёлтый или серый, даёт читаемую тему.
 */

import { normalizeHex, PALETTE_KEYS, triple, type Palette, type PaletteKey, type Rgb } from './paletteBase.ts';

export { isPalette, normalizeHex, PALETTE_KEYS, triple } from './paletteBase.ts';
export type { Palette, PaletteKey, Rgb } from './paletteBase.ts';

/** Описание акцента для генератора: оттенок в градусах OKLCH (0–360) и яркость красок от 0 (серый) до 1 (самые сочные). */
export interface PaletteSpec {
  hue: number;
  vivid: number;
}

/* ------------------------------ цвет: sRGB ⇄ OKLCH ------------------------------ */

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number): number => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const luminance = ([r, g, b]: Rgb): number => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** Контраст WCAG двух цветов (от 1 до 21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Цвет fg с прозрачностью alpha поверх bg — как это рисует браузер (bg-brand/10 на карточке). */
export function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round((fg[i] ?? 0) * alpha + (bg[i] ?? 0) * (1 - alpha))) as unknown as Rgb;
}

/** sRGB (0–255) → [L 0–1, C, H в градусах]. */
export function rgbToOklch([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

/** Линейные каналы sRGB для OKLCH (могут выйти за 0..1 — цвета вне охвата экрана). */
function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((c) => c >= -0.0005 && c <= 1.0005);
const clamp01 = (c: number): number => Math.min(1, Math.max(0, c));

/** OKLCH → sRGB (целые 0–255). Цвет вне охвата экрана приводится уменьшением насыщенности при той же светлоте и оттенке. */
export function oklchToRgb(L: number, C: number, H: number): Rgb {
  const l = Math.min(1, Math.max(0, L));
  let chroma = Math.max(0, C);
  if (!inGamut(oklchToLinear(l, chroma, H))) {
    let [lo, hi] = [0, chroma];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(l, mid, H))) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  const lin = oklchToLinear(l, chroma, H);
  return lin.map((c) => Math.round(fromLinear(clamp01(c)))) as unknown as Rgb;
}

/* ------------------------------ таблица палитры ------------------------------ */

/** neutral — фон, поверхности, текст (чуть подкрашены оттенком); colorful — краски, их насыщенность растёт с «яркостью» акцента. */
interface Token {
  L: number;
  C: number;
  /** Сдвиг оттенка от основного, градусов. */
  dh: number;
  kind: 'neutral' | 'colorful';
}

const t = (L: number, C: number, dh: number, kind: Token['kind']): Token => ({ L, C, dh, kind });

/** Светлоты, насыщенности и сдвиги оттенка сняты с ручных палитр (фиолетовая, синяя, бирюзовая, …) и усреднены. */
const TOKENS: Readonly<Record<PaletteKey, Token>> = {
  'bg-l': t(0.951, 0.018, 0, 'neutral'),
  'surface-2-l': t(0.957, 0.016, 0, 'neutral'),
  'text-l': t(0.23, 0.054, -3, 'neutral'),
  'muted-l': t(0.484, 0.062, -3, 'neutral'),
  'border-l': t(0.892, 0.03, 0, 'neutral'),
  'border-strong-l': t(0.607, 0.057, -3, 'neutral'),
  'brand-l': t(0.511, 0.23, -2, 'colorful'),
  'brand-hover-l': t(0.457, 0.215, -2, 'colorful'),
  'accent-l': t(0.62, 0.216, 16, 'colorful'),
  'hero-l': t(0.563, 0.225, 8, 'colorful'),
  'orb-1-l': t(0.722, 0.145, -2, 'colorful'),
  'orb-2-l': t(0.777, 0.148, 30, 'colorful'),
  'orb-3-l': t(0.841, 0.101, -50, 'colorful'),
  'glass-shadow-l': t(0.408, 0.145, -3, 'colorful'),
  'bg-d': t(0.151, 0.03, -3, 'neutral'),
  'surface-d': t(0.238, 0.059, -2, 'neutral'),
  'surface-2-d': t(0.303, 0.072, -2, 'neutral'),
  'text-d': t(0.958, 0.02, 1, 'neutral'),
  'muted-d': t(0.739, 0.052, -1, 'neutral'),
  'border-d': t(0.352, 0.08, -3, 'neutral'),
  'border-strong-d': t(0.611, 0.072, -2, 'neutral'),
  'brand-d': t(0.785, 0.104, -4, 'colorful'),
  'brand-hover-d': t(0.87, 0.062, -5, 'colorful'),
  'on-brand-d': t(0.257, 0.086, 2, 'neutral'),
  'accent-d': t(0.785, 0.123, 20, 'colorful'),
  'hero-from-d': t(0.458, 0.201, -5, 'colorful'),
  'hero-d': t(0.529, 0.203, 17, 'colorful'),
  'orb-1-d': t(0.461, 0.208, -6, 'colorful'),
  'orb-2-d': t(0.515, 0.202, 20, 'colorful'),
  'orb-3-d': t(0.522, 0.117, -35, 'colorful'),
  'logo-from': t(0.611, 0.213, -2, 'colorful'),
  'logo-to': t(0.621, 0.221, 19, 'colorful'),
  'logo-glyph': t(0.915, 0.042, 15, 'neutral'),
};

/* Цвета денег и состояний задаёт тема, а не акцент (index.css): палитра обязана читаться рядом с ними. */
const WHITE: Rgb = [255, 255, 255];
const LIGHT_SURFACE: Rgb = WHITE;
const MONEY_LIGHT: readonly Rgb[] = [
  [185, 28, 28], // danger
  [4, 110, 80], // income
  [190, 18, 60], // expense
  [146, 64, 14], // warning
];
const MONEY_DARK: readonly Rgb[] = [
  [248, 113, 113],
  [74, 222, 128],
  [251, 113, 133],
  [251, 191, 36],
];

const STEP = 0.004;
const MAX_STEPS = 240;
/** Запас над порогом WCAG: округление цвета до целых каналов не должно сносить контраст ниже требуемого. */
const MARGIN = 0.05;

const norm = (hue: number): number => ((hue % 360) + 360) % 360;
const clampVivid = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

/** Палитра по оттенку и яркости. Одинаковый вход всегда даёт одинаковый результат (по этому index.css сверяется с генератором). */
export function buildPalette(spec: PaletteSpec): Palette {
  const hue = norm(Number.isFinite(spec.hue) ? spec.hue : 0);
  const vivid = clampVivid(spec.vivid);
  const shade: Record<PaletteKey, { L: number; C: number; H: number }> = {} as never;
  const rgb: Record<PaletteKey, Rgb> = {} as never;

  const paint = (key: PaletteKey): void => {
    const s = shade[key];
    rgb[key] = oklchToRgb(s.L, s.C, s.H);
  };
  for (const key of PALETTE_KEYS) {
    const tok = TOKENS[key];
    const k = tok.kind === 'neutral' ? 0.3 + 0.7 * vivid : vivid;
    shade[key] = { L: tok.L, C: tok.C * k, H: norm(hue + tok.dh) };
    paint(key);
  }

  /** Двигает светлоту цвета шагами в сторону dir (+1 светлее, −1 темнее), пока условие не выполнится. */
  const fit = (key: PaletteKey, dir: 1 | -1, ok: () => boolean): void => {
    for (let i = 0; i < MAX_STEPS && !ok(); i++) {
      shade[key].L = Math.min(1, Math.max(0, shade[key].L + dir * STEP));
      paint(key);
    }
  };
  const cr = (a: Rgb, b: Rgb): number => contrastRatio(a, b);
  const need = (value: number, min: number): boolean => value >= min + MARGIN;

  /* ---------- светлая тема ---------- */
  const lightSurfaces = (): Rgb[] => [rgb['bg-l'], LIGHT_SURFACE, rgb['surface-2-l']];
  // фон не должен темнеть до такой степени, что цвета денег на нём не читаются
  for (const key of ['bg-l', 'surface-2-l'] as const) {
    fit(key, 1, () => MONEY_LIGHT.every((m) => need(cr(m, rgb[key]), 4.5)));
  }
  for (const key of ['text-l', 'muted-l'] as const) fit(key, -1, () => lightSurfaces().every((s) => need(cr(rgb[key], s), 4.5)));
  fit('border-strong-l', -1, () => lightSurfaces().every((s) => need(cr(rgb['border-strong-l'], s), 3)));
  // brand: читается на всех поверхностях и на подсвеченной плашке (выбранный чип), белый текст на нём читается
  fit('brand-l', -1, () =>
    lightSurfaces().every((s) => need(cr(rgb['brand-l'], s), 4.5)) &&
    [0.1, 0.15].every((a) => need(cr(rgb['brand-l'], over(rgb['brand-l'], a, LIGHT_SURFACE)), 4.5)) &&
    need(cr(WHITE, rgb['brand-l']), 4.5),
  );
  fit('brand-hover-l', -1, () => need(cr(WHITE, rgb['brand-hover-l']), 4.5));
  fit('accent-l', -1, () => need(cr(WHITE, rgb['accent-l']), 3));
  fit('hero-l', -1, () => need(cr(WHITE, rgb['hero-l']), 4.5));

  /* ---------- тёмная тема ---------- */
  const darkSurfaces = (): Rgb[] => [rgb['bg-d'], rgb['surface-d'], rgb['surface-2-d']];
  for (const key of ['text-d', 'muted-d'] as const) fit(key, 1, () => darkSurfaces().every((s) => need(cr(rgb[key], s), 4.5)));
  fit('border-strong-d', 1, () => darkSurfaces().every((s) => need(cr(rgb['border-strong-d'], s), 3)));
  fit('brand-d', 1, () =>
    darkSurfaces().every((s) => need(cr(rgb['brand-d'], s), 4.5)) &&
    [0.1, 0.15].every((a) => need(cr(rgb['brand-d'], over(rgb['brand-d'], a, rgb['surface-d'])), 4.5)),
  );
  fit('brand-hover-d', 1, () => darkSurfaces().every((s) => need(cr(rgb['brand-hover-d'], s), 4.5)));
  // текст на кнопке: тёмный на светлом brand, при наведении и на конце градиента
  fit('on-brand-d', -1, () => need(cr(rgb['on-brand-d'], rgb['brand-d']), 4.5) && need(cr(rgb['on-brand-d'], rgb['brand-hover-d']), 4.5));
  fit('accent-d', 1, () => need(cr(rgb['on-brand-d'], rgb['accent-d']), 3));
  fit('hero-from-d', -1, () => need(cr(WHITE, rgb['hero-from-d']), 4.5));
  fit('hero-d', -1, () => need(cr(WHITE, rgb['hero-d']), 4.5));

  /* ---------- знак «$» ---------- */
  const logoOk = (tile: PaletteKey): boolean => need(cr(WHITE, rgb[tile]), 3) && need(cr(rgb['logo-glyph'], rgb[tile]), 3);
  fit('logo-from', -1, () => logoOk('logo-from'));
  fit('logo-to', -1, () => logoOk('logo-to'));

  return rgb;
}

/* ------------------------------ свой цвет ------------------------------ */

export function hexToRgb(hex: string): Rgb | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return [Number.parseInt(n.slice(1, 3), 16), Number.parseInt(n.slice(3, 5), 16), Number.parseInt(n.slice(5, 7), 16)];
}

export const rgbToHex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** Насыщенность, начиная с которой цвет считается «полноцветным» (чистые синий, красный, зелёный имеют 0.2–0.3). */
const FULL_CHROMA = 0.19;

/** Оттенок и яркость, которые задаёт выбранный человеком цвет. Серые цвета дают спокойную (почти серую) палитру. */
export function specFromHex(hex: string): PaletteSpec | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [, chroma, hue] = rgbToOklch(rgb);
  return { hue, vivid: Math.min(1, chroma / FULL_CHROMA) };
}

/** Палитра для выбранного цвета; null — если это не цвет. */
export function paletteFromHex(hex: string): Palette | null {
  const spec = specFromHex(hex);
  return spec ? buildPalette(spec) : null;
}

/** Цвет в виде «#rrggbb» для строки состояния браузера и подписей. */
export const paletteHex = (palette: Palette, key: PaletteKey): string => rgbToHex(palette[key]);

/* ------------------------------ проверка ------------------------------ */

/**
 * Список нарушений контрастов (пустой — палитра годится). Те же требования, что в src/accents.test.ts: тест гоняет это по всем
 * оттенкам, а значит, любой выбранный человеком цвет даёт читаемую тему.
 */
export function paletteProblems(p: Palette): string[] {
  const out: string[] = [];
  const check = (what: string, a: Rgb, b: Rgb, min: number): void => {
    const ratio = contrastRatio(a, b);
    if (ratio < min) out.push(`${what}: ${ratio.toFixed(2)} < ${min}`);
  };
  const themes = [
    { name: 'светлая', s: [p['bg-l'], LIGHT_SURFACE, p['surface-2-l']], text: p['text-l'], muted: p['muted-l'], brand: p['brand-l'], strong: p['border-strong-l'], money: MONEY_LIGHT },
    { name: 'тёмная', s: [p['bg-d'], p['surface-d'], p['surface-2-d']], text: p['text-d'], muted: p['muted-d'], brand: p['brand-d'], strong: p['border-strong-d'], money: MONEY_DARK },
  ];
  for (const th of themes) {
    th.s.forEach((s, i) => {
      check(`${th.name}: текст на поверхности ${i}`, th.text, s, 4.5);
      check(`${th.name}: приглушённый на ${i}`, th.muted, s, 4.5);
      check(`${th.name}: brand на ${i}`, th.brand, s, 4.5);
      check(`${th.name}: рамка на ${i}`, th.strong, s, 3);
      th.money.forEach((m, j) => check(`${th.name}: цвет денег ${j} на ${i}`, m, s, 4.5));
    });
  }
  const surfaceD = p['surface-d'];
  for (const a of [0.1, 0.15]) {
    check(`светлая: brand на плашке ${a}`, p['brand-l'], over(p['brand-l'], a, LIGHT_SURFACE), 4.5);
    check(`тёмная: brand на плашке ${a}`, p['brand-d'], over(p['brand-d'], a, surfaceD), 4.5);
  }
  check('светлая: белое на brand', WHITE, p['brand-l'], 4.5);
  check('светлая: белое на brand-hover', WHITE, p['brand-hover-l'], 4.5);
  check('светлая: белое на accent', WHITE, p['accent-l'], 3);
  check('светлая: белое на hero', WHITE, p['hero-l'], 4.5);
  check('светлая: белое на hero-from (brand)', WHITE, p['brand-l'], 4.5);
  check('светлая: ручка на дорожке', LIGHT_SURFACE, p['border-strong-l'], 3);
  check('тёмная: on-brand на brand', p['on-brand-d'], p['brand-d'], 4.5);
  check('тёмная: on-brand на brand-hover', p['on-brand-d'], p['brand-hover-d'], 4.5);
  check('тёмная: on-brand на accent', p['on-brand-d'], p['accent-d'], 3);
  check('тёмная: белое на hero-from', WHITE, p['hero-from-d'], 4.5);
  check('тёмная: белое на hero', WHITE, p['hero-d'], 4.5);
  check('тёмная: ручка на дорожке', p['surface-d'], p['border-strong-d'], 3);
  for (const tile of ['logo-from', 'logo-to'] as const) {
    check(`знак: белый на ${tile}`, WHITE, p[tile], 3);
    check(`знак: низ значка на ${tile}`, p['logo-glyph'], p[tile], 3);
  }
  return out;
}

/** Блок index.css для акцента: как записаны ручные палитры (имя — в комментарии над блоком). */
export function paletteCss(id: string, label: string, palette: Palette): string {
  const lines = PALETTE_KEYS.map((k) => `  --ac-${k}: ${triple(palette[k])};`);
  return `/* ${label} */\n[data-accent='${id}'] {\n${lines.join('\n')}\n}\n`;
}

/** Отметки, между которыми в index.css лежат блоки готовых акцентов, выпущенные генератором. */
export const GENERATED_BEGIN = '/* >>> generated accents: не править руками, `npm run gen:accents` */';
export const GENERATED_END = '/* <<< generated accents */';

/** Весь участок index.css с блоками готовых акцентов (вместе с отметками); по нему файл сверяется с генератором. */
export function generatedAccentsCss(list: readonly { id: string; label: string; hue: number; vivid: number }[]): string {
  const blocks = list.map((a) => paletteCss(a.id, a.label, buildPalette(a)));
  return `${GENERATED_BEGIN}\n${blocks.join('\n')}${GENERATED_END}`;
}
