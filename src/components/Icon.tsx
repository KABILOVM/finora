import type { ReactNode, SVGProps } from 'react';

/** Встроенные SVG-иконки (24×24, линия). Без внешних файлов и CDN — работают офлайн. */
const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5V19a2 2 0 0 1-2 2h-3.5v-6h-7v6H5a2 2 0 0 1-2-2z" />,
  list: <path d="M9 6h12M9 12h12M9 18h12M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  wallet: (
    <>
      <path d="M4 7.5V6a2 2 0 0 1 2-2h11v3.5" />
      <path d="M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-.5z" />
      <path d="M16.5 14h.01" />
    </>
  ),
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="m6 7 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  cloud: <path d="M7 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.6 9 4.5 4.5 0 0 1 17.5 19z" />,
  'cloud-off': (
    <>
      <path d="M9.5 5.4A6 6 0 0 1 17.6 9 4.5 4.5 0 0 1 20.5 13M6.6 10.4A4.5 4.5 0 0 0 7 19h10.5" />
      <path d="m3 3 18 18" />
    </>
  ),
  'cloud-check': (
    <>
      <path d="M7 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.6 9 4.5 4.5 0 0 1 17.5 19z" />
      <path d="m9.5 13.5 2 2 3.5-3.5" />
    </>
  ),
  refresh: <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15.5v.01" />
    </>
  ),
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />,
  upload: <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </>
  ),
  transfer: <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />,
  alert: <path d="M12 3.5 2.5 20h19zM12 10v4.5M12 17.5h.01" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  backspace: <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7zM12 9.5l5 5M17 9.5l-5 5" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName;
  /** Размер в px (по умолчанию 24). */
  size?: number;
  /** Подпись для скринридера. Без неё иконка считается декоративной (aria-hidden). */
  label?: string;
}

export function Icon({ name, size = 24, label, strokeWidth = 2, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
