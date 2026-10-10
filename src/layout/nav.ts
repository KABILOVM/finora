import { useLocation, type Location } from 'react-router-dom';
import type { IconName } from '@/components/Icon';

export interface NavItem {
  to: string;
  /** Подпись в нижней панели телефона. */
  label: string;
  /** Подпись в боковой панели ПК. */
  sideLabel: string;
  icon: IconName;
  /** Активен только при точном совпадении пути (для «/»). */
  end?: boolean;
}

/** Пункты меню. На телефоне «+» (добавить операцию) вставляется между вторым и третьим пунктом. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Главная', sideLabel: 'Главная', icon: 'home', end: true },
  { to: '/transactions', label: 'Операции', sideLabel: 'Операции', icon: 'list' },
  { to: '/wallets', label: 'Кошельки', sideLabel: 'Кошельки', icon: 'wallet' },
  { to: '/settings', label: 'Ещё', sideLabel: 'Настройки', icon: 'more' },
];

export const ADD_PATH = '/add';
export const ADD_LABEL = 'Добавить операцию';

export interface AddLinkProps {
  to: string;
  /** Страница, поверх которой откроется шит: после закрытия возвращаемся на неё. */
  state: { background: Location };
}

/** Свойства для <Link {...useAddLink()}>: шит «Новая операция» открывается поверх текущей страницы. */
export function useAddLink(): AddLinkProps {
  const location = useLocation();
  return { to: ADD_PATH, state: { background: location } };
}
