/**
 * Образы оформления: «Классика» (прежний вид с выбираемым акцентом) и клубные образы с готовой палитрой, шрифтами и украшениями.
 *
 * Образ — это атрибут data-skin на <html>. Его блок в src/index.css (`:root[data-skin='…']`) задаёт те же переменные --ac-*, что и
 * акцент, поэтому светлая и тёмная тема, контрасты и тест src/accents.test.ts работают для образа так же, как для акцента.
 * Шрифты и картинки образа лежат в src/assets/skins и грузятся только тем, кто его выбрал (в предзагрузку приложения они не входят).
 *
 * Здесь только данные, без обращения к странице: так их можно читать из тестов и из настроек.
 */
export type SkinId = 'classic' | 'barca' | 'real';

export interface SkinOption {
  id: SkinId;
  /** Название в настройках. */
  label: string;
  /** Одна строка под названием. */
  hint: string;
  /**
   * Цвет строки состояния браузера (meta theme-color) в светлой и тёмной теме: это фон страницы образа, --ac-bg-l и --ac-bg-d
   * его блока в index.css (сверяет src/accents.test.ts). У «Классики» цвет берётся из выбранного акцента, поэтому здесь его нет.
   */
  bar: { light: string; dark: string } | null;
  /** Цвета для образца в настройках: фон, главный цвет и второй цвет. Просто картинка, на сам образ не влияют. */
  swatch: readonly [string, string, string];
}

export const SKINS: readonly SkinOption[] = [
  { id: 'classic', label: 'Классика', hint: 'Прежний вид, цвет выбираете сами', bar: null, swatch: ['#eceefb', '#5b5cf0', '#9a5cf7'] },
  { id: 'barca', label: 'Барселона', hint: 'Сине-гранатовые полосы и золото', bar: { light: '#eef2fb', dark: '#08122e' }, swatch: ['#08122e', '#004d98', '#a50044'] },
  { id: 'real', label: 'Реал Мадрид', hint: 'Белое, королевский синий и золото', bar: { light: '#f7f5ef', dark: '#071028' }, swatch: ['#f7f5ef', '#00529f', '#febe10'] },
];

export const DEFAULT_SKIN: SkinId = 'classic';

export const skinById = (id: string | null): SkinOption | undefined => SKINS.find((s) => s.id === id);
