/**
 * Минимум об образах оформления, который нужен при запуске приложения: список образов и цвет строки состояния браузера у каждого.
 * Подписи, пояснения и образцы цветов для настроек лежат отдельно, в src/skins.ts: они нужны только на экране настроек и в основной файл не входят.
 */
export type SkinId =
  | 'classic'
  | 'barca'
  | 'real'
  | 'argentina'
  | 'messi'
  | 'spain'
  | 'cr7'
  | 'football'
  | 'shinobi'
  | 'akatsuki'
  | 'spider'
  | 'comic'
  | 'tajik'
  | 'pamir'
  | 'kawaii'
  | 'aesthetic'
  | 'racing'
  | 'cyber'
  | 'pixel'
  | 'coquette'
  | 'gothic'
  | 'clay'
  | 'liquid'
  | 'chrome';

export const DEFAULT_SKIN: SkinId = 'classic';

/**
 * Цвет строки состояния браузера (meta theme-color) в светлой и тёмной теме: это фон страницы образа, --ac-bg-l и --ac-bg-d его блока
 * в src/index.css (сверяет src/accents.test.ts). У «Классики» цвета здесь нет: он берётся из выбранного акцента.
 */
export const SKIN_BARS: Readonly<Record<Exclude<SkinId, 'classic'>, { light: string; dark: string }>> = {
  barca: { light: '#eef2fb', dark: '#08122e' },
  real: { light: '#f7f5ef', dark: '#071028' },
  argentina: { light: '#eef6fc', dark: '#06141f' },
  messi: { light: '#f4f1e8', dark: '#0a141c' },
  spain: { light: '#fbf1e6', dark: '#1a0a0b' },
  cr7: { light: '#f6f3ec', dark: '#0a0a0a' },
  football: { light: '#e5f3ea', dark: '#07140c' },
  shinobi: { light: '#f6ecd8', dark: '#0e1326' },
  akatsuki: { light: '#f4efef', dark: '#0a0a0c' },
  spider: { light: '#eef1fb', dark: '#0a0d1c' },
  comic: { light: '#eef2ff', dark: '#0b0e24' },
  tajik: { light: '#f1e6cd', dark: '#1d1a22' },
  pamir: { light: '#e7f0f6', dark: '#06131d' },
  kawaii: { light: '#fff0f8', dark: '#1f1030' },
  aesthetic: { light: '#f7ebe6', dark: '#1a1015' },
  racing: { light: '#f1f2f5', dark: '#101114' },
  cyber: { light: '#f3eefc', dark: '#07060f' },
  pixel: { light: '#eef4d2', dark: '#0a240a' },
  coquette: { light: '#fdf0f3', dark: '#1d1218' },
  gothic: { light: '#f1ecee', dark: '#0e0b10' },
  clay: { light: '#f3e9ff', dark: '#1c1530' },
  liquid: { light: '#e8eeff', dark: '#0c1224' },
  chrome: { light: '#e9ecf4', dark: '#0d1020' },
};

export const isSkinId = (v: string | null): v is SkinId => v === DEFAULT_SKIN || (v !== null && Object.prototype.hasOwnProperty.call(SKIN_BARS, v));

/** Цвета строки состояния для образа; null — «Классика» или неизвестное значение. */
export const skinBar = (id: string | null): { light: string; dark: string } | null => (isSkinId(id) && id !== DEFAULT_SKIN ? SKIN_BARS[id] : null);

/** Образы, у которых есть свой набор значков (src/skinIcons.ts, грузится лениво): все, кроме «Классики». */
export const SKIN_ICON_PACKS = Object.keys(SKIN_BARS) as readonly SkinId[];
