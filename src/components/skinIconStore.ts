import { useSyncExternalStore } from 'react';

/**
 * Набор значков образа: у некоторых образов (src/skinCore.ts → SKIN_ICON_PACKS) свои рисунки для части встроенных значков.
 * Сам набор (src/skinIcons.ts) грузится лениво, только когда образ выбран, и кладётся сюда; Icon берёт разметку отсюда, если для имени есть
 * замена, и обычную из iconData.ts, если нет. Замена — та же двухтонная разметка (fill="currentColor", полупрозрачные части через opacity).
 */
export type SkinIconPack = Readonly<Record<string, string>>;

let pack: SkinIconPack | null = null;
let packId: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** Ставит набор (или убирает его: null). Все значки на экране перерисовываются сами. */
export function setSkinIconPack(next: SkinIconPack | null, id: string | null): void {
  pack = next;
  packId = next === null ? null : id;
  version += 1;
  listeners.forEach((l) => l());
}

/** Разметка замены для значка; null — у образа для него своего рисунка нет. */
export const skinIconMarkup = (name: string): string | null => pack?.[name] ?? null;

/** Ключ для кэша разбора: замена одного и того же имени у разных образов — разные рисунки. */
export const skinIconKey = (name: string): string => (pack !== null && name in pack ? `${name}@${packId ?? ''}` : name);

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Подписка для компонентов, которые рисуют значки: перерисовка при смене набора. */
export function useSkinIconPack(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}
