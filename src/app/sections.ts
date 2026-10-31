import type { IconName } from '../components/Icon';

/**
 * Единый реестр разделов: из него берут данные нижняя панель телефона, «Ещё», боковая панель ПК и e2e-помощники. У раздела ОДНО
 * название — оно же в меню, в заголовке страницы и в тестах. Файл без импортов с алиасами `@/`: его читает и Playwright.
 *
 * group — смысловая группа «Ещё» и боковой панели; bottomBar — раздел стоит в нижней панели телефона (в «Ещё» его нет);
 * side: false — в боковой панели ПК раздела нет (категории и импорт там лежат внутри «Настроек»).
 */
export type SectionGroup = 'main' | 'money' | 'planning' | 'tools' | 'app';

export interface Section {
  id: string;
  path: string;
  title: string;
  icon: IconName;
  group: SectionGroup;
  bottomBar?: boolean;
  side?: boolean;
}

export const SECTIONS: readonly Section[] = [
  { id: 'home', path: '/', title: 'Главная', icon: 'home', group: 'main', bottomBar: true },
  { id: 'transactions', path: '/transactions', title: 'Операции', icon: 'list', group: 'main', bottomBar: true },
  { id: 'analytics', path: '/analytics', title: 'Аналитика', icon: 'chart', group: 'main', bottomBar: true },
  { id: 'wallets', path: '/wallets', title: 'Кошельки', icon: 'wallet', group: 'money' },
  { id: 'debts', path: '/debts', title: 'Долги', icon: 'banknote', group: 'money' },
  { id: 'budgets', path: '/budgets', title: 'Бюджеты', icon: 'pie', group: 'planning' },
  { id: 'recurring', path: '/recurring', title: 'Регулярные платежи', icon: 'repeat', group: 'planning' },
  { id: 'trips', path: '/trips', title: 'Поездки', icon: 'plane', group: 'planning' },
  { id: 'shopping', path: '/shopping', title: 'Покупки', icon: 'cart', group: 'tools' },
  { id: 'products', path: '/products', title: 'Продукты', icon: 'food', group: 'tools' },
  { id: 'rates', path: '/rates', title: 'Курсы валют', icon: 'transfer', group: 'tools' },
  { id: 'weather', path: '/weather', title: 'Погода', icon: 'cloud', group: 'tools' },
  { id: 'categories', path: '/settings/categories', title: 'Категории', icon: 'tag', group: 'app', side: false },
  { id: 'import', path: '/import', title: 'Импорт из Дзен-мани', icon: 'upload', group: 'app', side: false },
  { id: 'settings', path: '/settings', title: 'Настройки', icon: 'sliders', group: 'app' },
];

/** Заголовки групп в «Ещё» и в боковой панели; у основной группы заголовка нет. */
export const GROUP_TITLE: Record<SectionGroup, string> = {
  main: '',
  money: 'Деньги',
  planning: 'Планирование',
  tools: 'Инструменты',
  app: 'Приложение',
};

/** Порядок групп. */
export const GROUP_ORDER: readonly SectionGroup[] = ['main', 'money', 'planning', 'tools', 'app'];

export const MORE_PATH = '/more';
export const MORE_TITLE = 'Ещё';

/** Разделы в «Ещё»: всё, чего нет в нижней панели, по группам. */
export function moreGroups(): { group: SectionGroup; title: string; items: Section[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    title: GROUP_TITLE[group],
    items: SECTIONS.filter((s) => s.group === group && !s.bottomBar),
  })).filter((g) => g.items.length > 0);
}
