import type { SkinId } from '../skinCore';

/**
 * Наборы значков из Iconify, по одному на образ (рисунки в папках src/skinIconPacks/<набор>/, их создаёт scripts/skin-art/icon_packs.py).
 * В папке набора файл base.ts — основные значки приложения (iconData.ts), остальные файлы — дополнительные по разделам (iconExtraData.ts: family, home, food…).
 * Файлы грузятся лениво и по одному, только когда образ выбран (основные) и когда на экране появился значок раздела (дополнительные). В основной файл приложения они
 * не входят, а в офлайн-кэш не кладутся (см. globIgnores в vite.config.ts): иначе при установке все скачали бы мегабайты рисунков образов, которых никогда не выберут.
 */
export type IconPackId = 'wi-anime' | 'wi-brutal' | 'wi-kawaii' | 'wi-luxe' | 'wi-coquette' | 'wi-gothic' | 'wi-clay' | 'wi-liquid' | 'wi-chrome' | 'wi-retro' | 'wi-bauhaus' | 'wi-sticker' | 'pp-pencil' | 'game-icons' | 'wi-pastel' | 'wi-soft3d' | 'pixelarticons' | 'sl-cyber' | 'ph-fill';

/** Какой набор у какого образа. У образов, которых здесь нет, значки рисуются линией их стиля (src/skinIcons.ts). */
export const SKIN_ICONIFY: Readonly<Partial<Record<SkinId, IconPackId>>> = {
  shinobi: 'wi-anime',
  comic: 'wi-brutal',
  kawaii: 'wi-kawaii',
  aesthetic: 'wi-luxe',
  pixel: 'pixelarticons',
  cyber: 'sl-cyber',
  racing: 'ph-fill',
  coquette: 'wi-coquette',
  gothic: 'wi-gothic',
  clay: 'wi-clay',
  liquid: 'wi-liquid',
  chrome: 'wi-chrome',
  retro: 'wi-retro',
  bauhaus: 'wi-bauhaus',
  sticker: 'wi-sticker',
  notebook: 'pp-pencil',
  dungeon: 'game-icons',
  graffiti: 'wi-brutal', // тот же набор, что у «Героя»: те же файлы, второй раз ничего не скачивается
  cafe: 'wi-pastel',
  nowruz: 'wi-soft3d',
};

type PackFile = { ICONS: Readonly<Record<string, string>> };

/** Все файлы наборов: путь вида «./wi-anime/base.ts» → загрузчик. */
const FILES = import.meta.glob<PackFile>('./*/*.ts');

/** Значки одной группы набора: «base» или раздел дополнительных значков. Нет такого файла (в наборе нет значков этого раздела) — пустой объект. */
export async function loadPackGroup(pack: IconPackId, group: string): Promise<Readonly<Record<string, string>>> {
  const load = FILES[`./${pack}/${group}.ts`];
  return load === undefined ? {} : (await load()).ICONS;
}

/** Имена файлов наборов (для проверок). */
export const PACK_FILES: readonly string[] = Object.keys(FILES);
