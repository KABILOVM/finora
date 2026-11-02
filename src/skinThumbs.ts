/**
 * Миниатюры образов для «Настройки → Оформление»: герб, флаг или картинка из материалов образа (src/assets/skins/art, 112×112, webp).
 * Они у образов, для которых есть что показать; у остальных на карточке остаются три цветные точки (src/skins.ts → swatch).
 * Файлы собирает scripts/skin-art/build.py. Подгружаются только при открытии настроек (этот файл входит в их ленивый кусок) и в офлайн-кэш не входят.
 */
import type { SkinId } from './skinCore';
import barca from './assets/skins/art/barca-thumb.webp';
import real from './assets/skins/art/real-thumb.webp';
import spain from './assets/skins/art/spain-thumb.webp';
import messi from './assets/skins/art/messi-thumb.webp';
import shinobi from './assets/skins/art/shinobi-thumb.webp';
import akatsuki from './assets/skins/art/akatsuki-thumb.webp';
import spider from './assets/skins/art/spider-thumb.webp';
import tajik from './assets/skins/art/tajik-thumb.webp';
import pamir from './assets/skins/art/pamir-thumb.webp';

export const SKIN_THUMBS: Partial<Record<SkinId, string>> = {
  barca,
  real,
  spain,
  messi,
  shinobi,
  akatsuki,
  spider,
  tajik,
  pamir,
};
