import { useLocation, type Location } from 'react-router-dom';
import { MORE_PATH, MORE_TITLE, SECTIONS, type Section, type SectionGroup } from '@/app/sections';
import type { IconName } from '@/components/Icon';
import type { TxKind } from '@/domain/types';

export interface NavItem {
  to: string;
  /** Единственное название раздела (src/app/sections.ts) — и в нижней панели, и в боковой. */
  label: string;
  icon: IconName;
  group: SectionGroup | 'more';
  /** Активен только при точном совпадении пути (для «/»). */
  end?: boolean;
  /** Пункт подсвечен и на этих разделах (и их вложенных адресах) в нижней панели; по умолчанию только на своём. */
  phoneActiveOn?: readonly string[];
  /** То же для боковой панели. */
  sideActiveOn?: readonly string[];
}

const toItem = (s: Section): NavItem => ({
  to: s.path,
  label: s.title,
  icon: s.icon,
  group: s.group,
  ...(s.path === '/' ? { end: true } : {}),
});

/** Разделы, которые на телефоне лежат за пунктом «Ещё»: там он остаётся подсвеченным (в том числе внутри «Настроек»). */
export const MORE_SECTIONS: readonly string[] = [MORE_PATH, ...SECTIONS.filter((s) => !s.bottomBar).map((s) => s.path)];

const MORE_ITEM: NavItem = { to: MORE_PATH, label: MORE_TITLE, icon: 'more', group: 'more', phoneActiveOn: MORE_SECTIONS };

/**
 * Нижняя панель телефона: разделы с bottomBar из реестра и «Ещё». «+» (добавить операцию) вставляется между вторым и третьим
 * пунктом, поэтому пунктов ровно четыре.
 */
export const PHONE_ITEMS: readonly NavItem[] = [...SECTIONS.filter((s) => s.bottomBar).map(toItem), MORE_ITEM];

/**
 * Боковая панель ПК: группы из реестра. Основная (без заголовка) сверху, потом «Деньги», «Планирование», «Инструменты»; «Настройки»
 * внизу под чертой. Пункта «Ещё» на ПК нет. Категории и импорт лежат внутри «Настроек» (там же подсвечиваются).
 */
export const SIDE_ITEMS: readonly NavItem[] = SECTIONS.filter((s) => s.side !== false).map((s) =>
  s.id === 'settings' ? { ...toItem(s), sideActiveOn: ['/settings', '/import'] } : toItem(s),
);

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
  state: { background: Location; kind?: TxKind; walletId?: string };
}

/** Свойства для <Link {...useAddLink()}>: шит «Новая операция» открывается поверх текущей страницы. */
export function useAddLink(kind?: TxKind, walletId?: string): AddLinkProps {
  const location = useLocation();
  return { to: ADD_PATH, state: { background: location, ...(kind ? { kind } : {}), ...(walletId ? { walletId } : {}) } };
}
