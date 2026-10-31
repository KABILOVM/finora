import type { IconName } from './Icon';
import { extraIconByName } from './glyphExtras';
import { DUO } from './iconData';
import { GLYPH_SECTIONS } from './iconExtraData';
import { serviceById } from './services';

/**
 * Значок категории или кошелька (поле icon) бывает четырёх видов:
 *   «i:cup»  — встроенная иконка (основная — iconData.ts, дополнительная — ленивые файлы, см. glyphExtras.ts);
 *   «b:alif» — знак банка;  «s:netflix» — логотип сервиса (см. services.ts);
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
  /** Дополнительный значок: разметка грузится лениво. */
  | { kind: 'extra'; name: string }
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
    // Object.hasOwn: «i:constructor» и подобные служебные имена объектов значками не считаются
    if (Object.hasOwn(DUO, name)) return { kind: 'icon', name: name as IconName };
    if (extraIconByName(name)) return { kind: 'extra', name };
  }
  const mapped = EMOJI_TO_GLYPH[stripVariation(value)];
  if (mapped) return { kind: 'icon', name: mapped };
  return { kind: 'text', text: value };
}

/** Разделы выбора значка (порядок — как в окне): основные и дополнительные значки вместе, каждый один раз. */
export { GLYPH_SECTIONS };

/** Все значки, которые можно выбрать для категории или кошелька (порядок — по разделам). */
export const GLYPH_CHOICES: readonly string[] = GLYPH_SECTIONS.flatMap((section) => section.names);

/** Значение поля icon для встроенной иконки. */
export const glyphValue = (name: string): string => `i:${name}`;

/** Названия значков для скринридера и подсказок. */
export const GLYPH_LABELS: Partial<Record<IconName, string>> = {
  cart: 'Корзина', food: 'Еда', cup: 'Кофе', donut: 'Сладкое', wine: 'Напитки', bus: 'Автобус', car: 'Машина', fuel: 'Бензин',
  plane: 'Самолёт', scooter: 'Скутер', home: 'Дом', sofa: 'Мебель', bulb: 'Свет', washing: 'Стирка', tool: 'Ремонт', key: 'Ключ',
  bolt: 'Электричество', water: 'Вода', wifi: 'Интернет', phone: 'Телефон', laptop: 'Ноутбук', heart: 'Здоровье',
  pills: 'Лекарства', hospital: 'Больница', gym: 'Спорт', bag: 'Покупки', shirt: 'Одежда', scissors: 'Красота', paw: 'Питомцы',
  game: 'Игры', music: 'Музыка', tv: 'Телевизор', video: 'Кино', ball: 'Футбол', party: 'Праздник', book: 'Книги',
  diploma: 'Учёба', gift: 'Подарок', briefcase: 'Работа', salary: 'Зарплата', cash: 'Наличные', card: 'Карта', safe: 'Сейф',
  money: 'Деньги', invest: 'Рост', debt: 'Долги', star: 'Звезда', fire: 'Газ и огонь', repeat: 'Повтор', box: 'Коробка',
  tag: 'Метка', sale: 'Скидка', target: 'Цель', stars: 'Звёзды',
  wallet: 'Кошелёк', chart: 'График', pie: 'Диаграмма', calendar: 'Календарь', mail: 'Письмо', shield: 'Страховка', moon: 'Луна', sun: 'Солнце',
  user: 'Человек', trash: 'Вывоз мусора',
};

/** Название значка для скринридера и подсказок (основного или дополнительного). */
export const glyphLabel = (name: string): string => GLYPH_LABELS[name as IconName] ?? extraIconByName(name)?.label ?? name;
