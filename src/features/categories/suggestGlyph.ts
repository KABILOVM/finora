import { glyphValue } from '@/components/glyphs';
import { findServiceByName, serviceValue } from '@/components/services';
import { COLOR_CHOICES } from '@/features/wallets/walletUi';

/** Слова из названия → значок. Проверяется по началу слова (корни), порядок важен: что выше, то приоритетнее. */
const KEYWORDS: readonly (readonly [string, string])[] = [
  // семья и дети (раньше общих слов: «Детская одежда» — это дети, а не одежда)
  ['жена', 'wife'], ['жену', 'wife'], ['жены', 'wife'], ['жене', 'wife'], ['женой', 'wife'], ['супруг', 'couple'],
  ['дети', 'kids'], ['детей', 'kids'], ['детям', 'kids'], ['детск', 'kids'], ['ребен', 'kids'], ['ребён', 'kids'], ['сын', 'kids'], ['доч', 'kids'], ['внук', 'kids'],
  ['малыш', 'baby'], ['памперс', 'baby'], ['подгузн', 'baby'], ['игрушк', 'toys'], ['школ', 'school'], ['семь', 'family'], ['родител', 'family'],
  ['мама', 'family'], ['папа', 'family'], ['свадьб', 'wedding'], ['друзь', 'friends'],
  // дом и коммунальные услуги
  ['отоплен', 'heating'], ['мусор', 'trash'], ['уборк', 'cleaning'], ['клининг', 'cleaning'], ['гараж', 'garage'], ['окн', 'window'],
  ['кондиционер', 'conditioner'], ['холодильник', 'fridge'],
  // еда, транспорт, здоровье, покупки, отдых, работа
  ['чай', 'tea'], ['выпечк', 'bakery'], ['пекарн', 'bakery'], ['хлеб', 'bakery'], ['коктейл', 'cocktail'],
  ['велосипед', 'bike'], ['самокат', 'kickscooter'], ['автосервис', 'carservice'], ['шиномонтаж', 'tires'], ['паспорт', 'passport'], ['доставк', 'delivery'],
  ['прививк', 'vaccine'], ['витамин', 'vitamins'], ['аптечк', 'medkit'], ['йог', 'yoga'], ['бассейн', 'swim'], ['парфюм', 'perfume'], ['космети', 'cosmetic'],
  ['маникюр', 'cosmetic'], ['очки', 'glasses'], ['фото', 'camera'], ['рисован', 'art'], ['билет', 'tickets'],
  ['почт', 'post'], ['документ', 'document'], ['юрист', 'law'], ['закон', 'law'], ['бизнес', 'business'], ['универ', 'university'], ['тетрад', 'notebook'],
  ['библиотек', 'library'], ['евро', 'euro'], ['доллар', 'dollar'], ['рубл', 'ruble'],
  ['религ', 'religion'], ['мечет', 'religion'], ['рамадан', 'religion'], ['рамазан', 'religion'], ['хадж', 'religion'],
  ['кофе', 'cup'], ['кафе', 'cup'], ['рестор', 'food'], ['еда', 'food'], ['обед', 'food'], ['пицц', 'food'], ['фастфуд', 'food'],
  ['продукт', 'cart'], ['магазин', 'cart'], ['базар', 'cart'], ['сладк', 'donut'], ['алкогол', 'wine'],
  ['такси', 'car'], ['машин', 'car'], ['авто', 'car'], ['бензин', 'fuel'], ['заправ', 'fuel'], ['транспорт', 'bus'], ['проезд', 'bus'],
  ['самол', 'plane'], ['авиа', 'plane'], ['путешеств', 'plane'], ['отпуск', 'plane'],
  ['аренд', 'home'], ['жиль', 'home'], ['квартир', 'home'], ['дом', 'home'], ['мебел', 'sofa'], ['ремонт', 'tool'],
  ['свет', 'bulb'], ['электр', 'bolt'], ['вода', 'water'], ['газ', 'fire'], ['коммунал', 'bulb'],
  ['интернет', 'wifi'], ['связ', 'phone'], ['телефон', 'phone'], ['мобил', 'phone'],
  ['здоров', 'heart'], ['лекарств', 'pills'], ['аптек', 'pills'], ['врач', 'hospital'], ['больниц', 'hospital'], ['стоматолог', 'hospital'],
  ['спорт', 'gym'], ['зал', 'gym'], ['фитнес', 'gym'],
  ['одежд', 'shirt'], ['обув', 'shirt'], ['покупк', 'bag'], ['красот', 'scissors'], ['парикмах', 'scissors'],
  ['питомц', 'paw'], ['животн', 'paw'], ['кошк', 'paw'], ['собак', 'paw'],
  ['игр', 'game'], ['музык', 'music'], ['кино', 'video'], ['подписк', 'repeat'], ['развлеч', 'party'], ['праздник', 'party'],
  ['книг', 'book'], ['учёб', 'diploma'], ['учеб', 'diploma'], ['образован', 'diploma'], ['курс', 'diploma'],
  ['подар', 'gift'], ['благотвор', 'heart'], ['садака', 'stars'], ['закят', 'stars'],
  ['зарплат', 'salary'], ['работ', 'briefcase'], ['фриланс', 'laptop'], ['бонус', 'star'], ['премия', 'star'],
  ['инвест', 'invest'], ['процент', 'invest'], ['дивиденд', 'invest'], ['долг', 'debt'], ['кредит', 'card'], ['налог', 'safe'],
];

/** Значок по названию («Кофе» → чашка, «Netflix» → логотип Netflix); если ничего не подошло — универсальная метка. */
export function suggestGlyph(name: string): string {
  // название сервиса точнее общего слова: «Подписка Netflix» — это Netflix, а не просто «повтор»
  const service = findServiceByName(name);
  if (service) return serviceValue(service.id);
  const n = name.toLocaleLowerCase('ru');
  const hit = KEYWORDS.find(([root]) => n.split(/[^\p{L}]+/u).some((w) => w.startsWith(root)));
  return glyphValue(hit ? hit[1] : 'tag');
}

/** Цвет по порядку: новые категории получают разные цвета подряд. */
export function suggestColor(index: number): string {
  return COLOR_CHOICES[index % COLOR_CHOICES.length]?.value ?? '#16a34a';
}
