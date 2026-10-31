/*
 * Генератор логотипов сервисов (Netflix, Spotify, Claude, PayPal…) для значков категорий и кошельков. Работают офлайн, без CDN.
 * Создаёт:
 *   src/components/serviceData.ts          — каталог (id, название, группа, цвет плитки): маленький, лежит в основном файле;
 *   src/components/serviceLogos/logos-<группа>.ts — пути логотипов по группам: тяжёлые, каждая группа грузится отдельным ленивым
 *                                            файлом и только когда на экране есть её сервис (см. src/components/services.ts).
 * Источники (все CC0 — без обязательной атрибуции):
 *   Simple Icons  (simple-icons, CC0)        — основной набор, у каждого логотипа есть фирменный цвет;
 *   CoreUI Brands (@iconify-json/cib, CC0)   — то, что владельцы убрали из Simple Icons: Microsoft, Adobe, Amazon, Canva, LinkedIn, Slack, Xbox…;
 *   SVG Logos     (@iconify-json/logos, CC0) — OpenAI.
 * Названия и логотипы — товарные знаки их владельцев; в приложении они только помогают узнать сервис (как значки банков).
 * Запуск (пакеты нужны только для генерации, в зависимости проекта их нет):
 *   npm i --no-save simple-icons @iconify-json/cib @iconify-json/logos && node scripts/gen-services.cjs
 * Чтобы добавить сервис: допишите строку в SERVICES и запустите скрипт. id — до 30 символов (в поле icon значение «s:id» не длиннее 32).
 */
const fs = require('fs');
const si = require('simple-icons');
const cib = require('@iconify-json/cib/icons.json');
const logos = require('@iconify-json/logos/icons.json');

// Группы — в том порядке, в каком они показаны в выборе значка.
const GROUPS = [
  ['media', 'Видео и музыка'],
  ['work', 'ИИ и работа'],
  ['cloud', 'Облако и безопасность'],
  ['pay', 'Платежи и крипта'],
  ['social', 'Соцсети и связь'],
  ['games', 'Игры и приложения'],
  ['shop', 'Покупки и поездки'],
];

/*
 * [id, название, группа, источник, имя в источнике, слова для подсказки значка по названию категории, настройки]
 * Слова — в нижнем регистре, целым словом («нетфликс»); id и название ищутся сами. Настройки: color — цвет плитки (нужен не из Simple Icons),
 * dark — принудительно тёмный (true) или белый (false) знак вместо автоподбора по яркости цвета.
 */
const SERVICES = [
  // Видео и музыка
  ['netflix', 'Netflix', 'media', 'si', 'netflix', ['нетфликс']],
  ['youtube', 'YouTube', 'media', 'si', 'youtube', ['ютуб']],
  ['youtubemusic', 'YouTube Music', 'media', 'si', 'youtubemusic'],
  ['spotify', 'Spotify', 'media', 'si', 'spotify', ['спотифай']],
  ['applemusic', 'Apple Music', 'media', 'si', 'applemusic'],
  ['appletv', 'Apple TV', 'media', 'si', 'appletv'],
  ['hbomax', 'HBO Max', 'media', 'si', 'hbomax', ['hbo']],
  ['twitch', 'Twitch', 'media', 'si', 'twitch'],
  ['crunchyroll', 'Crunchyroll', 'media', 'si', 'crunchyroll'],
  ['kinopoisk', 'Кинопоиск', 'media', 'si', 'kinopoisk', ['kinopoisk']],
  ['soundcloud', 'SoundCloud', 'media', 'si', 'soundcloud'],
  ['audible', 'Audible', 'media', 'si', 'audible'],
  ['patreon', 'Patreon', 'media', 'si', 'patreon', ['патреон']],
  // ИИ и работа
  ['claude', 'Claude', 'work', 'si', 'claude', ['клод']],
  ['openai', 'ChatGPT', 'work', 'logos', 'openai-icon', ['chatgpt', 'чатгпт', 'openai'], { color: '#10a37f' }],
  ['gemini', 'Gemini', 'work', 'si', 'googlegemini', ['гемини']],
  ['perplexity', 'Perplexity', 'work', 'si', 'perplexity'],
  ['deepseek', 'DeepSeek', 'work', 'si', 'deepseek'],
  ['github', 'GitHub', 'work', 'si', 'github', ['гитхаб']],
  ['notion', 'Notion', 'work', 'si', 'notion'],
  ['figma', 'Figma', 'work', 'si', 'figma'],
  ['canva', 'Canva', 'work', 'cib', 'canva', [], { color: '#00c4cc' }],
  ['adobe', 'Adobe', 'work', 'cib', 'adobe', [], { color: '#fa0f00' }],
  ['zoom', 'Zoom', 'work', 'si', 'zoom', ['зум']],
  ['slack', 'Slack', 'work', 'cib', 'slack', [], { color: '#4a154b' }],
  ['grammarly', 'Grammarly', 'work', 'si', 'grammarly'],
  ['duolingo', 'Duolingo', 'work', 'si', 'duolingo', ['дуолинго'], { dark: false }],
  // Облако и безопасность
  ['google', 'Google', 'cloud', 'si', 'google', ['гугл']],
  ['googledrive', 'Google Drive', 'cloud', 'si', 'googledrive'],
  ['googlecloud', 'Google Cloud', 'cloud', 'si', 'googlecloud'],
  ['dropbox', 'Dropbox', 'cloud', 'si', 'dropbox', ['дропбокс']],
  ['icloud', 'iCloud', 'cloud', 'si', 'icloud', ['айклауд']],
  ['apple', 'Apple', 'cloud', 'si', 'apple', ['эппл', 'эпл']],
  ['microsoft', 'Microsoft', 'cloud', 'cib', 'microsoft', ['майкрософт', 'microsoft365'], { color: '#0078d4' }],
  ['aws', 'AWS', 'cloud', 'cib', 'amazon-aws', [], { color: '#232f3e' }],
  ['cloudflare', 'Cloudflare', 'cloud', 'si', 'cloudflare'],
  ['proton', 'Proton', 'cloud', 'si', 'proton'],
  ['nordvpn', 'NordVPN', 'cloud', 'si', 'nordvpn'],
  ['expressvpn', 'ExpressVPN', 'cloud', 'si', 'expressvpn'],
  ['onepassword', '1Password', 'cloud', 'si', '1password'],
  ['bitwarden', 'Bitwarden', 'cloud', 'si', 'bitwarden'],
  // Платежи и крипта
  ['paypal', 'PayPal', 'pay', 'si', 'paypal', ['пейпал']],
  ['visa', 'Visa', 'pay', 'si', 'visa'],
  ['mastercard', 'Mastercard', 'pay', 'si', 'mastercard', ['мастеркард']],
  ['amex', 'American Express', 'pay', 'si', 'americanexpress', ['amex']],
  ['stripe', 'Stripe', 'pay', 'si', 'stripe'],
  ['wise', 'Wise', 'pay', 'si', 'wise'],
  ['revolut', 'Revolut', 'pay', 'si', 'revolut'],
  ['payoneer', 'Payoneer', 'pay', 'si', 'payoneer', ['пайонир']],
  ['westernunion', 'Western Union', 'pay', 'si', 'westernunion'],
  ['applepay', 'Apple Pay', 'pay', 'si', 'applepay'],
  ['googlepay', 'Google Pay', 'pay', 'si', 'googlepay'],
  ['samsungpay', 'Samsung Pay', 'pay', 'si', 'samsungpay'],
  ['alipay', 'Alipay', 'pay', 'si', 'alipay'],
  ['webmoney', 'WebMoney', 'pay', 'si', 'webmoney', ['вебмани']],
  ['qiwi', 'QIWI', 'pay', 'si', 'qiwi'],
  ['binance', 'Binance', 'pay', 'si', 'binance', ['бинанс']],
  ['bitcoin', 'Bitcoin', 'pay', 'si', 'bitcoin', ['биткоин', 'btc']],
  ['ethereum', 'Ethereum', 'pay', 'si', 'ethereum', ['eth']],
  ['tether', 'Tether', 'pay', 'si', 'tether', ['usdt']],
  ['ton', 'TON', 'pay', 'si', 'ton'],
  ['coinbase', 'Coinbase', 'pay', 'si', 'coinbase'],
  // Соцсети и связь
  ['telegram', 'Telegram', 'social', 'si', 'telegram', ['телеграм', 'телега']],
  ['whatsapp', 'WhatsApp', 'social', 'si', 'whatsapp', ['ватсап', 'вотсап'], { dark: false }],
  ['instagram', 'Instagram', 'social', 'si', 'instagram', ['инстаграм', 'инста']],
  ['facebook', 'Facebook', 'social', 'si', 'facebook', ['фейсбук']],
  ['tiktok', 'TikTok', 'social', 'si', 'tiktok', ['тикток']],
  ['x', 'X (Twitter)', 'social', 'si', 'x', ['twitter', 'твиттер']],
  ['vk', 'VK', 'social', 'si', 'vk', ['вк', 'вконтакте']],
  ['discord', 'Discord', 'social', 'si', 'discord', ['дискорд']],
  ['snapchat', 'Snapchat', 'social', 'si', 'snapchat'],
  ['linkedin', 'LinkedIn', 'social', 'cib', 'linkedin', [], { color: '#0a66c2' }],
  ['viber', 'Viber', 'social', 'si', 'viber', ['вайбер']],
  ['reddit', 'Reddit', 'social', 'si', 'reddit'],
  ['skype', 'Skype', 'social', 'cib', 'skype', ['скайп'], { color: '#00aff0' }],
  // Игры и приложения
  ['googleplay', 'Google Play', 'games', 'si', 'googleplay'],
  ['appstore', 'App Store', 'games', 'si', 'appstore'],
  ['steam', 'Steam', 'games', 'si', 'steam', ['стим']],
  ['playstation', 'PlayStation', 'games', 'si', 'playstation', ['плейстейшн']],
  ['xbox', 'Xbox', 'games', 'cib', 'xbox', [], { color: '#107c10' }],
  ['nintendo', 'Nintendo', 'games', 'cib', 'nintendo', [], { color: '#e60012' }],
  ['epicgames', 'Epic Games', 'games', 'si', 'epicgames'],
  ['roblox', 'Roblox', 'games', 'si', 'roblox', ['роблокс']],
  // Покупки и поездки
  ['aliexpress', 'AliExpress', 'shop', 'si', 'aliexpress', ['алиэкспресс', 'алиекспресс']],
  ['ebay', 'eBay', 'shop', 'si', 'ebay'],
  ['amazon', 'Amazon', 'shop', 'cib', 'amazon', ['амазон'], { color: '#ff9900', dark: true }],
  ['uber', 'Uber', 'shop', 'si', 'uber', ['убер']],
  ['glovo', 'Glovo', 'shop', 'si', 'glovo', ['глово']],
  ['airbnb', 'Airbnb', 'shop', 'si', 'airbnb'],
  ['booking', 'Booking.com', 'shop', 'si', 'bookingdotcom', ['букинг', 'booking']],
  ['yandex', 'Яндекс', 'shop', 'cib', 'yandex', ['yandex', 'яндекс'], { color: '#fc3f1d' }],
];

const luminance = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const bySlug = new Map(Object.values(si).map((i) => [i.slug, i]));
const meta = [];
const logoMap = {};
const seen = new Set();

for (const [id, name, group, source, key, aliases = [], opts = {}] of SERVICES) {
  if (!/^[a-z0-9]{1,30}$/.test(id)) throw new Error(`id «${id}»: только a-z и 0-9, до 30 символов`);
  if (seen.has(id)) throw new Error(`повтор id «${id}»`);
  seen.add(id);
  if (!GROUPS.some(([g]) => g === group)) throw new Error(`${id}: нет группы «${group}»`);

  let viewBox;
  let d;
  let color = opts.color;
  if (source === 'si') {
    const icon = bySlug.get(key);
    if (!icon) throw new Error(`${id}: в Simple Icons нет «${key}»`);
    viewBox = '0 0 24 24';
    d = icon.path;
    color = color ?? `#${icon.hex.toLowerCase()}`;
  } else {
    const set = source === 'cib' ? cib : logos;
    const icon = set.icons[key];
    if (!icon) throw new Error(`${id}: в наборе ${source} нет «${key}»`);
    const paths = icon.body.match(/<path\b[^>]*>/g) ?? [];
    // один путь без своих цветов: рисуем его одним цветом (знак на плитке фирменного цвета)
    if (paths.length !== 1 || icon.body.replace(paths[0], '').trim() !== '') throw new Error(`${id}: ожидался один путь, разметка: ${icon.body.slice(0, 120)}`);
    const m = /\bd="([^"]+)"/.exec(paths[0]);
    if (!m) throw new Error(`${id}: у пути нет d`);
    d = m[1];
    viewBox = `0 0 ${icon.width ?? set.width ?? 16} ${icon.height ?? set.height ?? 16}`;
    if (!color) throw new Error(`${id}: для источника ${source} нужен color`);
  }
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error(`${id}: цвет «${color}»`);
  const lum = luminance(color);
  const dark = opts.dark ?? lum > 0.45;
  meta.push({ id, name, group, color, ...(dark ? { dark: true } : {}), ...(aliases.length ? { keys: aliases } : {}) });
  logoMap[id] = [viewBox, d];
  console.log(`${id.padEnd(14)} ${color} L=${lum.toFixed(2)} ${dark ? 'тёмный знак' : 'белый знак '} ${source}`);
}

const fmt = (o, ind = '  ') => Object.entries(o).map(([k, v]) => `${ind}${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');

fs.writeFileSync('src/components/serviceData.ts',
`/* Файл создан скриптом scripts/gen-services.cjs — руками не править.
 * Каталог сервисов для значков категорий и кошельков («s:netflix»). Сами логотипы лежат в serviceLogos/logos-<группа>.ts и грузятся лениво. */
export interface ServiceMeta {
  /** Часть значения поля icon: «s:<id>». */
  id: string;
  name: string;
  group: string;
  /** Цвет плитки (фирменный). */
  color: string;
  /** Знак на плитке тёмный (иначе белый): плитка светлая. */
  dark?: true;
  /** Слова для подсказки значка по названию категории (целым словом, в нижнем регистре). */
  keys?: readonly string[];
  /** Только у таджикских банков и сервисов (tjData.ts): значок приложения файлом, путь от корня сайта (tj/eskhata.png). Тогда логотипа-вектора нет. */
  img?: string;
}

export const SERVICE_GROUPS: readonly { id: string; label: string }[] = ${JSON.stringify(GROUPS.map(([id, label]) => ({ id, label })))};

export const SERVICES: readonly ServiceMeta[] = [
${meta.map((m) => `  ${JSON.stringify(m)},`).join('\n')}
];
`);

// Логотипы — по файлу на группу: нужная группа грузится, только когда на экране есть её сервис.
fs.rmSync('src/components/serviceLogos', { recursive: true, force: true });
fs.mkdirSync('src/components/serviceLogos');
let total = 0;
for (const [group] of GROUPS) {
  const own = Object.fromEntries(meta.filter((m) => m.group === group).map((m) => [m.id, logoMap[m.id]]));
  const text =
`/* Файл создан скриптом scripts/gen-services.cjs — руками не править.
 * Логотипы: Simple Icons, CoreUI Brands, SVG Logos (все CC0). Названия и знаки — товарные знаки их владельцев.
 * Значение — [viewBox, путь]; рисуется одним цветом (currentColor). */
export const LOGOS: Readonly<Record<string, readonly [viewBox: string, path: string]>> = {
${fmt(own)}
};
`;
  fs.writeFileSync(`src/components/serviceLogos/logos-${group}.ts`, text);
  total += text.length;
  console.log(`  ${group}: ${Object.keys(own).length} шт., ${(text.length / 1000).toFixed(1)} КБ`);
}
console.log(meta.length, 'сервисов,', Math.round(total / 1000), 'КБ логотипов');
