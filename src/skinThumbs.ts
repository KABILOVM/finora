/**
 * Значки образов для «Настройки → Оформление»: у каждого образа свой (герб, флаг, герой или иллюстрация из материалов образа, src/assets/skins/art,
 * 112×112, webp). Их собирает scripts/skin-art/build.py. Подгружаются только при открытии настроек (этот файл входит в их ленивый кусок) и в
 * офлайн-кэш не входят.
 */
import type { SkinId } from './skinCore';
import thumbClassic from './assets/skins/art/classic-thumb.webp';
import thumbBarca from './assets/skins/art/barca-thumb.webp';
import thumbReal from './assets/skins/art/real-thumb.webp';
import thumbArgentina from './assets/skins/art/argentina-thumb.webp';
import thumbMessi from './assets/skins/art/messi-thumb.webp';
import thumbSpain from './assets/skins/art/spain-thumb.webp';
import thumbCr7 from './assets/skins/art/cr7-thumb.webp';
import thumbFootball from './assets/skins/art/football-thumb.webp';
import thumbShinobi from './assets/skins/art/shinobi-thumb.webp';
import thumbAkatsuki from './assets/skins/art/akatsuki-thumb.webp';
import thumbSpider from './assets/skins/art/spider-thumb.webp';
import thumbComic from './assets/skins/art/comic-thumb.webp';
import thumbTajik from './assets/skins/art/tajik-thumb.webp';
import thumbPamir from './assets/skins/art/pamir-thumb.webp';
import thumbKawaii from './assets/skins/art/kawaii-thumb.webp';
import thumbAesthetic from './assets/skins/art/aesthetic-thumb.webp';
import thumbRacing from './assets/skins/art/racing-thumb.webp';
import thumbCyber from './assets/skins/art/cyber-thumb.webp';
import thumbPixel from './assets/skins/art/pixel-thumb.webp';
import thumbCoquette from './assets/skins/art/coquette-thumb.webp';
import thumbGothic from './assets/skins/art/gothic-thumb.webp';
import thumbClay from './assets/skins/art/clay-thumb.webp';
import thumbLiquid from './assets/skins/art/liquid-thumb.webp';
import thumbChrome from './assets/skins/art/chrome-thumb.webp';

export const SKIN_THUMBS: Readonly<Record<SkinId, string>> = {
  classic: thumbClassic,
  barca: thumbBarca,
  real: thumbReal,
  argentina: thumbArgentina,
  messi: thumbMessi,
  spain: thumbSpain,
  cr7: thumbCr7,
  football: thumbFootball,
  shinobi: thumbShinobi,
  akatsuki: thumbAkatsuki,
  spider: thumbSpider,
  comic: thumbComic,
  tajik: thumbTajik,
  pamir: thumbPamir,
  kawaii: thumbKawaii,
  aesthetic: thumbAesthetic,
  racing: thumbRacing,
  cyber: thumbCyber,
  pixel: thumbPixel,
  coquette: thumbCoquette,
  gothic: thumbGothic,
  clay: thumbClay,
  liquid: thumbLiquid,
  chrome: thumbChrome,
};
