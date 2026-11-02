/**
 * Образы оформления: «Классика» (прежний вид с выбираемым акцентом) и готовые образы с палитрой, шрифтом заголовков, узором и украшением.
 *
 * Образ — это атрибут data-skin на <html>. Его блок в src/index.css (`:root[data-skin='…']`) задаёт те же переменные --ac-*, что и
 * акцент, поэтому светлая и тёмная тема, контрасты и тест src/accents.test.ts работают для образа так же, как для акцента.
 * Шрифты, узоры и рисунки образа лежат в src/assets/skins; шрифты скачиваются только у тех, кто образ выбрал (см. @font-face в index.css).
 * В образах по мотивам фильмов и аниме нет героев и знаков из них: только палитра, узор и свои нейтральные фигуры.
 *
 * Здесь только данные, без обращения к странице: так их можно читать из тестов и из настроек.
 */
import { DEFAULT_SKIN, SKIN_BARS, type SkinId } from './skinCore';

export type { SkinId };

export type SkinGroupId = 'classic' | 'football' | 'story' | 'national' | 'style';

/** Разделы списка образов в настройках, в порядке показа. */
export const SKIN_GROUPS: readonly { id: SkinGroupId; label: string }[] = [
  { id: 'classic', label: 'Классика' },
  { id: 'football', label: 'Футбол' },
  { id: 'story', label: 'Кино и аниме' },
  { id: 'national', label: 'Национальные' },
  { id: 'style', label: 'Стили' },
];

export interface SkinOption {
  id: SkinId;
  /** Название в настройках. */
  label: string;
  /** Одна строка под названием. */
  hint: string;
  group: SkinGroupId;
  /**
   * Цвет строки состояния браузера (meta theme-color) в светлой и тёмной теме: это фон страницы образа, --ac-bg-l и --ac-bg-d его
   * блока в index.css (сверяет src/accents.test.ts). У «Классики» цвет берётся из выбранного акцента, поэтому здесь его нет.
   */
  bar: { light: string; dark: string } | null;
  /** Цвета для образца в настройках: фон, главный цвет и второй цвет. Просто картинка, на сам образ не влияют. */
  swatch: readonly [string, string, string];
}

export const SKINS: readonly SkinOption[] = [
  { id: 'classic', label: 'Классика', hint: 'Прежний вид, цвет выбираете сами', group: 'classic', bar: null, swatch: ['#eceefb', '#5b5cf0', '#9a5cf7'] },
  { id: 'barca', label: 'Барселона', hint: 'Сине-гранатовые полосы и золото', group: 'football', bar: SKIN_BARS.barca, swatch: ['#08122e', '#004d98', '#a50044'] },
  { id: 'real', label: 'Реал Мадрид', hint: 'Белое, королевский синий и золото', group: 'football', bar: SKIN_BARS.real, swatch: ['#f7f5ef', '#00529f', '#febe10'] },
  { id: 'argentina', label: 'Аргентина', hint: 'Небесные полосы и золотое солнце', group: 'football', bar: SKIN_BARS.argentina, swatch: ['#06141f', '#1c6396', '#75aadb'] },
  { id: 'messi', label: 'Месси', hint: 'Десятка, небесный и золото', group: 'football', bar: SKIN_BARS.messi, swatch: ['#0a141c', '#14507f', '#f6b40e'] },
  { id: 'spain', label: 'Испания', hint: 'Красное и жёлтое', group: 'football', bar: SKIN_BARS.spain, swatch: ['#1a0a0b', '#b01018', '#ffc400'] },
  { id: 'cr7', label: 'Роналду', hint: 'Семёрка, чёрное, золото и гранат', group: 'football', bar: SKIN_BARS.cr7, swatch: ['#0a0a0a', '#8a1520', '#d4a11b'] },
  { id: 'football', label: 'Футбол', hint: 'Газон в полоску, янтарь и мяч', group: 'football', bar: SKIN_BARS.football, swatch: ['#07140c', '#0d5c2d', '#ffd23f'] },
  { id: 'shinobi', label: 'Шиноби', hint: 'Пергамент, оранжевый и тёмно-синий', group: 'story', bar: SKIN_BARS.shinobi, swatch: ['#f6ecd8', '#8c430e', '#1a2140'] },
  { id: 'akatsuki', label: 'Акацуки', hint: 'Чёрная ночь и красный дождь', group: 'story', bar: SKIN_BARS.akatsuki, swatch: ['#0a0a0c', '#b30e14', '#ff5656'] },
  { id: 'spider', label: 'Паутина', hint: 'Красное, синее и паутина', group: 'story', bar: SKIN_BARS.spider, swatch: ['#0a0d1c', '#b51c22', '#ff646b'] },
  { id: 'comic', label: 'Герой', hint: 'Комикс: красное, синее и точки', group: 'story', bar: SKIN_BARS.comic, swatch: ['#eef2ff', '#b81324', '#1d3fa8'] },
  { id: 'tajik', label: 'Таджикистан', hint: 'Глина, атлас, гулдузи и индиго', group: 'national', bar: SKIN_BARS.tajik, swatch: ['#f1e6cd', '#a12235', '#1f2f66'] },
  { id: 'pamir', label: 'Памир', hint: 'Лёд, снег и гранат', group: 'national', bar: SKIN_BARS.pamir, swatch: ['#e7f0f6', '#12405f', '#b3123b'] },
  { id: 'kawaii', label: 'Кавай', hint: 'Розовый, сиреневый и точки', group: 'style', bar: SKIN_BARS.kawaii, swatch: ['#fff0f8', '#805068', '#9680c2'] },
  { id: 'aesthetic', label: 'Эстетика', hint: 'Роза, золото и тишина', group: 'style', bar: SKIN_BARS.aesthetic, swatch: ['#f7ebe6', '#8b3e5c', '#a05a74'] },
  { id: 'racing', label: 'Гонки', hint: 'Карбон и красная полоса', group: 'style', bar: SKIN_BARS.racing, swatch: ['#101114', '#bb0500', '#ff655a'] },
  { id: 'cyber', label: 'Киберпанк', hint: 'Неон, сетка и ночь', group: 'style', bar: SKIN_BARS.cyber, swatch: ['#07060f', '#076178', '#20e3ff'] },
  { id: 'pixel', label: 'Пиксель', hint: 'Оттенки зелёного, как на старой приставке', group: 'style', bar: SKIN_BARS.pixel, swatch: ['#eef4d2', '#306230', '#0f380f'] },
];

export { DEFAULT_SKIN };

export const skinById = (id: string | null): SkinOption | undefined => SKINS.find((s) => s.id === id);
