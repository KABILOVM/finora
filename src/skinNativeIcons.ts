/**
 * «Родные» значки образов: рисунки из материалов образа (src/assets/skins/<набор>/svg), поставленные вместо общих линейных там, где они подходят по смыслу.
 * Лист Конохи вместо «Главной» у «Шиноби», облако у «Акацуки», город у «Паутины», стадион у футбольных образов, лепёшка и чойнак у «Таджикистана».
 * Остальные значки образа берутся из общего набора его стиля (src/skinIcons.ts). Файлы в наборах нарисованы для Finora: сетка 24×24, штрих currentColor.
 * У образа свой стиль линии (толщина, концы, мягкая заливка), и значок рисуется им же, как соседние: так он не выбивается из ряда.
 * Подключается только из src/skinIcons.ts, то есть скачивается вместе с наборами значков, когда выбран образ.
 */
import type { SkinId } from './skinCore';

/** Какой значок приложения чем заменён: имя значка → `<набор>/<файл>`, например home → 'shinobi/leaf'. */
export const NATIVE_ICONS: Readonly<Partial<Record<SkinId, Readonly<Record<string, string>>>>> = {
  shinobi: { home: 'shinobi/leaf', list: 'shinobi/scroll', food: 'shinobi/ramen', ball: 'shinobi/rasengan', star: 'shinobi/shuriken', heart: 'shinobi/sakura', pie: 'shinobi/spiral', game: 'shinobi/ninja' },
  akatsuki: { home: 'akatsuki/cloud', pie: 'akatsuki/rinnegan', heart: 'akatsuki/ring', star: 'akatsuki/moon', game: 'akatsuki/mask', bag: 'akatsuki/cloak' },
  spider: { home: 'spider/city', pie: 'spider/web', star: 'spider/spider', game: 'spider/mask', chart: 'spider/sense' },
  tajik: { food: 'tajik/non', cup: 'tajik/choynak', star: 'tajik/oftob', game: 'tajik/dutor', gift: 'tajik/anor', heart: 'tajik/gul' },
  pamir: { home: 'tajik/pamir', food: 'tajik/non', cup: 'tajik/choynak', star: 'tajik/oftob' },
  barca: { home: 'football/stadium', list: 'football/ticket', chart: 'football/tactics', ball: 'football/ball', star: 'football/medal', bag: 'football/jersey' },
  argentina: { home: 'football/stadium', list: 'football/ticket', chart: 'football/tactics', ball: 'football/ball', star: 'football/medal', bag: 'football/jersey' },
  messi: { home: 'football/stadium', list: 'football/ticket', chart: 'football/tactics', ball: 'football/ball', star: 'football/medal', bag: 'football/jersey' },
  spain: { home: 'football/stadium', list: 'football/ticket', chart: 'football/tactics', ball: 'football/ball', star: 'football/medal', bag: 'football/jersey' },
  cr7: { home: 'football/stadium', list: 'football/ticket', chart: 'football/tactics', ball: 'football/ball', star: 'football/medal', bag: 'football/jersey' },
  football: { home: 'football/stadium', list: 'football/ticket', chart: 'football/tactics', ball: 'football/ball', star: 'football/medal', bag: 'football/jersey' },
  real: { home: 'real-madrid/bernabeu', list: 'football/ticket', chart: 'football/tactics', ball: 'football/ball', star: 'real-madrid/crown', bag: 'football/jersey' },
};

/** Исходники значков: путь `<набор>/<файл>` → текст SVG. Только те файлы, что названы в NATIVE_ICONS. */
const RAW = import.meta.glob(
  [
  './assets/skins/akatsuki/svg/cloak.svg',
  './assets/skins/akatsuki/svg/cloud.svg',
  './assets/skins/akatsuki/svg/mask.svg',
  './assets/skins/akatsuki/svg/moon.svg',
  './assets/skins/akatsuki/svg/ring.svg',
  './assets/skins/akatsuki/svg/rinnegan.svg',
  './assets/skins/football/svg/ball.svg',
  './assets/skins/football/svg/jersey.svg',
  './assets/skins/football/svg/medal.svg',
  './assets/skins/football/svg/stadium.svg',
  './assets/skins/football/svg/tactics.svg',
  './assets/skins/football/svg/ticket.svg',
  './assets/skins/real-madrid/svg/bernabeu.svg',
  './assets/skins/real-madrid/svg/crown.svg',
  './assets/skins/shinobi/svg/leaf.svg',
  './assets/skins/shinobi/svg/ninja.svg',
  './assets/skins/shinobi/svg/ramen.svg',
  './assets/skins/shinobi/svg/rasengan.svg',
  './assets/skins/shinobi/svg/sakura.svg',
  './assets/skins/shinobi/svg/scroll.svg',
  './assets/skins/shinobi/svg/shuriken.svg',
  './assets/skins/shinobi/svg/spiral.svg',
  './assets/skins/spider/svg/city.svg',
  './assets/skins/spider/svg/mask.svg',
  './assets/skins/spider/svg/sense.svg',
  './assets/skins/spider/svg/spider.svg',
  './assets/skins/spider/svg/web.svg',
  './assets/skins/tajik/svg/anor.svg',
  './assets/skins/tajik/svg/choynak.svg',
  './assets/skins/tajik/svg/dutor.svg',
  './assets/skins/tajik/svg/gul.svg',
  './assets/skins/tajik/svg/non.svg',
  './assets/skins/tajik/svg/oftob.svg',
  './assets/skins/tajik/svg/pamir.svg',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** Текст SVG значка по `<набор>/<файл>` или undefined, если такого файла нет. */
export function nativeSvg(key: string): string | undefined {
  return RAW[`./assets/skins/${key.replace('/', '/svg/')}.svg`];
}

/** Что внутри <svg>: фигуры без заголовка и без своих атрибутов оформления на корне (их задаёт стиль образа). */
export function nativeShapes(svg: string): string {
  return svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .trim();
}
