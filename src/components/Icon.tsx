import type { SVGProps } from 'react';
import { DUO, LINE } from './iconData';

/**
 * Встроенные SVG-иконки (24×24). Без внешних файлов и CDN — работают офлайн.
 * «duo» — двухтонные заливки (Solar), «line» — линия (Lucide): плюс, галочка, крестик, стрелка, глаз.
 * Разметка берётся только из iconData.ts (наши константы, не пользовательские данные).
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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
