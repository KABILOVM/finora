import type { IconName } from '@/components/Icon';
import type { HomeSize } from '@/domain/homeLayout';

/**
 * Реестр блоков «Главной»: что можно показать, как блок называется в настройке и какой он ширины. Порядок в списке — стандартная
 * раскладка (так выглядит главная, пока человек её не настраивал). Новый блок добавляется сюда и в HomeBlocks.tsx; у тех, кто
 * главную уже настроил, он встанет рядом со своим соседом по этому списку (см. layout.ts).
 */
export type HomeBlockId =
  | 'hero'
  | 'templates'
  | 'attention'
  | 'missed'
  | 'weekly'
  | 'monthly'
  | 'save'
  | 'trip'
  | 'daily'
  | 'rates'
  | 'weather'
  | 'wallets'
  | 'budgets'
  | 'spending'
  | 'upcoming'
  | 'debts'
  | 'goals'
  | 'shopping'
  | 'shortcuts'
  | 'recent';

export type HomeBlockGroup = 'money' | 'plan' | 'tips' | 'tools';

export interface HomeBlock {
  id: HomeBlockId;
  title: string;
  /** Что в блоке — одной строкой для настройки. */
  hint: string;
  /** Когда блок виден, если он появляется не всегда: готовая фраза для настройки («Появляется в начале недели»). */
  when?: string;
  icon: IconName;
  /** Цвет плитки значка в настройке (#rrggbb). */
  color: string;
  group: HomeBlockGroup;
  /** Показан ли на стандартной главной. */
  on: boolean;
  /**
   * Бывает ли в половину ширины: 'always' — на любом экране (у блока есть узкий вид), 'wide' — только на экране от 560 px
   * (на телефоне остаётся во всю ширину), 'never' — всегда во всю ширину.
   */
  half: 'always' | 'wide' | 'never';
  /** Ширина на стандартной главной; не задана — во всю ширину. */
  size?: HomeSize;
}

export const HOME_BLOCKS: readonly HomeBlock[] = [
  { id: 'hero', title: 'Всего', hint: 'Все деньги, приход и расход за месяц', icon: 'wallet', color: '#7c3aed', group: 'money', on: true, half: 'never' },
  { id: 'templates', title: 'Шаблоны', hint: 'Готовые операции в одно касание', when: 'Появляется, когда есть шаблоны', icon: 'star', color: '#d97706', group: 'tools', on: true, half: 'never' },
  { id: 'attention', title: 'Требует внимания', hint: 'Просрочки, перерасход и нехватка денег', when: 'Появляется, только когда что-то горит', icon: 'alert', color: '#dc2626', group: 'tips', on: true, half: 'never' },
  { id: 'missed', title: 'Пропущенные дни', hint: 'Напомнит внести траты', when: 'Появляется после двух дней без записей', icon: 'calendar', color: '#0891b2', group: 'tips', on: true, half: 'never' },
  { id: 'weekly', title: 'Итоги недели', hint: 'Сколько ушло за прошлую неделю и на что', when: 'Появляется в начале недели', icon: 'chart', color: '#4f46e5', group: 'tips', on: true, half: 'wide' },
  { id: 'monthly', title: 'Итоги месяца', hint: 'Доходы, расходы и главные траты прошлого месяца', when: 'Появляется в первые дни месяца', icon: 'pie', color: '#9333ea', group: 'tips', on: true, half: 'never' },
  { id: 'save', title: 'Отложить остаток', hint: 'Предложит отложить, если месяц закрылся с плюсом', when: 'Появляется с 1-го по 7-е число', icon: 'safe', color: '#16a34a', group: 'tips', on: true, half: 'wide' },
  { id: 'trip', title: 'Поездка', hint: 'Сколько потрачено в поездке', when: 'Появляется, пока идёт поездка', icon: 'plane', color: '#0284c7', group: 'plan', on: true, half: 'wide' },
  { id: 'daily', title: 'Траты в день', hint: 'Сегодня по ежедневным категориям и запас месяца', when: 'Появляется, когда есть ежедневные категории', icon: 'fire', color: '#ea580c', group: 'plan', on: true, half: 'wide' },
  { id: 'rates', title: 'Курсы валют', hint: 'Доллар и рубль к основной валюте', icon: 'transfer', color: '#0d9488', group: 'tools', on: true, half: 'always', size: 'half' },
  { id: 'weather', title: 'Погода', hint: 'Сейчас в вашем городе и совет взять зонт', icon: 'cloud', color: '#0ea5e9', group: 'tools', on: true, half: 'always', size: 'half' },
  { id: 'wallets', title: 'Кошельки', hint: 'Остаток каждого кошелька', icon: 'card', color: '#2563eb', group: 'money', on: true, half: 'never' },
  { id: 'budgets', title: 'Можно тратить в день', hint: 'Сколько можно тратить и лимиты месяца', icon: 'target', color: '#db2777', group: 'plan', on: true, half: 'wide' },
  { id: 'spending', title: 'Расходы за месяц', hint: 'Сколько потрачено и на что больше всего', icon: 'expense', color: '#e11d48', group: 'money', on: false, half: 'always' },
  { id: 'upcoming', title: 'Ближайшие платежи', hint: 'Регулярные платежи на ближайшие дни', when: 'Появляется, когда есть платежи', icon: 'repeat', color: '#7c3aed', group: 'plan', on: true, half: 'wide' },
  { id: 'debts', title: 'Долги', hint: 'Сколько должны вам и сколько должны вы', icon: 'banknote', color: '#b45309', group: 'money', on: false, half: 'always' },
  { id: 'goals', title: 'Цели накопления', hint: 'Сколько уже накоплено на каждую цель', icon: 'invest', color: '#059669', group: 'plan', on: false, half: 'always' },
  { id: 'shopping', title: 'Покупки', hint: 'Что осталось купить по списку', icon: 'cart', color: '#65a30d', group: 'tools', on: false, half: 'always' },
  { id: 'shortcuts', title: 'Разделы', hint: 'Быстрые переходы: долги, бюджеты, покупки и другие', icon: 'more', color: '#64748b', group: 'tools', on: false, half: 'never' },
  { id: 'recent', title: 'Последние операции', hint: 'Всё за сегодня и вчера', icon: 'list', color: '#475569', group: 'money', on: true, half: 'never' },
];

export const HOME_GROUP_TITLE: Record<HomeBlockGroup, string> = {
  money: 'Деньги',
  plan: 'Планирование',
  tips: 'Подсказки',
  tools: 'Полезное',
};

export const HOME_GROUP_ORDER: readonly HomeBlockGroup[] = ['money', 'plan', 'tips', 'tools'];

const BY_ID = new Map<string, HomeBlock>(HOME_BLOCKS.map((b) => [b.id, b]));

export const homeBlock = (id: string): HomeBlock | undefined => BY_ID.get(id);
