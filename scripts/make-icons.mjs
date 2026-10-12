// Рисует иконки Sumoima: public/icon.svg + PNG (pwa-192, pwa-512, pwa-maskable-512, apple-touch-icon).
// Знак: жирный «$» на фиолетовом градиенте, тот же рисунок, что в src/components/Logo.tsx.
// Запуск: node scripts/make-icons.mjs
// PNG делает установленный Chromium (через playwright-core), поэтому нужен путь к нему:
//   CHROMIUM_PATH=/путь/к/chrome node scripts/make-icons.mjs   (по умолчанию /opt/pw-browsers/chromium)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

/**
 * Рисунок в сетке 48×48. rounded: скруглённая плашка (обычная иконка); false — на весь квадрат (maskable и iOS сами режут углы).
 * Для maskable и iOS знак уменьшен до 78%: он целиком внутри безопасной зоны (центральные 80%).
 */
function iconSvg({ rounded, size = 48 }) {
  const rx = rounded ? ' rx="15"' : '';
  const scale = rounded ? '' : 'translate(24 24) scale(0.78) translate(-24 -24) ';
  // maskable и iOS: фон сплошной одного цвета (без блика), иначе проверка «значимое содержимое в безопасной зоне» принимает блик за рисунок
  const bg = rounded
    ? `<rect width="48" height="48"${rx} fill="url(#ia)"/><rect width="48" height="48"${rx} fill="url(#ib)"/>`
    : `<rect width="48" height="48" fill="#8059f9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48"><defs><linearGradient id="ia" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a6cff"/><stop offset="1" stop-color="#9a5cf7"/></linearGradient><radialGradient id="ib" cx=".28" cy=".1" r=".95"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="ic" gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="0" y2="40"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e4defd"/></linearGradient></defs>${bg}<g transform="${scale}translate(3.4 0) skewX(-8)" fill="none" stroke="url(#ic)" stroke-linecap="round" stroke-linejoin="round"><path d="M31.4 17.2C29.9 14.4 27.1 13 23.8 13C19.7 13 17 15.1 17 18.3C17 25 31 22.4 31 29.8C31 33 28.2 35.2 24 35.2C20.5 35.2 17.8 33.8 16.3 30.8" stroke-width="5"/><path d="M24 8V40" stroke-width="3.4"/></g></svg>`;
}

const PNGS = [
  { file: 'pwa-192.png', size: 192, rounded: true, transparent: true },
  { file: 'pwa-512.png', size: 512, rounded: true, transparent: true },
  // maskable: фон на весь квадрат, содержимое в центральных 80%
  { file: 'pwa-maskable-512.png', size: 512, rounded: false, transparent: false },
  // iOS сам скругляет углы и заливает прозрачность чёрным, поэтому — сплошной квадрат без прозрачности
  { file: 'apple-touch-icon.png', size: 180, rounded: false, transparent: false },
  { file: 'favicon-32.png', size: 32, rounded: true, transparent: true },
  { file: 'favicon-16.png', size: 16, rounded: true, transparent: true },
];

await mkdir(PUBLIC_DIR, { recursive: true });
await writeFile(resolve(PUBLIC_DIR, 'icon.svg'), iconSvg({ rounded: true }));
console.log('public/icon.svg');

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, rounded, transparent } of PNGS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${iconSvg({ rounded, size })}</body></html>`);
    await page.screenshot({
      path: resolve(PUBLIC_DIR, file),
      omitBackground: transparent,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    console.log(`public/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
