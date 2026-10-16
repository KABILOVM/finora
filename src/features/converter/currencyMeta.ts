import type { CurrencyCode } from '@/domain/types';

export interface CurrencyMeta {
  /** Код страны (ISO 3166) — имя файла флага в src/assets/flags. */
  country: string;
  name: string;
}

/**
 * Валюты конвертера: флаг и русское название. Флаги — flag-icons (MIT, см. src/assets/flags/LICENSE-flag-icons-MIT.txt),
 * вшиты в приложение (политика CSP не пускает картинки из сети, и без интернета они тоже работают).
 */
export const CURRENCY_META: Readonly<Record<string, CurrencyMeta>> = {
  TJS: { country: 'tj', name: 'Сомони' },
  USD: { country: 'us', name: 'Доллар США' },
  EUR: { country: 'eu', name: 'Евро' },
  RUB: { country: 'ru', name: 'Российский рубль' },
  KZT: { country: 'kz', name: 'Казахстанский тенге' },
  UZS: { country: 'uz', name: 'Узбекский сум' },
  KGS: { country: 'kg', name: 'Киргизский сом' },
  CNY: { country: 'cn', name: 'Китайский юань' },
  TRY: { country: 'tr', name: 'Турецкая лира' },
  AED: { country: 'ae', name: 'Дирхам ОАЭ' },
  GBP: { country: 'gb', name: 'Фунт стерлингов' },
  KRW: { country: 'kr', name: 'Южнокорейская вона' },
  JPY: { country: 'jp', name: 'Японская иена' },
  CHF: { country: 'ch', name: 'Швейцарский франк' },
  CAD: { country: 'ca', name: 'Канадский доллар' },
  AUD: { country: 'au', name: 'Австралийский доллар' },
  NZD: { country: 'nz', name: 'Новозеландский доллар' },
  INR: { country: 'in', name: 'Индийская рупия' },
  PKR: { country: 'pk', name: 'Пакистанская рупия' },
  AFN: { country: 'af', name: 'Афгани' },
  IRR: { country: 'ir', name: 'Иранский риал' },
  SAR: { country: 'sa', name: 'Саудовский риял' },
  QAR: { country: 'qa', name: 'Катарский риал' },
  KWD: { country: 'kw', name: 'Кувейтский динар' },
  EGP: { country: 'eg', name: 'Египетский фунт' },
  ILS: { country: 'il', name: 'Израильский шекель' },
  UAH: { country: 'ua', name: 'Украинская гривна' },
  BYN: { country: 'by', name: 'Белорусский рубль' },
  AZN: { country: 'az', name: 'Азербайджанский манат' },
  GEL: { country: 'ge', name: 'Грузинский лари' },
  AMD: { country: 'am', name: 'Армянский драм' },
  MDL: { country: 'md', name: 'Молдавский лей' },
  PLN: { country: 'pl', name: 'Польский злотый' },
  CZK: { country: 'cz', name: 'Чешская крона' },
  HUF: { country: 'hu', name: 'Венгерский форинт' },
  SEK: { country: 'se', name: 'Шведская крона' },
  NOK: { country: 'no', name: 'Норвежская крона' },
  DKK: { country: 'dk', name: 'Датская крона' },
  THB: { country: 'th', name: 'Тайский бат' },
  MYR: { country: 'my', name: 'Малайзийский ринггит' },
  SGD: { country: 'sg', name: 'Сингапурский доллар' },
  IDR: { country: 'id', name: 'Индонезийская рупия' },
  VND: { country: 'vn', name: 'Вьетнамский донг' },
  HKD: { country: 'hk', name: 'Гонконгский доллар' },
  BRL: { country: 'br', name: 'Бразильский реал' },
  ZAR: { country: 'za', name: 'Южноафриканский рэнд' },
};

/** Порядок «популярных» вверху списка. */
export const POPULAR_CURRENCIES: readonly CurrencyCode[] = ['TJS', 'USD', 'EUR', 'RUB', 'CNY', 'KZT', 'UZS', 'TRY', 'AED', 'KGS'];

export function currencyName(code: CurrencyCode): string {
  return CURRENCY_META[code]?.name ?? code;
}

export function isConverterCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCY_META, code);
}
