import { createElement, useId, useMemo, type ReactNode, type SVGProps } from 'react';
import { DUO, LINE } from './iconData';
import { skinIconKey, skinIconMarkup, useSkinIconPack } from './skinIconStore';

/**
 * Встроенные SVG-иконки (24×24). Без внешних файлов и CDN — работают офлайн.
 * «duo» — двухтонные заливки (Solar), «line» — линия (Lucide): плюс, галочка, крестик, стрелка, глаз.
 * Разметка берётся только из iconData.ts и из набора значков образа (skinIconStore.ts): это наши константы, не пользовательские данные. Строки один раз разбираются в обычные
 * React-элементы (без dangerouslySetInnerHTML), результат кэшируется.
 */
export type IconName = keyof typeof DUO | keyof typeof LINE;

export const ICON_NAMES = [...Object.keys(DUO), ...Object.keys(LINE)] as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName;
  /** Размер в px (по умолчанию 24). */
  size?: number;
  /** Подпись для скринридера. Без неё иконка считается декоративной (aria-hidden). */
  label?: string;
}

const cache = new Map<string, ReactNode>();

/** `stroke-linecap` → `strokeLinecap`; `data-*` и `aria-*` остаются как есть. */
const propName = (attr: string) => (/^(data|aria)-/.test(attr) ? attr : attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

function toReact(node: Element, key: number): ReactNode {
  const props: Record<string, string> = { key: String(key) };
  for (const a of Array.from(node.attributes)) props[propName(a.name)] = a.value;
  // имя тега как в разметке: у SVG оно чувствительно к регистру (linearGradient, radialGradient), в нижнем регистре браузер градиент не узнает
  return createElement(node.tagName, props, ...Array.from(node.children).map(toReact));
}

const parse = (markup: string): ReactNode =>
  Array.from(new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement.children).map(toReact);

function shapes(name: string, markup: string): ReactNode {
  let nodes = cache.get(name);
  if (nodes === undefined) {
    nodes = parse(markup);
    cache.set(name, nodes);
  }
  return nodes;
}

/**
 * Разметка значка. Если в ней есть id (градиенты и повторно используемые фигуры у цветных наборов образов), одинаковые id у двух экземпляров значка на странице нельзя: браузер берёт первый, а он
 * может сидеть в скрытом блоке (боковое меню на телефоне, display:none), и заливка пропадает. Поэтому каждому экземпляру — свой суффикс id (useId), без общего кэша.
 */
function useShapes(key: string, markup: string): ReactNode {
  const suffix = useId().replace(/:/g, '');
  return useMemo(
    () => (markup.includes(' id="') ? parse(markup.replace(/\bid="([^"]+)"/g, `id="$1${suffix}"`).replace(/(url\(#|href="#)([^)"]+)/g, `$1$2${suffix}`)) : shapes(key, markup)),
    [key, markup, suffix],
  );
}

export function Icon({ name, size = 24, label, strokeWidth = 2.2, ...rest }: IconProps) {
  useSkinIconPack(); // у образа может быть свой рисунок значка (замены двухтонные, как DUO)
  const custom = skinIconMarkup(name);
  const isLine = custom === null && name in LINE;
  const html = custom ?? (isLine ? LINE[name as keyof typeof LINE] : DUO[name as keyof typeof DUO]);
  const shapesOf = useShapes(skinIconKey(name), html);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={isLine ? 'none' : 'currentColor'}
      stroke={isLine ? 'currentColor' : undefined}
      strokeWidth={isLine ? strokeWidth : undefined}
      strokeLinecap={isLine ? 'round' : undefined}
      strokeLinejoin={isLine ? 'round' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-skin-icon={custom === null ? undefined : ''}
      {...rest}
    >
      {shapesOf}
    </svg>
  );
}

export interface DuoMarkupProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  /** Ключ для кэша разбора: имя значка (не должно совпадать с именами из iconData.ts). */
  cacheKey: string;
  /** Разметка двухтонного значка (как в iconData.ts), например из ленивого файла дополнительных значков. */
  markup: string;
  size?: number;
}

/** Значок по готовой разметке, не из iconData.ts: дополнительные значки приходят из ленивых файлов (см. glyphExtras.ts). Рисуется так же, как Icon. */
export function DuoMarkup({ cacheKey, markup, size = 24, ...rest }: DuoMarkupProps) {
  const children = useShapes(`extra:${cacheKey}`, markup);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}
