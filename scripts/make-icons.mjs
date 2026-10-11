// Рисует иконки Finora: public/icon.svg + PNG (pwa-192, pwa-512, pwa-maskable-512, apple-touch-icon).
// Запуск: node scripts/make-icons.mjs
// PNG делает установленный Chromium (через playwright-core), поэтому нужен путь к нему:
//   CHROMIUM_PATH=/путь/к/chrome node scripts/make-icons.mjs   (по умолчанию /opt/pw-browsers/chromium)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const DARK = '#0f172a';
const GREEN = '#10b981';
const GREEN_DARK = '#059669';

/**
 * Рисунок 512×512: тёмная плашка, зелёная монета, буква «F» из прямоугольников (без шрифтов).
 * rounded: скруглённая плашка (обычная иконка); false — на весь квадрат (maskable и iOS сами режут углы).
 * Монета (диаметр 336 из 512 = 66%) целиком внутри безопасной зоны maskable (80%).
 */
function iconSvg({ rounded, size = 512 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="coin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GREEN}"/>
      <stop offset="1" stop-color="${GREEN_DARK}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512"${rounded ? ' rx="112"' : ''} fill="${DARK}"/>
  <circle cx="256" cy="256" r="168" fill="url(#coin)"/>
  <circle cx="256" cy="256" r="140" fill="none" stroke="${DARK}" stroke-opacity="0.22" stroke-width="8"/>
  <g fill="${DARK}">
    <rect x="200" y="176" width="46" height="160" rx="10"/>
    <rect x="200" y="176" width="112" height="44" rx="10"/>
    <rect x="200" y="234" width="84" height="40" rx="10"/>
  </g>
</svg>
`;
}

const PNGS = [
  { file: 'pwa-192.png', size: 192, rounded: true, transparent: true },
  { file: 'pwa-512.png', size: 512, rounded: true, transparent: true },
  // maskable: фон на весь квадрат, содержимое в центральных 80%
  { file: 'pwa-maskable-512.png', size: 512, rounded: false, transparent: false },
  // iOS сам скругляет углы и заливает прозрачность чёрным, поэтому — сплошной квадрат без прозрачности
  { file: 'apple-touch-icon.png', size: 180, rounded: false, transparent: false },
];

await mkdir(PUBLIC_DIR, { recursive: true });
await writeFile(resolve(PUBLIC_DIR, 'icon.svg'), iconSvg({ rounded: true }));
console.log('public/icon.svg');

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, rounded, transparent } of PNGS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${iconSvg({ rounded, size })}</body></html>`,
    );
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
