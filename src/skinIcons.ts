import { NATIVE_ICONS, nativeShapes, nativeSvg } from './skinNativeIcons';
import type { SkinId } from './skinCore';
import { refreshSkinIcons, type SkinExtras, type SkinIconPack } from './components/skinIconStore';
import { loadPackGroup, SKIN_ICONIFY } from './skinIconPacks/registry';

/**
 * Наборы значков образов (свои рисунки, замены для встроенных значков из iconData.ts). Грузится лениво, только когда выбран образ с
 * набором (SKIN_ICON_PACKS в src/skinCore.ts), поэтому в основной файл не входит.
 *
 * Два вида наборов:
 *  — «Пиксель»: каждый значок — картинка 12×12 из пикселей по 2 px. «#» — сплошной пиксель, «+» — полупрозрачный (как светлая часть у
 *    двухтонных значков), «.» — пусто. Из картинки получается обычная двухтонная разметка, так что Icon рисует её как остальные;
 *  — линейные: один общий рисунок на 24 значка (ICON_GEOMETRY, сетка 24×24) и пять стилей линии (ICON_STYLES): толщина, концы, углы
 *    и мягкая заливка. Какому образу какой стиль — SKIN_ICON_STYLE. Так у каждого образа свой вид значков, а рисунки не копятся по 18 раз.
 *
 * Поверх линейного набора часть значков заменена «родными» из материалов образа (src/skinNativeIcons.ts: лист Конохи, облако, стадион…): их
 * рисуют линией того же стиля, что и соседние.
 */
const PIXEL: Readonly<Record<string, readonly string[]>> = {
  home: ['............', '.....##.....', '....####....', '...######...', '..########..', '.##########.', '############', '.####++####.', '.####++####.', '.####++####.', '.##########.', '............'],
  list: ['..########..', '..#++++++#..', '..#.####.#..', '..#++++++#..', '..#.####.#..', '..#++++++#..', '..#.####.#..', '..#++++++#..', '..#.##...#..', '..########..', '............', '............'],
  wallet: ['............', '............', '.##########.', '############', '##++++++++##', '##++++++++##', '##++++++####', '##++++++####', '##++++++####', '############', '.##########.', '............'],
  more: ['............', '............', '............', '............', '............', '.##..##..##.', '.##..##..##.', '............', '............', '............', '............', '............'],
  chart: ['............', '............', '........##..', '........##..', '....##..##..', '....##..##..', '##..##..##..', '##..##..##..', '############', '............', '............', '............'],
  pie: ['............', '...###+++...', '..####+++++.', '.#####++++++', '.#####++++++', '.#####++++++', '.###########', '.###########', '..#########.', '...#######..', '............', '............'],
  cart: ['............', '#...........', '###.........', '.#.########.', '.#.#++++++#.', '.#.#++++++#.', '.#..######..', '.##########.', '............', '..##....##..', '..##....##..', '............'],
  food: ['............', '...######...', '..########..', '.##########.', '.##########.', '............', '############', '++++++++++++', '............', '.##########.', '..########..', '............'],
  cup: ['............', '...+..+.....', '...+..+.....', '............', '.########...', '.########.##', '.########.#.', '.########.##', '..######....', '..######....', '...####.....', '............'],
  bus: ['............', '.##########.', '.#++++++++#.', '.#++++++++#.', '.##########.', '.##########.', '.#.#.##.#.#.', '.##########.', '.###....###.', '..##....##..', '............', '............'],
  car: ['............', '............', '...######...', '..#++##++#..', '.##########.', '############', '############', '############', '.##......##.', '.##......##.', '............', '............'],
  heart: ['............', '.###....###.', '#####..#####', '############', '############', '############', '.##########.', '..########..', '...######...', '....####....', '.....##.....', '............'],
  star: ['.....##.....', '.....##.....', '....####....', '############', '.##########.', '..########..', '..########..', '.####..####.', '.###....###.', '.#........#.', '............', '............'],
  gift: ['............', '...##..##...', '..#..##..#..', '............', '############', '############', '.####++####.', '.####++####.', '.####++####.', '.####++####.', '.##########.', '............'],
  ball: ['............', '...######...', '..#+####+#..', '.##+####+##.', '.###+##+###.', '.####++####.', '.###+##+###.', '.##+####+##.', '..#+####+#..', '...######...', '............', '............'],
  game: ['............', '............', '.##########.', '############', '##+######+##', '#+++####+#+#', '##+######+##', '############', '.###....###.', '............', '............', '............'],
  phone: ['............', '...######...', '...#++++#...', '...#++++#...', '...#++++#...', '...#++++#...', '...#++++#...', '...#++++#...', '...#++++#...', '...######...', '...#.##.#...', '...######...'],
  book: ['............', '..#########.', '.##########.', '.#.+++++++#.', '.#.+###+++#.', '.#.+++++++#.', '.#.+###+++#.', '.#.+++++++#.', '.##########.', '.##########.', '............', '............'],
  bag: ['............', '....####....', '...#....#...', '...#....#...', '.##########.', '.#++++++++#.', '.#++++++++#.', '.#++++++++#.', '.#++++++++#.', '.##########.', '............', '............'],
  pills: ['............', '....####....', '....####....', '....####....', '.##########.', '.##########.', '.##########.', '.##########.', '....####....', '....####....', '....####....', '............'],
};

const PX = 2;

/** Картинка из пикселей → двухтонная разметка значка: сплошные пиксели одним путём, полупрозрачные другим (opacity .5). */
export function pixelMarkup(rows: readonly string[]): string {
  const strips: Record<'#' | '+', string> = { '#': '', '+': '' };
  rows.forEach((row, y) => {
    for (const mark of ['#', '+'] as const) {
      let x = 0;
      while (x < row.length) {
        if (row[x] !== mark) {
          x += 1;
          continue;
        }
        let end = x;
        while (row[end] === mark) end += 1;
        strips[mark] += `M${x * PX} ${y * PX}h${(end - x) * PX}v${PX}h-${(end - x) * PX}z`;
        x = end;
      }
    }
  });
  const half = strips['+'] === '' ? '' : `<path d="${strips['+']}" opacity=".5"/>`;
  return `<g fill="currentColor">${half}<path d="${strips['#']}"/></g>`;
}

const pack = (bitmaps: Readonly<Record<string, readonly string[]>>): SkinIconPack =>
  Object.fromEntries(Object.entries(bitmaps).map(([name, rows]) => [name, pixelMarkup(rows)]));

/** Сами картинки (для тестов и для просмотра). */
export const PIXEL_BITMAPS = PIXEL;

/** Общие рисунки линейных наборов: имена встроенных двухтонных значков, ломаные и дуги в сетке 24×24. «M6 12h.01» — точка (конец линии). */
export const ICON_GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v9.5h13V10', 'M10 19.5v-5h4v5'],
  list: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6M9 12h6'],
  wallet: ['M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M4 7V6a2 2 0 0 1 2-2h11', 'M16 13.5h.01'],
  more: ['M6 12h.01M12 12h.01M18 12h.01'],
  chart: ['M6 20v-7M12 20V5M18 20v-10'],
  pie: ['M12 3a9 9 0 1 0 9 9h-9z', 'M14.5 2.6A9 9 0 0 1 21.4 9.5h-6.9z'],
  cart: ['M3 4h2.5l2 11h10l2-8H7', 'M9.5 19.5h.01M16.5 19.5h.01'],
  food: ['M4 11a8 6 0 0 1 16 0z', 'M3 14h18', 'M4 17h16v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'],
  cup: ['M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16', 'M9 3v3M12.5 3v3'],
  bus: ['M5 5h14a1.5 1.5 0 0 1 1.5 1.5V17h-17V6.5A1.5 1.5 0 0 1 5 5z', 'M3.5 11h17', 'M7 19.5h.01M17 19.5h.01', 'M5 17v2M19 17v2'],
  car: ['M4 15v-3l2.2-5h11.6L20 12v3', 'M3 15h18v3H3z', 'M6.5 12h11', 'M7 18.5h.01M17 18.5h.01'],
  heart: ['M12 20S4 14.8 4 9.2A4.2 4.2 0 0 1 12 7.5 4.2 4.2 0 0 1 20 9.2C20 14.8 12 20 12 20z'],
  star: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z'],
  gift: ['M4 10h16v10H4z', 'M3 7h18v3H3z', 'M12 7v13', 'M12 7C10 3.5 6.5 4.5 7.5 6.5 8 7.5 10 7 12 7zM12 7c2-3.5 5.5-2.5 4.5-.5C16 7.5 14 7 12 7z'],
  ball: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8.2l3.2 2.3-1.2 3.8h-4l-1.2-3.8z', 'M12 8.2V3.3M15.2 10.5l4.6-1.5M14 14.3l2.8 3.9M10 14.3l-2.8 3.9M8.8 10.5 4.2 9'],
  game: ['M7 8h10a5 5 0 0 1 4.9 6l-.6 2.8a2.2 2.2 0 0 1-3.8 1L15.5 15h-7l-2 2.8a2.2 2.2 0 0 1-3.8-1L2.1 14A5 5 0 0 1 7 8z', 'M7.5 10.5v3M6 12h3', 'M16 11.5h.01M18 13h.01'],
  phone: ['M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z', 'M10.5 18h3'],
  book: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11'],
  bag: ['M5 8h14l1 12H4z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
  pills: ['M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z'],
  money: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v10', 'M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.8 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5'],
  card: ['M3 6h18v12H3z', 'M3 10h18', 'M6 15h4'],
  plane: ['M21 3 3 11l7 3 3 7z', 'M10 14 21 3'],
  bulb: ['M9 17h6M10 20h4', 'M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z'],
};

export type IconStyleId = 'fine' | 'tech' | 'sharp' | 'sport' | 'bubble';

/** Пять стилей линии: толщина, концы и углы линий, мягкая заливка замкнутых фигур (доля непрозрачности; 0 — без заливки). */
export const ICON_STYLES: Readonly<Record<IconStyleId, { width: number; cap: 'round' | 'square'; join: 'round' | 'miter'; fill: number }>> = {
  fine: { width: 1.4, cap: 'round', join: 'round', fill: 0 },
  tech: { width: 1.7, cap: 'square', join: 'miter', fill: 0 },
  sharp: { width: 2.6, cap: 'square', join: 'miter', fill: 0 },
  sport: { width: 2.2, cap: 'round', join: 'round', fill: 0.2 },
  bubble: { width: 2.7, cap: 'round', join: 'round', fill: 0.3 },
};

/** Какой стиль линии у какого образа; у «Пикселя» свой набор из пикселей, у «Классики» набора нет. */
export const SKIN_ICON_STYLE: Readonly<Partial<Record<SkinId, IconStyleId | 'pixel'>>> = {
  barca: 'sport',
  real: 'fine',
  argentina: 'sport',
  messi: 'sport',
  spain: 'sport',
  cr7: 'sport',
  football: 'sport',
  shinobi: 'sharp',
  akatsuki: 'sharp',
  spider: 'tech',
  comic: 'sharp',
  tajik: 'bubble',
  pamir: 'fine',
  kawaii: 'bubble',
  aesthetic: 'fine',
  racing: 'sharp',
  cyber: 'tech',
  pixel: 'pixel',
  coquette: 'bubble',
  gothic: 'fine',
  clay: 'bubble',
  liquid: 'fine',
  chrome: 'tech',
  retro: 'sport',
  bauhaus: 'sharp',
  sticker: 'bubble',
  notebook: 'fine',
  dungeon: 'sharp',
};

/** Линейный набор в выбранном стиле: все значки из ICON_GEOMETRY, штрих currentColor, у стиля с заливкой — мягкий оттенок внутри фигур. */
export function lineMarkup(paths: readonly string[], style: IconStyleId): string {
  const st = ICON_STYLES[style];
  const fill = st.fill > 0 ? ` fill="currentColor" fill-opacity="${st.fill}"` : ' fill="none"';
  const dots = (d: string) => /h\.01/.test(d);
  // точки («M6 12h.01») толще остальной линии (но не шире 4,4, иначе три точки «Ещё» слипнутся в полоску): их ширина — отдельным путём
  const body = paths.map((d) => (dots(d) ? `<path d="${d}" fill="none" stroke-width="${Math.round(Math.min(st.width * 2.2, 4.4) * 10) / 10}"/>` : `<path d="${d}"/>`)).join('');
  return `<g stroke="currentColor" stroke-width="${st.width}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"${fill}>${body}</g>`;
}

const linePack = (style: IconStyleId): SkinIconPack => Object.fromEntries(Object.entries(ICON_GEOMETRY).map(([name, paths]) => [name, lineMarkup(paths, style)]));

/** Родной значок из материалов образа (src/skinNativeIcons.ts) в линии стиля: те же толщина, концы и заливка, что у соседних значков набора. */
export function nativeMarkup(shapes: string, style: IconStyleId): string {
  const st = ICON_STYLES[style];
  const fill = st.fill > 0 ? ` fill="currentColor" fill-opacity="${st.fill}"` : ' fill="none"';
  // В файле штрих 2. Фигуры со своей толщиной (тонкие нити паутины, точки) пересчитываем под стиль: точки — как у общих значков, остальные — пропорционально.
  const dot = Math.round(Math.min(st.width * 2.2, 4.4) * 10) / 10;
  const body = shapes.replace(/<[^<>]*?stroke-width="([\d.]+)"[^<>]*>/g, (tag, w: string) => {
    const next = /h\.01/.test(tag) ? dot : Math.round(((Number(w) * st.width) / 2) * 10) / 10;
    return tag.replace(/stroke-width="[\d.]+"/, `stroke-width="${next}"`);
  });
  return `<g stroke="currentColor" stroke-width="${st.width}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"${fill}>${body}</g>`;
}

/** Родные значки образа в линии его стиля: имя значка приложения → разметка. Пусто, если у образа их нет. */
function nativePack(id: SkinId, style: IconStyleId): SkinIconPack {
  const map = NATIVE_ICONS[id] ?? {};
  const out: Record<string, string> = {};
  for (const [name, key] of Object.entries(map)) {
    const svg = nativeSvg(key);
    if (svg !== undefined) out[name] = nativeMarkup(nativeShapes(svg), style);
  }
  return out;
}

/** Набор значков образа; undefined — у образа своего набора нет. */
export function skinIconPack(id: SkinId): SkinIconPack | undefined {
  const style = SKIN_ICON_STYLE[id];
  if (style === undefined) return undefined;
  return style === 'pixel' ? pack(PIXEL) : { ...linePack(style), ...nativePack(id, style) };
}

/** Дополнительные значки набора: файлы разделов грузятся по одному, по первому запросу; не загрузился (нет сети) — остаются обычные значки. */
export function createExtras(load: (section: string) => Promise<SkinIconPack>): SkinExtras {
  const sections = new Map<string, SkinIconPack | null>(); // null — раздел грузится
  return {
    get: (name, section) => {
      const got = sections.get(section);
      return got == null ? null : got[name];
    },
    ensure: (section) => {
      if (sections.has(section)) return;
      sections.set(section, null);
      void load(section)
        .catch((): SkinIconPack => ({}))
        .then((icons) => {
          sections.set(section, icons);
          refreshSkinIcons();
        });
    },
  };
}

/**
 * Полный набор значков образа вместе с дополнительными: у образа с набором из Iconify (src/skinIconPacks) основные значки берутся из него, а недостающие —
 * из линейного набора его стиля (у «Пикселя» — из собственных картинок); у остальных образов — только линейный набор. undefined — у образа набора нет.
 */
export async function loadSkinIconPack(id: SkinId): Promise<{ pack: SkinIconPack; extras?: SkinExtras } | undefined> {
  const own = skinIconPack(id);
  const iconify = SKIN_ICONIFY[id];
  if (iconify === undefined) return own === undefined ? undefined : { pack: own };
  const base = await loadPackGroup(iconify, 'base');
  return { pack: { ...own, ...base }, extras: createExtras((section) => loadPackGroup(iconify, section)) };
}
