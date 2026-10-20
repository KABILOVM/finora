import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Слои приложения: нижние ничего не знают о верхних. Тест читает импорты всех файлов `src/` (кроме тестов) и падает на новой
 * зависимости «снизу вверх». Старые отступления перечислены в KNOWN: список только сокращается — исправленное отступление
 * тоже роняет тест, пока его не уберут из списка.
 */
const SRC = resolve(__dirname);

/** Что может импортировать каждый нижний слой (верхние слои — features, layout, app, auth, push, App — не ограничены). */
const ALLOWED: Record<string, readonly string[]> = {
  domain: ['lib'],
  lib: ['domain'],
  db: ['domain', 'lib', 'sync'],
  sync: ['db', 'domain', 'lib'],
  components: ['domain', 'lib', 'theme', 'install', 'sync'],
  rates: ['components', 'db', 'domain', 'lib'],
  import: ['db', 'domain', 'lib', 'rates'],
  recurring: ['db', 'domain', 'lib', 'rates'],
  lock: ['components'],
  install: ['components'],
};

/** «файл -> слой, куда он ходит»: известные отступления от ALLOWED. Не добавлять — выносить общее вниз. */
const KNOWN = new Set<string>([
  'components/ErrorBoundary.tsx -> features',
  'components/Glyph.tsx -> features',
  'domain/expensesAi.ts -> components',
  'rates/EnteredRatesList.tsx -> features',
  'recurring/fx.ts -> features',
  'recurring/postForm.ts -> features',
  'recurring/received.ts -> features',
  'recurring/ruleForm.ts -> features',
  'recurring/ruleView.ts -> features',
]);

function listSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) listSources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$|testUtils/.test(name)) out.push(path);
  }
  return out;
}

const topOf = (file: string): string => relative(SRC, file).split(sep)[0]!.replace(/\.[^.]+$/, '');

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1]!;
    if (spec.startsWith('@/')) found.push(spec.slice(2).split('/')[0]!.replace(/\.[^.]+$/, ''));
    else if (spec.startsWith('.')) {
      const target = resolve(dirname(file), spec);
      if (target.startsWith(SRC + sep)) found.push(relative(SRC, target).split(sep)[0]!.replace(/\.[^.]+$/, ''));
    }
  }
  return found;
}

describe('слои приложения', () => {
  const violations = new Set<string>();
  for (const file of listSources(SRC)) {
    const layer = topOf(file);
    const allowed = ALLOWED[layer];
    if (!allowed) continue;
    for (const to of importsOf(file)) {
      if (to !== layer && !allowed.includes(to)) violations.add(`${relative(SRC, file).split(sep).join('/')} -> ${to}`);
    }
  }

  it('нижние слои не импортируют верхние (кроме перечисленных отступлений)', () => {
    expect([...violations].filter((v) => !KNOWN.has(v)).sort()).toEqual([]);
  });

  it('перечисленное отступление, которого уже нет, убрано из списка', () => {
    expect([...KNOWN].filter((v) => !violations.has(v)).sort()).toEqual([]);
  });
});
