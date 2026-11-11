/**
 * Значки образов для «Настройки → Оформление»: у каждого образа свой (герб, флаг, герой или иллюстрация; файлы src/assets/skins/art/<образ>-thumb.webp,
 * 112×112). Их собирают scripts/skin-art/build.py (образы из материалов) и scripts/skin-art/gen_scenes.mjs (нарисованные образы). Подгружаются только
 * при открытии витрины образов (этот файл входит в её ленивый файл) и в офлайн-кэш не входят.
 *
 * Список не перечисляется руками: берутся все файлы *-thumb.webp из папки, поэтому новому образу достаточно положить свой значок
 * (что значок есть у каждого образа и у всех они разные, проверяет src/skinArt.test.ts).
 */
import type { SkinId } from './skinCore';

const FILES = import.meta.glob<string>('./assets/skins/art/*-thumb.webp', { eager: true, query: '?url', import: 'default' });

export const SKIN_THUMBS = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1).replace('-thumb.webp', ''), url]),
) as Readonly<Record<SkinId, string>>;
