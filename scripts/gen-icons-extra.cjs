/*
 * Дополнительные значки категорий и кошельков (семья, дети, коммунальные услуги, еда, транспорт, здоровье, покупки, отдых, работа…).
 * Основные значки (iconData.ts, их создаёт gen-icons.cjs) лежат в основном файле приложения; эти — отдельными ленивыми файлами по разделам
 * (src/components/iconExtra/icons-<раздел>.ts): раздел грузится, только когда на экране есть его значок. Тот же набор, что и у остальных значков
 * (Solar, 480 Design, CC BY 4.0, «bold duotone»), поэтому выглядят одинаково. Значение в поле icon — то же «i:имя».
 * Запуск (пакет нужен только для генерации, в зависимости проекта его нет):
 *   npm i --no-save @iconify-json/solar && node scripts/gen-icons-extra.cjs
 * Создаёт src/components/iconExtraData.ts (разделы выбора и названия значков, маленький) и src/components/iconExtra/icons-*.ts (разметка).
 * Как добавить значок: допишите строку [имя, название, имя в Solar] в нужный раздел SECTIONS (картинки Solar можно посмотреть на
 * icones.js.org/collection/solar, нужен вариант «bold duotone») и запустите скрипт. Имя — a-z и 0-9, до 20 символов («i:имя» влезает в поле icon).
 */
const fs = require('fs');
const solar = require('@iconify-json/solar/icons.json');

/** Значки из основного файла (iconData.ts), которые уже были в выборе: каждый обязан попасть в какой-то раздел. */
const OLD = [
  'cart', 'food', 'cup', 'donut', 'wine', 'bus', 'car', 'fuel', 'plane', 'scooter', 'home', 'sofa', 'bulb', 'washing', 'tool', 'key', 'bolt',
  'water', 'wifi', 'phone', 'laptop', 'heart', 'pills', 'hospital', 'gym', 'bag', 'shirt', 'scissors', 'paw', 'game', 'music', 'tv', 'video',
  'ball', 'party', 'book', 'diploma', 'gift', 'briefcase', 'salary', 'cash', 'card', 'safe', 'money', 'invest', 'debt', 'star', 'fire',
  'repeat', 'box', 'tag', 'sale', 'target', 'stars',
];

/** Значки основного файла, которых не было в выборе, хотя они там есть (рисунки интерфейса): годятся и для категорий, веса не прибавляют. */
const SYNC_EXTRA = ['wallet', 'chart', 'pie', 'calendar', 'mail', 'shield', 'moon', 'sun', 'user', 'trash'];

/*
 * Раздел: [id, название, [значки]]. Значок — строка (имя из основного файла, уже есть) или [имя, название, имя в Solar] (новый, ленивый).
 */
const SECTIONS = [
  ['family', 'Семья и дети', [
    ['family', 'Семья', 'users-group-two-rounded'], ['wife', 'Жена', 'women'], ['husband', 'Муж', 'men'], ['kids', 'Дети', 'body'],
    ['baby', 'Малыш', 'bottle'], ['toys', 'Игрушки', 'blocks'], ['school', 'Школа', 'backpack'], ['friends', 'Друзья', 'users-group-rounded'],
    ['couple', 'Любимые', 'user-heart-rounded'], ['wedding', 'Свадьба', 'hearts'], ['charity', 'Помощь', 'hand-heart'],
    'gift', 'party', 'paw', 'user',
  ]],
  ['home', 'Дом и коммунальные услуги', [
    'home', 'bolt', 'water', 'fire', 'bulb', 'wifi', 'phone', 'tv',
    ['heating', 'Отопление', 'temperature'], ['conditioner', 'Кондиционер', 'conditioner'], 'trash',
    ['cleaning', 'Уборка', 'broom'], 'washing', ['fridge', 'Бытовая техника', 'fridge'], ['socket', 'Электрика', 'socket'], ['bath', 'Ванная', 'bath'],
    ['bed', 'Спальня', 'bed'], 'sofa', ['window', 'Окна', 'window-frame'], ['garage', 'Гараж', 'garage'], ['paint', 'Покраска', 'paint-roller'],
    ['build', 'Стройка', 'sledgehammer'], ['toolbox', 'Инструменты', 'toolbox'], 'tool', 'key', ['apartment', 'Квартира', 'buildings-2'],
    ['smarthome', 'Умный дом', 'smart-home'],
  ]],
  ['food', 'Еда и напитки', [
    'cart', 'food', 'cup', 'donut', 'wine', ['takeaway', 'Кофе с собой', 'cup-paper'], ['lunch', 'Обед', 'plate'], ['tea', 'Чай', 'tea-cup'],
    ['bakery', 'Выпечка', 'rolling-pin'], ['cocktail', 'Коктейли', 'wineglass-triangle'], ['cooking', 'Готовка', 'ladle'],
  ]],
  ['transport', 'Транспорт и поездки', [
    'bus', 'car', 'fuel', 'plane', 'scooter', ['bike', 'Велосипед', 'bicycling'], ['tram', 'Электричка', 'tram'], ['kickscooter', 'Самокат', 'kick-scooter'],
    ['carservice', 'Автосервис', 'car-battery'], ['tires', 'Шины', 'wheel'], ['evcharge', 'Зарядка авто', 'electric-refueling'], ['road', 'Дорога', 'signpost'],
    ['trip', 'Поездка', 'suitcase'], ['passport', 'Паспорт и виза', 'passport'], ['place', 'Места', 'map-point'], ['delivery', 'Доставка', 'delivery'],
  ]],
  ['health', 'Здоровье и красота', [
    'heart', 'pills', 'hospital', 'gym', 'scissors', ['doctor', 'Врач', 'stethoscope'], ['vaccine', 'Прививки', 'syringe'], ['medkit', 'Аптечка', 'medical-kit'],
    ['vitamins', 'Витамины', 'jar-of-pills'], ['yoga', 'Йога', 'meditation'], ['run', 'Бег', 'running'], ['swim', 'Бассейн', 'swimming'],
    ['mask', 'Маски', 'facemask-circle'], ['perfume', 'Парфюм', 'perfume'], ['cosmetic', 'Косметика', 'cosmetic'], ['vanity', 'Красота', 'vanity'],
  ]],
  ['shop', 'Покупки и одежда', [
    'bag', 'shirt', ['dress', 'Платья', 'skirt'], ['hanger', 'Одежда', 'hanger'], ['glasses', 'Очки', 'glasses'], ['watch', 'Часы', 'watch-round'],
    ['shop', 'Магазин', 'shop'], ['price', 'Ценник', 'tag-price'], ['coupon', 'Купон', 'ticket-sale'], 'tag', 'sale', 'box',
  ]],
  ['fun', 'Отдых и увлечения', [
    'game', 'music', 'video', 'book', 'ball', ['camera', 'Фото', 'camera'], ['headphones', 'Наушники', 'headphones-round'], ['art', 'Рисование', 'palette'],
    ['basketball', 'Баскетбол', 'basketball'], ['tennis', 'Теннис', 'tennis'], ['volleyball', 'Волейбол', 'volleyball'], ['bowling', 'Боулинг', 'bowling'],
    ['skate', 'Скейт', 'skateboarding'], ['hiking', 'Походы', 'hiking'], ['golf', 'Гольф', 'golf'], ['telescope', 'Хобби', 'telescope'],
    ['nature', 'Природа', 'leaf'], ['picnic', 'Пикник', 'bonfire'], ['tickets', 'Билеты', 'ticket'], ['cinema', 'Кинотеатр', 'clapperboard'],
    ['park', 'Парк', 'ferris-wheel'], ['trophy', 'Кубок', 'cup-first'], ['medal', 'Награда', 'medal-star'], 'sun',
  ]],
  ['work', 'Работа, учёба, деньги', [
    'briefcase', 'salary', 'cash', 'card', 'safe', 'money', 'invest', 'debt', 'laptop', 'diploma', 'wallet', ['moneybag', 'Накопления', 'money-bag'],
    ['cardtransfer', 'Перевод', 'card-transfer'], ['euro', 'Евро', 'euro'], ['dollar', 'Доллар', 'dollar'], ['ruble', 'Рубль', 'ruble'],
    ['university', 'Университет', 'square-academic-cap'], ['notebook', 'Тетради', 'notebook'], ['library', 'Библиотека', 'library'],
    ['taxes', 'Налоги', 'calculator'], ['bills', 'Счета', 'bill-list'], ['document', 'Документы', 'document'], ['print', 'Печать', 'printer'],
    ['post', 'Почта', 'mailbox'], 'mail', ['law', 'Закон', 'scale'], ['business', 'Бизнес', 'rocket'], ['slides', 'Презентации', 'presentation-graph'],
    'chart', 'pie', 'shield',
  ]],
  ['misc', 'Разное', [
    'star', 'stars', 'repeat', 'target', ['religion', 'Религия', 'moon-stars'], 'moon', ['bell', 'Напоминание', 'bell'],
    ['world', 'Мир', 'earth'], ['time', 'Время', 'hourglass'], ['alarm', 'Будильник', 'alarm'], ['deal', 'Договорённость', 'hand-shake'],
    ['magic', 'Чудеса', 'magic-stick'], 'calendar',
  ]],
];

// ---- проверки ----
const iconData = fs.readFileSync('src/components/iconData.ts', 'utf8');
const hasSync = (name) => new RegExp(`^  "${name}": `, 'm').test(iconData);
const seenNew = new Set();
const seenSync = new Set();
const seenAny = new Map();
for (const [sid, , items] of SECTIONS) {
  for (const item of items) {
    const name = typeof item === 'string' ? item : item[0];
    if (seenAny.has(name)) throw new Error(`значок «${name}» и в разделе ${seenAny.get(name)}, и в ${sid}: в сетке он повторился бы`);
    seenAny.set(name, sid);
    if (typeof item === 'string') {
      if (!hasSync(item)) throw new Error(`«${item}» нет в iconData.ts`);
      seenSync.add(item);
    } else {
      if (!/^[a-z0-9]{1,20}$/.test(name)) throw new Error(`имя «${name}»: только a-z и 0-9, до 20 символов`);
      if (hasSync(name)) throw new Error(`«${name}» уже есть в iconData.ts: возьмите готовый`);
      if (seenNew.has(name)) throw new Error(`«${name}» уже есть в другом разделе`);
      if (!solar.icons[`${item[2]}-bold-duotone`]) throw new Error(`нет иконки Solar «${item[2]}»`);
      seenNew.add(name);
    }
  }
}
for (const o of OLD) if (!seenSync.has(o)) throw new Error(`прежний значок «${o}» не попал ни в один раздел: он пропал бы из выбора`);
for (const s of SYNC_EXTRA) if (!seenSync.has(s)) throw new Error(`значок «${s}» из SYNC_EXTRA не попал ни в один раздел`);

// ---- вывод ----
const extra = [];
fs.rmSync('src/components/iconExtra', { recursive: true, force: true });
fs.mkdirSync('src/components/iconExtra');
let total = 0;
for (const [sid, , items] of SECTIONS) {
  const own = {};
  for (const item of items) {
    if (typeof item === 'string') continue;
    own[item[0]] = solar.icons[`${item[2]}-bold-duotone`].body;
    extra.push({ name: item[0], label: item[1], section: sid });
  }
  if (Object.keys(own).length === 0) continue;
  const text =
`/* Файл создан скриптом scripts/gen-icons-extra.cjs — руками не править.
 * Значки: Solar (480 Design, CC BY 4.0), «bold duotone». Рисуются одним цветом (currentColor). */
export const ICONS: Readonly<Record<string, string>> = {
${Object.entries(own).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
};
`;
  fs.writeFileSync(`src/components/iconExtra/icons-${sid}.ts`, text);
  total += text.length;
  console.log(`  ${sid}: ${Object.keys(own).length} новых, ${(text.length / 1000).toFixed(1)} КБ`);
}

fs.writeFileSync('src/components/iconExtraData.ts',
`/* Файл создан скриптом scripts/gen-icons-extra.cjs — руками не править.
 * Разделы выбора значка и названия дополнительных значков. Сама разметка новых значков лежит в iconExtra/icons-<раздел>.ts и грузится лениво. */
export interface GlyphSection {
  id: string;
  label: string;
  /** Имена значков в порядке показа: и из основного файла (iconData.ts), и дополнительные. */
  names: readonly string[];
}

export interface ExtraIcon {
  name: string;
  label: string;
  /** Раздел, он же файл с разметкой. */
  section: string;
}

export const GLYPH_SECTIONS: readonly GlyphSection[] = [
${SECTIONS.map(([id, label, items]) => `  ${JSON.stringify({ id, label, names: items.map((i) => (typeof i === 'string' ? i : i[0])) })},`).join('\n')}
];

export const EXTRA_ICONS: readonly ExtraIcon[] = [
${extra.map((e) => `  ${JSON.stringify(e)},`).join('\n')}
];
`);
console.log(`${extra.length} новых значков, ${(total / 1000).toFixed(0)} КБ разметки; всего в выборе ${new Set(SECTIONS.flatMap(([, , items]) => items.map((i) => (typeof i === 'string' ? i : i[0])))).size}`);
