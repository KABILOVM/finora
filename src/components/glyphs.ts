import type { IconName } from './Icon';
import { DUO } from './iconData';
import { serviceById } from './services';

/**
 * Значок категории или кошелька (поле icon) бывает четырёх видов:
 *   «i:cup»  — встроенная иконка;  «b:alif» — знак банка;  «s:netflix» — логотип сервиса (см. services.ts);
 *   эмодзи — старые записи и то, что ввели раньше.
 * Для известных эмодзи ниже подбирается иконка (данные не меняются, подмена только при показе); неизвестные остаются эмодзи.
 */
const EMOJI_TO_GLYPH: Record<string, IconName> = {
  '🛒': 'cart', '🍔': 'food', '☕': 'cup', '🍽': 'food', '🥩': 'food', '🍞': 'food', '🍎': 'food', '🥤': 'cup',
  '🏠': 'home', '💡': 'bulb', '🔧': 'tool', '🛋': 'sofa', '🧴': 'water', '🧺': 'washing', '📱': 'phone', '💻': 'laptop',
  '🚌': 'bus', '🚕': 'car', '🚗': 'car', '⛽': 'fuel', '✈': 'plane', '🚆': 'bus', '🛵': 'scooter', '🅿': 'car',
  '💊': 'pills', '🏥': 'hospital', '🦷': 'heart', '💇': 'scissors', '👕': 'shirt', '👟': 'shirt', '🎓': 'diploma', '📚': 'book',
  '🎬': 'video', '🎮': 'game', '🎁': 'gift', '🎉': 'party', '🏖': 'party', '⚽': 'ball', '🐾': 'paw', '👶': 'heart',
  '💼': 'briefcase', '💰': 'money', '💵': 'cash', '💳': 'card', '🏦': 'safe', '📈': 'invest', '🧾': 'list', '🪙': 'money',
  '🤝': 'debt', '🕌': 'stars', '⭐': 'star', '❤': 'heart', '🔒': 'lock', '💸': 'money', '❓': 'question', '📦': 'box',
  '🛍': 'bag', '🔁': 'repeat', '🧰': 'tool', '🎯': 'target', '😀': 'star', '📅': 'calendar', '👛': 'wallet',
  '➖': 'expense', '➕': 'income', '🏷': 'tag',
};

export type GlyphKind =
  | { kind: 'icon'; name: IconName }
  | { kind: 'bank'; id: string }
  | { kind: 'service'; id: string }
  | { kind: 'text'; text: string };

const stripVariation = (s: string): string => s.replace(/️/g, '');

/** Что нарисовать для значения поля icon. */
export function resolveGlyph(value: string): GlyphKind {
  if (value.startsWith('b:')) return { kind: 'bank', id: value.slice(2) };
  if (value.startsWith('s:')) {
    const id = value.slice(2);
    if (serviceById(id)) return { kind: 'service', id };
    // сервис, которого нет в этой версии (запись с другого устройства): вместо «s:abc» показываем первую букву
    return { kind: 'text', text: id.slice(0, 1).toLocaleUpperCase('ru') || '?' };
  }
  if (value.startsWith('i:')) {
    const name = value.slice(2);
    if (name in DUO) return { kind: 'icon', name: name as IconName };
  }
  const mapped = EMOJI_TO_GLYPH[stripVariation(value)];
  if (mapped) return { kind: 'icon', name: mapped };
  return { kind: 'text', text: value };
}

/** Иконки, которые можно выбрать для категории или кошелька (порядок — как в сетке выбора). */
export const GLYPH_CHOICES: readonly IconName[] = [
  'cart', 'food', 'cup', 'donut', 'wine', 'bus', 'car', 'fuel', 'plane', 'scooter',
  'home', 'sofa', 'bulb', 'washing', 'tool', 'key', 'bolt', 'water', 'wifi', 'phone',
  'laptop', 'heart', 'pills', 'hospital', 'gym', 'bag', 'shirt', 'scissors', 'paw', 'game',
  'music', 'tv', 'video', 'ball', 'party', 'book', 'diploma', 'gift', 'briefcase', 'salary',
  'cash', 'card', 'safe', 'money', 'invest', 'debt', 'star', 'fire', 'repeat', 'box',
  'tag', 'sale', 'target', 'stars',
];

/** Значение поля icon для встроенной иконки. */
export const glyphValue = (name: IconName): string => `i:${name}`;

/** Названия значков для скринридера и подсказок. */
export const GLYPH_LABELS: Partial<Record<IconName, string>> = {
  cart: 'Корзина', food: 'Еда', cup: 'Кофе', donut: 'Сладкое', wine: 'Напитки', bus: 'Автобус', car: 'Машина', fuel: 'Бензин',
  plane: 'Самолёт', scooter: 'Скутер', home: 'Дом', sofa: 'Мебель', bulb: 'Свет', washing: 'Стирка', tool: 'Ремонт', key: 'Ключ',
  bolt: 'Электричество', water: 'Вода', wifi: 'Интернет', phone: 'Телефон', laptop: 'Ноутбук', heart: 'Здоровье',
  pills: 'Лекарства', hospital: 'Больница', gym: 'Спорт', bag: 'Покупки', shirt: 'Одежда', scissors: 'Красота', paw: 'Питомцы',
  game: 'Игры', music: 'Музыка', tv: 'Телевизор', video: 'Кино', ball: 'Футбол', party: 'Праздник', book: 'Книги',
  diploma: 'Учёба', gift: 'Подарок', briefcase: 'Работа', salary: 'Зарплата', cash: 'Наличные', card: 'Карта', safe: 'Сейф',
  money: 'Деньги', invest: 'Рост', debt: 'Долги', star: 'Звезда', fire: 'Огонь', repeat: 'Повтор', box: 'Коробка',
  tag: 'Метка', sale: 'Скидка', target: 'Цель', stars: 'Звёзды',
};
