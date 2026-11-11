import { contrastRatio, hexToRgb, paletteFromHex, paletteProblems, type Palette, type Rgb } from '@/lib/palette';
import { triple } from '@/lib/paletteBase';

/**
 * Из чего собирается свой образ в конструкторе: готовые цвета, шрифты, узоры и наборы значков. Всё это уже есть в приложении у готовых
 * образов (шрифты лежат в src/assets/skins/fonts, наборы значков — в src/skinIconPacks), поэтому свой образ ничего нового не скачивает.
 */

/** Цвета для быстрого выбора: по кругу оттенков, затем спокойные. */
export const PRESET_COLORS: readonly { hex: string; label: string }[] = [
  { hex: '#6d5ef0', label: 'Фиолетовый' },
  { hex: '#2563eb', label: 'Синий' },
  { hex: '#0891b2', label: 'Бирюзовый' },
  { hex: '#059669', label: 'Зелёный' },
  { hex: '#ca8a04', label: 'Золотой' },
  { hex: '#ea580c', label: 'Оранжевый' },
  { hex: '#dc2626', label: 'Красный' },
  { hex: '#db2777', label: 'Розовый' },
  { hex: '#475569', label: 'Графит' },
];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

/** Сдвигает цвет к чёрному или белому шагами по 2%, пока он не даст нужный контраст с `against`. */
function fit(color: Rgb, against: Rgb, min: number, toward: Rgb): Rgb {
  for (let i = 0; i <= 50; i++) {
    const c = mix(color, toward, i / 50);
    if (contrastRatio(against, c) >= min) return c;
  }
  return toward;
}

/**
 * Палитра своего образа: из главного цвета её строит тот же генератор, что у «своего цвета» акцента, а второй цвет (если выбран) встаёт на
 * место подобранного: конец градиента кнопок, отсвет фона и вторая плитка знака. Второй цвет подгоняется под те же требования контраста
 * (белый текст кнопки на нём в светлой теме, тёмный — в тёмной); если палитра всё равно не проходит проверку, второй цвет не используется.
 * null — главный цвет не разобран.
 */
export function buildCustomPalette(hex: string, hex2: string | null): Palette | null {
  const base = paletteFromHex(hex);
  const second = hex2 === null ? null : hexToRgb(hex2);
  if (base === null || second === null) return base;
  const accentL = fit(second, WHITE, 3.2, BLACK);
  const accentD = fit(second, base['on-brand-d'], 3.2, WHITE);
  const logoTo = fit(fit(second, WHITE, 3.2, BLACK), base['logo-glyph'], 3.2, BLACK);
  const next: Palette = {
    ...base,
    'accent-l': accentL,
    'accent-d': accentD,
    'orb-2-l': mix(accentL, WHITE, 0.6),
    'orb-2-d': mix(base['bg-d'], second, 0.45),
    'logo-to': logoTo,
  };
  return paletteProblems(next).length === 0 ? next : base;
}

const SANS = "'Onest', ui-sans-serif, system-ui, sans-serif";
const sans = (family: string): string => `'${family}', ${SANS}`;
const serif = (family: string): string => `'${family}', 'Onest', Georgia, serif`;

/** Шрифты заголовков: `head` — значение font-family (пустое — шрифт приложения). Файлы шрифта скачаются, только когда образ с ним применят. */
export const FONT_CHOICES: readonly { value: string; label: string; head: string }[] = [
  { value: 'app', label: 'Как в приложении', head: '' },
  { value: 'montserrat', label: 'Montserrat', head: sans('Montserrat') },
  { value: 'commissioner', label: 'Commissioner', head: sans('Commissioner') },
  { value: 'oswald', label: 'Oswald', head: sans('Oswald') },
  { value: 'exo', label: 'Exo 2', head: sans('Exo 2') },
  { value: 'tektur', label: 'Tektur', head: sans('Tektur') },
  { value: 'nunito', label: 'Nunito', head: sans('Nunito') },
  { value: 'marmelad', label: 'Marmelad', head: sans('Marmelad') },
  { value: 'shantell', label: 'Shantell Sans', head: sans('Shantell Sans') },
  { value: 'lora', label: 'Lora', head: serif('Lora') },
  { value: 'alegreya', label: 'Alegreya', head: serif('Alegreya') },
  { value: 'forum', label: 'Forum', head: serif('Forum') },
  { value: 'podkova', label: 'Podkova', head: serif('Podkova') },
  { value: 'mono', label: 'Моноширинный', head: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" },
];

export const PATTERN_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'none', label: 'Без узора' },
  { value: 'dots', label: 'Точки' },
  { value: 'stripes', label: 'Полосы' },
  { value: 'diag', label: 'Штрих' },
  { value: 'grid', label: 'Сетка' },
  { value: 'checks', label: 'Клетка' },
  { value: 'scales', label: 'Чешуя' },
];

/** Узор фона (background-image и background-size) в главном цвете образа; у «Без узора» оба значения пустые. */
export function patternCss(kind: string, palette: Palette): { image: string; size: string } {
  const p = triple(palette['brand-l']);
  switch (kind) {
    case 'dots':
      return { image: `radial-gradient(rgb(${p} / 0.13) 1.5px, transparent 2px)`, size: '20px 20px' };
    case 'stripes':
      return { image: `repeating-linear-gradient(90deg, rgb(${p} / 0.05) 0 26px, transparent 26px 52px)`, size: '' };
    case 'diag':
      return { image: `repeating-linear-gradient(135deg, rgb(${p} / 0.05) 0 2px, transparent 2px 14px)`, size: '' };
    case 'grid':
      return { image: `linear-gradient(rgb(${p} / 0.07) 1px, transparent 1px), linear-gradient(90deg, rgb(${p} / 0.07) 1px, transparent 1px)`, size: '24px 24px' };
    case 'checks':
      return { image: `conic-gradient(rgb(${p} / 0.05) 25%, transparent 0 50%, rgb(${p} / 0.05) 0 75%, transparent 0)`, size: '28px 28px' };
    case 'scales':
      return { image: `radial-gradient(circle at 50% 100%, transparent 10px, rgb(${p} / 0.1) 10px 11.5px, transparent 11.5px)`, size: '24px 12px' };
    default:
      return { image: '', size: '' };
  }
}

/** Наборы значков: значение — готовый образ, чей набор берётся (src/skinIcons.ts и src/skinIconPacks); «none» — обычные значки приложения. */
export const ICON_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'none', label: 'Обычные' },
  { value: 'real', label: 'Тонкие' },
  { value: 'barca', label: 'Спортивные' },
  { value: 'akatsuki', label: 'Острые' },
  { value: 'spider', label: 'Технические' },
  { value: 'kawaii', label: 'Милые' },
  { value: 'aesthetic', label: 'Люкс' },
  { value: 'clay', label: 'Глина' },
  { value: 'liquid', label: 'Стекло' },
  { value: 'chrome', label: 'Хром' },
  { value: 'retro', label: 'Ретро' },
  { value: 'notebook', label: 'Карандаш' },
  { value: 'cafe', label: 'Пастель' },
  { value: 'pixel', label: 'Пиксели' },
];
