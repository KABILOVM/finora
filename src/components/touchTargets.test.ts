import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Область касания не меньше 44×44 px (WCAG 2.5.5 / рекомендации Apple и Google). Статический обход исходников: у каждой кнопки и
 * ссылки (button, a, Link, summary) высота, заданная классами h-N / min-h-[Npx], не должна быть меньше 44 px, если нет класса
 * tap-44 (невидимая область 44×44 вокруг маленького значка, src/index.css). Что внутри кнопки (значок, ручка переключателя), не
 * считается: касание принимает сама кнопка. Исключения — только с причиной.
 */
const SRC = join(process.cwd(), 'src');

const EXCEPTIONS: Record<string, string> = {
  'layout/SideNav.tsx': 'боковая панель ПК (показывается от 768 px, мышь и клавиатура): плотный список из 12 пунктов должен помещаться по высоте',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Открывающие теги button/a/Link/summary целиком: до «>» вне фигурных скобок и кавычек (стрелка «=>» не конец тега). */
function openingTags(src: string): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  for (const m of src.matchAll(/<(button|a|Link|summary)\b/g)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null;
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && src[i - 1] !== '=') break;
    }
    out.push({ index: m.index, text: src.slice(m.index, i + 1) });
  }
  return out;
}

const HEIGHT = /(?<![\w-])!?(min-h|h)-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\w-])/g;

function lowestPx(tag: string): number | null {
  const sizes = [...tag.matchAll(HEIGHT)].map((m) => (m[2] ? Number(m[2]) : Number(m[3]) * 4));
  return sizes.length === 0 ? null : Math.max(...sizes);
}

describe('области касания ≥ 44 px', () => {
  it('у кнопок и ссылок нет высоты меньше 44 px без tap-44 (кроме перечисленных исключений)', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file);
      if (EXCEPTIONS[rel]) continue;
      const src = readFileSync(file, 'utf8');
      for (const tag of openingTags(src)) {
        if (/\btap-44\b/.test(tag.text)) continue;
        const px = lowestPx(tag.text);
        if (px !== null && px < 44) offenders.push(`${rel}:${src.slice(0, tag.index).split('\n').length} (${px} px)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('исключения не устарели: в указанных файлах такой элемент ещё есть', () => {
    for (const rel of Object.keys(EXCEPTIONS)) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(openingTags(src).some((t) => (lowestPx(t.text) ?? 44) < 44), rel).toBe(true);
    }
  });

  it('клавиатура суммы: ряд знаков и «=» — 44 px, в низких окнах не ниже 40 px', () => {
    const keypad = readFileSync(join(SRC, 'components/Keypad.tsx'), 'utf8');
    expect(keypad).toMatch(/const OP_CLASS =\s*'flex h-11 /);
    expect(keypad).toMatch(/const EQUAL_CLASS =\s*'flex h-11 /);
    const form = readFileSync(join(SRC, 'features/transactions/TxFormFields.tsx'), 'utf8');
    expect(form).not.toMatch(/\[data-op\]\]:!h-(?:[1-9]|\[[1-3]\d?px\])(?![\d.])/);
  });

  it('.tap-44 задана в index.css: область 44×44 вокруг значка', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    expect(css).toMatch(/\.tap-44::after\s*\{[^}]*max\(100%, 44px\)[^}]*max\(100%, 44px\)/);
  });
});
