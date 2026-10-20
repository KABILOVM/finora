// Бюджет размера сборки: после `vite build` проверяет gzip-размер JS-файлов в dist/assets и падает, если какой-то вырос сверх порога.
// Пороги — чуть выше нынешних размеров (запас ~10%): рост «по чуть-чуть» виден в проверке PR, а не через полгода на медленном телефоне.
// Поднять порог можно сознательно, отдельной строкой в PR.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'dist/assets';
const KB = 1000;
const BUDGET = [
  { match: /^index-.*\.js$/, max: 175 * KB, name: 'основной файл' },
  { match: /^vendor-supabase-.*\.js$/, max: 65 * KB, name: 'vendor: supabase' },
  { match: /^vendor-react-.*\.js$/, max: 60 * KB, name: 'vendor: react' },
  { match: /^vendor-dexie-.*\.js$/, max: 38 * KB, name: 'vendor: dexie' },
  { match: /\.js$/, max: 40 * KB, name: 'страница (ленивый файл)' },
];

const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
let failed = 0;
for (const f of files) {
  const gz = gzipSync(readFileSync(join(DIR, f)), { level: 9 }).length;
  const rule = BUDGET.find((b) => b.match.test(f));
  if (rule && gz > rule.max) {
    failed++;
    console.error(`✗ ${f}: ${(gz / KB).toFixed(1)} КБ gzip > ${(rule.max / KB).toFixed(0)} КБ (${rule.name})`);
  }
}
if (failed > 0) {
  console.error(`Бюджет размера превышен: ${failed}. Уменьшите файл (ленивая загрузка, меньше зависимостей) или осознанно поднимите порог в scripts/check-bundle.mjs.`);
  process.exit(1);
}
console.log(`Бюджет размера в норме (${files.length} файлов).`);
