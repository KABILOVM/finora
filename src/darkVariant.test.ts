import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Тема выбирается человеком (data-theme на <html>, src/theme.ts), а «как в системе» атрибута не ставит. Класс Tailwind dark:
 * в такой схеме показывал бы тему системы, а не выбранную, поэтому весь цвет берётся из токенов (src/index.css).
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('цвета только из токенов', () => {
  it('в исходниках нет классов dark: (тема — по data-theme, а не по системе)', () => {
    const offenders = sources(join(process.cwd(), 'src')).filter((f) => /(^|[\s"'`])dark:\S/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(process.cwd(), ''))).toEqual([]);
  });
});
