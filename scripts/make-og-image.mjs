// Рисует картинку превью ссылки public/og-image.jpg (1200×630): знак, название и подпись Sumoima на тёмном фоне.
// Знак берётся из public/icon.svg, шрифт Onest — из src/assets/fonts (вшивается в страницу, сети не нужно).
// Запуск: `npm run gen:og` (PNG делает установленный Chromium через playwright-core; свой путь к нему — CHROMIUM_PATH=/путь/к/chrome).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const WIDTH = 1200;
const HEIGHT = 630;

const icon = (await readFile(resolve(ROOT, 'public/icon.svg'), 'utf8')).replace(/width="48" height="48"/, 'width="228" height="228"');
const font = (await readFile(resolve(ROOT, 'src/assets/fonts/onest-cyrillic-wght-normal.woff2'))).toString('base64');
const fontLatin = (await readFile(resolve(ROOT, 'src/assets/fonts/onest-latin-wght-normal.woff2'))).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Onest;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format('woff2');unicode-range:U+0400-04FF,U+0500-052F}
@font-face{font-family:Onest;font-weight:100 900;src:url(data:font/woff2;base64,${fontLatin}) format('woff2');unicode-range:U+0000-00FF,U+2000-206F,U+2190-21FF}
*{box-sizing:border-box}
body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;font-family:Onest,sans-serif;color:#fff;
  background:radial-gradient(900px 520px at 12% 8%,rgba(122,108,255,.55),transparent 62%),radial-gradient(800px 500px at 100% 100%,rgba(154,92,247,.35),transparent 60%),linear-gradient(135deg,#0b0d24,#080a18 60%,#140f33)}
.row{position:absolute;inset:0;display:flex;align-items:center;gap:64px;padding:0 96px}
.icon{flex:none;filter:drop-shadow(0 24px 40px rgba(106,108,255,.55))}
.name{font-size:132px;font-weight:800;line-height:1;letter-spacing:.02em;transform:skewX(-6deg);transform-origin:left bottom;-webkit-text-stroke:.04em currentColor;paint-order:stroke fill}
.tag{margin-top:26px;font-size:52px;font-weight:600;line-height:1.15}
.sub{margin-top:18px;font-size:32px;font-weight:400;line-height:1.3;color:rgba(228,222,253,.78)}
</style></head><body><div class="row"><div class="icon">${icon}</div><div>
<div class="name">Sumoima</div><div class="tag">Личный учёт денег</div>
<div class="sub">Кошельки, бюджеты, долги и курсы валют.<br>Работает без интернета</div></div></div></body></html>`;

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await writeFile(resolve(ROOT, 'public/og-image.jpg'), await page.screenshot({ type: 'jpeg', quality: 88 }));
  console.log('public/og-image.jpg');
} finally {
  await browser.close();
}
