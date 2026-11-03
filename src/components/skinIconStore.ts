import { useEffect, useSyncExternalStore } from 'react';

/**
 * Набор значков образа: у образов (src/skinCore.ts → SKIN_ICON_PACKS) свои рисунки для встроенных значков.
 * Сам набор (src/skinIcons.ts) грузится лениво, только когда образ выбран, и кладётся сюда; Icon берёт разметку отсюда, если для имени есть
 * замена, и обычную из iconData.ts, если нет. Замена — либо двухтонная разметка (fill="currentColor", полупрозрачные части через opacity),
 * либо целый `<svg viewBox>` готового набора значков (цветной или одноцветный).
 *
 * Дополнительные значки (семья, коммунальные услуги… — iconExtraData.ts) у наборов лежат отдельными файлами по разделам: набор отдаёт SkinExtras,
 * и файл раздела качается, только когда на экране появился значок из него. Вся работа с файлами — в ленивом src/skinIcons.ts, здесь только хук.
 */
export type SkinIconPack = Readonly<Record<string, string>>;

/** Дополнительные значки набора образа: get — разметка (null: файл раздела ещё грузится; undefined: в наборе такого значка нет), ensure — начать загрузку раздела. */
export interface SkinExtras {
  get(name: string, section: string): string | null | undefined;
  ensure(section: string): void;
}

let pack: SkinIconPack | null = null;
let packId: string | null = null;
let extras: SkinExtras | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** Сообщает всем значкам на экране, что набор изменился (его ставят или догрузился файл раздела). */
export function refreshSkinIcons(): void {
  version += 1;
  listeners.forEach((l) => l());
}

/** Ставит набор (или убирает его: null). Все значки на экране перерисовываются сами. */
export function setSkinIconPack(next: SkinIconPack | null, id: string | null, nextExtras?: SkinExtras): void {
  pack = next;
  packId = next === null ? null : id;
  extras = next === null ? null : (nextExtras ?? null);
  refreshSkinIcons();
}

/** Разметка замены для значка; null — у образа для него своего рисунка нет. */
export const skinIconMarkup = (name: string): string | null => pack?.[name] ?? null;

/** Ключ для кэша разбора: замена одного и того же имени у разных образов — разные рисунки. */
export const skinIconKey = (name: string): string => (pack !== null && name in pack ? `${name}@${packId ?? ''}` : name);

/** Имя набора образа (для ключей кэша разбора); пусто, если набора нет. */
export const skinPackId = (): string => packId ?? '';

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Подписка для компонентов, которые рисуют значки: перерисовка при смене набора. */
export function useSkinIconPack(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/** Для компонента с дополнительным значком: разметка из набора образа (null — ещё грузится; undefined — нет набора или значка, рисуется обычный). Сам запускает загрузку раздела. */
export function useSkinExtraIcon(name: string, section: string): string | null | undefined {
  useSkinIconPack();
  const current = extras;
  useEffect(() => current?.ensure(section), [current, section]);
  return current === null ? undefined : current.get(name, section);
}
