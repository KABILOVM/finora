import { createElement, type ReactNode, type SVGProps } from 'react';
import { DUO, LINE } from './iconData';

/**
 * Встроенные SVG-иконки (24×24). Без внешних файлов и CDN — работают офлайн.
 * «duo» — двухтонные заливки (Solar), «line» — линия (Lucide): плюс, галочка, крестик, стрелка, глаз.
 * Разметка берётся только из iconData.ts (наши константы, не пользовательские данные). Строки один раз разбираются в обычные
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
  return createElement(node.tagName.toLowerCase(), props, ...Array.from(node.children).map(toReact));
}

function shapes(name: string, markup: string): ReactNode {
  let nodes = cache.get(name);
  if (nodes === undefined) {
    const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement;
    nodes = Array.from(svg.children).map(toReact);
    cache.set(name, nodes);
  }
  return nodes;
}

export function Icon({ name, size = 24, label, strokeWidth = 2.2, ...rest }: IconProps) {
  const isLine = name in LINE;
  const html = isLine ? LINE[name as keyof typeof LINE] : DUO[name as keyof typeof DUO];
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
      {...rest}
    >
      {shapes(name, html)}
    </svg>
  );
}
