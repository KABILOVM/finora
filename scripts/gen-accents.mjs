// Пересобирает блоки готовых акцентов в src/index.css из описаний src/lib/accentSpecs.ts (генератор — src/lib/palette.ts).
// Запуск: `npm run gen:accents`. Проверка без записи: `npm run gen:accents -- --check` (то же делает src/accents.test.ts).
// `npm run gen:accents -- --bars` печатает цвета строки браузера (bar) для src/lib/accentSpecs.ts: их надо записать туда готовыми значениями.
import { readFileSync, writeFileSync } from 'node:fs';
import { GENERATED_ACCENTS } from '../src/lib/accentSpecs.ts';
import { buildPalette, GENERATED_BEGIN, GENERATED_END, generatedAccentsCss, paletteHex } from '../src/lib/palette.ts';

if (process.argv.includes('--bars')) {
  for (const a of GENERATED_ACCENTS) {
    const p = buildPalette(a);
    console.log(`${a.id}: bar: { light: '${paletteHex(p, 'bg-l')}', dark: '${paletteHex(p, 'bg-d')}' }`);
  }
  process.exit(0);
}

const FILE = new URL('../src/index.css', import.meta.url);
const css = readFileSync(FILE, 'utf8');
const fresh = generatedAccentsCss(GENERATED_ACCENTS);

const begin = css.indexOf(GENERATED_BEGIN);
const end = css.indexOf(GENERATED_END);
let next;
if (begin >= 0 && end > begin) {
  next = css.slice(0, begin) + fresh + css.slice(end + GENERATED_END.length);
} else {
  // первый запуск: блоки встают после последнего ручного (розового), перед токенами темы
  const anchor = css.indexOf('\n:root {\n  color-scheme');
  if (anchor < 0) throw new Error('В src/index.css не найдено место для блоков акцентов (перед «:root { color-scheme»)');
  next = css.slice(0, anchor) + '\n' + fresh + '\n' + css.slice(anchor);
}

if (process.argv.includes('--check')) {
  if (next !== css) {
    console.error('src/index.css расходится с генератором: запустите `npm run gen:accents`.');
    process.exit(1);
  }
  console.log('Блоки акцентов в index.css совпадают с генератором.');
} else {
  if (next === css) console.log('Блоки акцентов уже актуальны.');
  else {
    writeFileSync(FILE, next);
    console.log(`Готовых акцентов в src/index.css: ${GENERATED_ACCENTS.length}.`);
  }
}
