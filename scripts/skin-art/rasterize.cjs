// Рисует SVG-гербы в прозрачные PNG для build.py (в Chromium, который уже стоит для Playwright).
// Запуск: node scripts/skin-art/rasterize.cjs [папка для PNG]   (по умолчанию /tmp/skin-art)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..');
const skins = path.join(repo, 'src', 'assets', 'skins');
const out = process.argv[2] || '/tmp/skin-art';
// [имя PNG, откуда: относительно src/assets/skins, а с «~/» — относительно корня репозитория]
const jobs = [
  ['barca-crest.png', 'barca/logo/FC-Barcelona.svg'],
  ['real-crest.png', 'real-madrid/logo/Real-Madrid-CF.svg'],
  ['spain-flag.png', 'football/flags/es-circle.svg'],
  ['ar-flag.png', 'football/flags/ar-circle.svg'],
  ['pt-flag.png', 'football/flags/pt-circle.svg'],
  ['akatsuki-cloud.png', 'akatsuki/svg/emblem.svg'],
  ['classic-icon.png', '~/public/icon.svg'],
  ...fs
    .readdirSync(path.join(skins, 'emoji'))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => ['emoji-' + f.replace(/\.svg$/, '.png'), 'emoji/' + f]),
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  // CHROMIUM_PATH: свой браузер, если версия Playwright в репозитории не совпадает с установленной
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  for (const [name, rel] of jobs) {
    const file = rel.startsWith('~/') ? path.join(repo, rel.slice(2)) : path.join(skins, rel);
    const svg = fs.readFileSync(file).toString('base64');
    await page.setContent(`<html><body style="margin:0;background:transparent"><img id="i" style="width:512px;height:512px;object-fit:contain" src="data:image/svg+xml;base64,${svg}"></body></html>`);
    await page.waitForFunction(() => document.getElementById('i').complete);
    await page.screenshot({ path: path.join(out, name), omitBackground: true });
    console.log(name);
  }
  await browser.close();
})();
