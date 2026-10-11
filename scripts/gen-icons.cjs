/*
 * Генератор src/components/iconData.ts — встроенные иконки (работают офлайн, без CDN).
 * Источники: Solar (480 Design, CC BY 4.0, «bold duotone») и Lucide (ISC, линия).
 * Запуск (пакеты нужны только для генерации, в зависимости проекта их нет):
 *   npm i --no-save @iconify-json/solar @iconify-json/lucide && node scripts/gen-icons.cjs
 */
const fs = require('fs');
const solar = require('@iconify-json/solar/icons.json');
const lucide = require('@iconify-json/lucide/icons.json');

// Иконки интерфейса и значки категорий/кошельков (ключ → имя в Solar).
const DUO = {
  home: 'home-2', list: 'bill-list', wallet: 'wallet-2', more: 'menu-dots', trash: 'trash-bin-trash', edit: 'pen',
  cloud: 'cloud', 'cloud-off': 'cloud-cross', 'cloud-check': 'cloud-check', refresh: 'refresh', lock: 'lock-password',
  download: 'download-minimalistic', upload: 'upload-minimalistic', search: 'magnifer', calendar: 'calendar-mark',
  transfer: 'transfer-horizontal', alert: 'danger-triangle', info: 'info-circle', backspace: 'backspace',
  income: 'arrow-left-down', expense: 'arrow-right-up', user: 'user-circle', logout: 'logout-2', mail: 'letter',
  settings: 'settings', sun: 'sun-2', moon: 'moon', pie: 'pie-chart-2', banknote: 'banknote-2', sliders: 'tuning-2', target: 'target', chart: 'chart-2', fire: 'fire', shield: 'shield-check',
  // значки категорий и кошельков
  cart: 'cart-large-2', food: 'chef-hat-minimalistic', cup: 'cup-hot', donut: 'donut-bitten', wine: 'wineglass', bus: 'bus',
  car: 'car', fuel: 'gas-station', plane: 'plain-2', scooter: 'scooter', sofa: 'sofa', bulb: 'lightbulb',
  washing: 'washing-machine-minimalistic', key: 'key', bolt: 'bolt', water: 'waterdrops', wifi: 'wi-fi-router',
  phone: 'smartphone', laptop: 'laptop', heart: 'heart-pulse', pills: 'pills', hospital: 'hospital', bag: 'bag-3',
  shirt: 't-shirt', scissors: 'scissors', paw: 'paw', game: 'gamepad', music: 'music-note-2', tv: 'tv',
  video: 'video-library', ball: 'football', gym: 'dumbbell-small', book: 'book-2', diploma: 'diploma', gift: 'gift',
  party: 'balloon', star: 'star', invest: 'graph-up', money: 'money-bag', salary: 'wallet-money', cash: 'banknote-2',
  card: 'card', safe: 'safe-circle', briefcase: 'case-round', tool: 'settings-minimalistic', box: 'box', tag: 'tag',
  repeat: 'repeat', debt: 'hand-money', stars: 'stars', question: 'question-circle', sale: 'sale',
};
// Линейные иконки (Lucide).
const LINE = { plus: 'plus', check: 'check', close: 'x', chevron: 'chevron-right', eye: 'eye', 'eye-off': 'eye-off' };
// Знаки банков, нарисованные вручную (24×24, цвет — currentColor).
const RAW = {
  'bank-alif': '<path d="M11.42 5.92A6 6 0 1 0 15.17 16.22" fill="none" stroke="currentColor" stroke-width="1.55"/><path fill="currentColor" d="M8.3 14.8 10.9 8.3H13l2.6 6.5h-1.9L11.95 10.4 10.2 14.8z"/>',
  'bank-dc': '<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5h3.2a5.5 5.5 0 0 1 0 11H3.5z"/><path d="M20.5 8.8a5 5 0 1 0 0 6.4" opacity=".7"/></g>',
  'bank-humo': '<g fill="currentColor"><path d="M2.5 13.5c3-.8 5.2-3.6 6.2-8 .9 2.8 1.9 4.6 3.3 4.6s2.4-1.8 3.3-4.6c1 4.4 3.2 7.2 6.2 8-3.2 1-5.4 1.8-9.5 6-4.1-4.2-6.3-5-9.5-6z"/><circle cx="12" cy="12.8" r="1.6" opacity=".4"/></g>',
};

const out = { duo: {}, line: {} };
for (const [k, n] of Object.entries(DUO)) {
  const i = solar.icons[n + '-bold-duotone'];
  if (!i) throw new Error('нет иконки Solar ' + n);
  out.duo[k] = i.body;
}
for (const [k, body] of Object.entries(RAW)) out.duo[k] = body;
for (const [k, n] of Object.entries(LINE)) {
  const i = lucide.icons[n];
  if (!i) throw new Error('нет иконки Lucide ' + n);
  out.line[k] = i.body;
}
const fmt = (o) => Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
fs.writeFileSync('src/components/iconData.ts',
`/* Файл создан скриптом scripts/gen-icons.cjs — руками не править.
 * Иконки: Solar (480 Design, CC BY 4.0) и Lucide (ISC). Знаки банков (bank-*) нарисованы вручную. */
export const DUO = {
${fmt(out.duo)}
} as const;

export const LINE = {
${fmt(out.line)}
} as const;
`);
console.log(Object.keys(out.duo).length, 'duo,', Object.keys(out.line).length, 'line');
