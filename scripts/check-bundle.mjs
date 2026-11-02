// Бюджет размера сборки: после `vite build` проверяет gzip-размер JS-файлов в dist/assets и падает, если какой-то вырос сверх порога.
// Пороги — чуть выше нынешних размеров (запас ~10%): рост «по чуть-чуть» виден в проверке PR, а не через полгода на медленном телефоне.
// Поднять порог можно сознательно, отдельной строкой в PR.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'dist/assets';
const KB = 1000;
const BUDGET = [
  // 176: «сумма на чеке» у операций (проверки, обновление локальной базы, поля синхронизации) добавила ~0,9 КБ в основной файл
  // 177: после выпусков 0.9.2 и 0.9.3 основной файл вырос до 176,3 КБ (на 0.9.1 ещё помещался в 176)
  // 178: образы оформления (src/theme.ts, src/skinCore.ts: выбор, запоминание, цвет строки состояния у 18 образов) добавили ~1,0 КБ в основной файл; подписи и образцы для настроек в него не входят
  // 179: значки образов (0.10.1) довели основной файл до 178,1 КБ, а данные «Трат в день» (0.11.0: поля категории, версия базы 11, запись в «Что нового») — до 178,4 КБ; экраны и расчёт живут в ленивых файлах
  { match: /^index-.*\.js$/, max: 179 * KB, name: 'основной файл' },
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
