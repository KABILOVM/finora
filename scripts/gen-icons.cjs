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
  mic: 'microphone-3', repeat: 'repeat', debt: 'hand-money', stars: 'stars', question: 'question-circle', sale: 'sale',
};
// Линейные иконки (Lucide).
const LINE = { plus: 'plus', check: 'check', close: 'x', chevron: 'chevron-right', eye: 'eye', 'eye-off': 'eye-off' };
const out = { duo: {}, line: {} };
for (const [k, n] of Object.entries(DUO)) {
  const i = solar.icons[n + '-bold-duotone'];
  if (!i) throw new Error('нет иконки Solar ' + n);
  out.duo[k] = i.body;
}
for (const [k, n] of Object.entries(LINE)) {
  const i = lucide.icons[n];
  if (!i) throw new Error('нет иконки Lucide ' + n);
  out.line[k] = i.body;
}
const fmt = (o) => Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
fs.writeFileSync('src/components/iconData.ts',
`/* Файл создан скриптом scripts/gen-icons.cjs — руками не править.
 * Иконки: Solar (480 Design, CC BY 4.0) и Lucide (ISC). */
export const DUO = {
${fmt(out.duo)}
} as const;

export const LINE = {
${fmt(out.line)}
} as const;
`);
console.log(Object.keys(out.duo).length, 'duo,', Object.keys(out.line).length, 'line');
