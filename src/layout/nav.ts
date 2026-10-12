import { useLocation, type Location } from 'react-router-dom';
import type { IconName } from '@/components/Icon';
import type { TxKind } from '@/domain/types';

export interface NavItem {
  to: string;
  /** Подпись в нижней панели телефона. */
  label: string;
  /** Подпись в боковой панели ПК. */
  sideLabel: string;
  icon: IconName;
  /** Активен только при точном совпадении пути (для «/»). */
  end?: boolean;
  /** Есть ли пункт в нижней панели телефона (там место только для четырёх). */
  phone?: boolean;
  /** Где пункт в боковой панели ПК: основная группа сверху, нижняя группа или его там нет. */
  side?: 'main' | 'bottom';
  /** Пункт подсвечен и на этих разделах (и их вложенных адресах) в нижней панели; по умолчанию только на своём. */
  phoneActiveOn?: readonly string[];
  /** То же для боковой панели. */
  sideActiveOn?: readonly string[];
}

/** Разделы, которые на телефоне лежат за пунктом «Ещё»: там он остаётся подсвеченным. */
export const MORE_SECTIONS = ['/more', '/budgets', '/recurring', '/shopping', '/debts', '/settings', '/import'] as const;

/**
 * Пункты меню. На телефоне «+» (добавить операцию) вставляется между вторым и третьим пунктом.
 * На ПК места больше: в основной группе Бюджеты, Платежи, Покупки и Долги, внизу «Настройки». Пункта «Ещё» на ПК нет:
 * это меню только для телефона, где в нижней панели не хватает места. Категории и импорт лежат внутри «Настроек».
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Главная', sideLabel: 'Главная', icon: 'home', end: true, phone: true, side: 'main' },
  { to: '/transactions', label: 'Операции', sideLabel: 'Операции', icon: 'list', phone: true, side: 'main' },
  { to: '/wallets', label: 'Кошельки', sideLabel: 'Кошельки', icon: 'wallet', phone: true, side: 'main' },
  { to: '/budgets', label: 'Бюджеты', sideLabel: 'Бюджеты', icon: 'pie', side: 'main' },
  { to: '/recurring', label: 'Регулярные платежи', sideLabel: 'Платежи', icon: 'repeat', side: 'main' },
  { to: '/shopping', label: 'Покупки', sideLabel: 'Покупки', icon: 'cart', side: 'main' },
  { to: '/debts', label: 'Долги и кредиты', sideLabel: 'Долги', icon: 'banknote', side: 'main' },
  {
    to: '/more',
    label: 'Ещё',
    sideLabel: 'Ещё',
    icon: 'more',
    phone: true,
    phoneActiveOn: MORE_SECTIONS,
  },
  // На ПК подсвечен и внутри «Настроек»: категории и импорт — их части
  { to: '/settings', label: 'Настройки', sideLabel: 'Настройки', icon: 'sliders', side: 'bottom', sideActiveOn: ['/settings', '/import'] },
];

/** Путь без хвостовых «/» и в нижнем регистре (маршруты регистр не различают, подсветка тоже). */
const normalize = (path: string): string => path.toLowerCase().replace(/\/+$/, '') || '/';

/** Путь равен разделу или лежит внутри него (/settings/categories внутри /settings). */
export function isInSection(pathname: string, section: string): boolean {
  const p = normalize(pathname);
  const s = normalize(section);
  return s === '/' ? p === '/' : p === s || p.startsWith(`${s}/`);
}

/** Подсвечен ли пункт на этой странице. `surface` — где рисуем: нижняя панель телефона или боковая ПК. */
export function isNavActive(item: NavItem, pathname: string, surface: 'phone' | 'side'): boolean {
  const extra = surface === 'phone' ? item.phoneActiveOn : item.sideActiveOn;
  if (extra) return extra.some((s) => isInSection(pathname, s));
  if (item.end) return normalize(pathname) === normalize(item.to);
  return isInSection(pathname, item.to);
}

export const ADD_PATH = '/add';
export const ADD_LABEL = 'Добавить операцию';

export interface AddLinkProps {
  to: string;
  /** Страница, поверх которой откроется шит: после закрытия возвращаемся на неё. */
  state: { background: Location; kind?: TxKind };
}

/** Свойства для <Link {...useAddLink()}>: шит «Новая операция» открывается поверх текущей страницы. */
export function useAddLink(kind?: TxKind): AddLinkProps {
  const location = useLocation();
  return { to: ADD_PATH, state: kind ? { background: location, kind } : { background: location } };
}
