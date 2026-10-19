import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Область касания не меньше 44×44 px (WCAG 2.5.5, рекомендации Apple и Google). Статический обход исходников: у каждой кнопки и
 * ссылки (button, a, Link, NavLink, summary, IconButton) высота, заданная её className (h-N, min-h-[Npx|Nrem], size-N), не должна
 * быть меньше 44 px, если нет класса tap-44 (невидимая область 44×44 вокруг маленького значка, src/index.css).
 *
 * Что считается: только className самого элемента (не вложенные пропсы вроде leading={<span className="h-8">}); классы с вариантами
 * (md:, [&_svg]:, [@media…]:) пропускаются: проверяется то, что действует на телефоне по умолчанию, а намеренное «сжатие» в низких
 * окнах проверяется отдельно (клавиатура суммы, ниже). Если className — имя константы в том же файле, берётся её текст. Что внутри
 * кнопки (значок, ручка переключателя), не считается: касание принимает сама кнопка. Классы из вызова функции (buttonClasses(...))
 * не видны: у неё своя высота 44/52 px. Исключения — только с причиной.
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

/** Открывающие теги целиком: до «>» вне фигурных скобок и кавычек (стрелка «=>» не конец тега). */
function openingTags(src: string): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  for (const m of src.matchAll(/<(button|a|Link|NavLink|summary|IconButton)\b/g)) {
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

/** Значение атрибута className на верхнем уровне тега: строка в кавычках или выражение в фигурных скобках. */
function classNameExpression(tag: string): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < tag.length; i++) {
    const c = tag[i];
    if (quote) {
      if (c === quote && tag[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && tag.startsWith('className=', i)) {
      const start = i + 'className='.length;
      const open = tag[start];
      if (open === '"' || open === "'") return tag.slice(start, tag.indexOf(open, start + 1) + 1);
      if (open === '{') {
        let d = 0;
        let q: string | null = null;
        for (let j = start; j < tag.length; j++) {
          const ch = tag[j];
          if (q) {
            if (ch === q && tag[j - 1] !== '\\') q = null;
          } else if (ch === '"' || ch === "'" || ch === '`') q = ch;
          else if (ch === '{') d++;
          else if (ch === '}' && --d === 0) return tag.slice(start, j + 1);
        }
      }
    }
  }
  return null;
}

const STRING = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
const stringsOf = (text: string): string[] => [...text.matchAll(STRING)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

/** Если className — имя константы того же файла («{KEY_CLASS}»), вернуть строки из её объявления. */
function resolveConstant(expression: string, src: string): string | null {
  const name = /^\{\s*([A-Za-z_]\w*)\s*\}$/.exec(expression)?.[1];
  if (!name) return null;
  const decl = new RegExp(`const ${name}\\b[^=]*=([\\s\\S]*?);\\n`).exec(src);
  return decl?.[1] ?? null;
}

const SIZE = /^!?(?:min-h|h|size)-(?:\[(\d+(?:\.\d+)?)(px|rem)\]|(\d+(?:\.\d+)?))$/;

/** Самая большая высота из классов без вариантов (в px) или null, если высоты нет. */
function baseHeightPx(classText: string): number | null {
  const sizes: number[] = [];
  for (const token of stringsOf(classText).flatMap((s) => s.split(/\s+/))) {
    if (token.includes(':')) continue; // md:h-11, [&_svg]:h-4, [@media…]:!h-8 — не то, что действует по умолчанию
    const m = SIZE.exec(token);
    if (!m) continue;
    sizes.push(m[1] ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : Number(m[3]) * 4);
  }
  return sizes.length === 0 ? null : Math.max(...sizes);
}

function heightOf(tag: string, src: string): number | null {
  const expression = classNameExpression(tag);
  if (expression === null) return null;
  return baseHeightPx(resolveConstant(expression, src) ?? expression);
}

describe('области касания ≥ 44 px', () => {
  it('у кнопок и ссылок нет высоты меньше 44 px без tap-44 (кроме перечисленных исключений)', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file);
      if (EXCEPTIONS[rel]) continue;
      const src = readFileSync(file, 'utf8');
      for (const tag of openingTags(src)) {
        const classes = classNameExpression(tag.text) ?? '';
        if (/\btap-44\b/.test(classes)) continue;
        const px = heightOf(tag.text, src);
        if (px !== null && px < 44) offenders.push(`${rel}:${src.slice(0, tag.index).split('\n').length} (${px} px)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('сам страж видит то, что должен: примеры нарушений и допустимых случаев', () => {
    const src = 'const CHIP = `h-8 px-3`;\nconst OK = "min-h-[44px]";\n';
    const h = (tag: string) => heightOf(tag, src);
    expect(h('<button className="h-8 w-8">')).toBe(32);
    expect(h('<IconButton className="h-6 md:h-11" />')).toBe(24); // на телефоне 24, md: не считается
    expect(h('<button className="h-11 [@media(max-height:700px)]:!h-8">')).toBe(44); // намеренное сжатие — отдельной проверкой
    expect(h('<button className={cn("size-8", x && "p-1")}>')).toBe(32);
    expect(h('<button className="h-[2rem]">')).toBe(32);
    expect(h('<button className="min-h-[44px] h-8">')).toBe(44); // min-h не даёт кнопке стать ниже
    expect(h('<button className={CHIP}>')).toBe(32); // имя константы разворачивается
    expect(h('<button className={OK}>')).toBe(44);
    expect(h('<button leading={<span className="h-8 w-8" />}>')).toBeNull(); // вложенный className — не кнопки
    expect(h('<button className="[&_svg]:h-4">')).toBeNull(); // вариант без высоты кнопки
    expect(openingTags('<NavLink to="/" className="h-8">x</NavLink><IconButton className="h-8" />').length).toBe(2);
  });

  it('исключения не устарели: в указанных файлах такой элемент ещё есть', () => {
    for (const rel of Object.keys(EXCEPTIONS)) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(openingTags(src).some((t) => (heightOf(t.text, src) ?? 44) < 44), rel).toBe(true);
    }
  });

  it('клавиатура суммы: знаки и «=» — 44 px, при сжатии в низких окнах не ниже 40 px', () => {
    const keypad = readFileSync(join(SRC, 'components/Keypad.tsx'), 'utf8');
    expect(keypad).toMatch(/const OP_CLASS =\s*'flex h-11 /);
    expect(keypad).toMatch(/const EQUAL_CLASS =\s*'flex h-11 /);
    const form = readFileSync(join(SRC, 'features/transactions/TxFormFields.tsx'), 'utf8');
    const compact = /const COMPACT_KEYPAD =([\s\S]*?);\n/.exec(form)?.[1] ?? '';
    const squeezes = [...compact.matchAll(/\[data-op\]\]:!?h-(?:\[(\d+(?:\.\d+)?)(px|rem)\]|(\d+(?:\.\d+)?))/g)].map((m) =>
      m[1] ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : Number(m[3]) * 4,
    );
    expect(squeezes.length, 'сжатие знаков не найдено — тест устарел').toBeGreaterThan(0);
    for (const px of squeezes) expect(px).toBeGreaterThanOrEqual(40);
  });

  it('.tap-44 задана в index.css: область 44×44 вокруг значка', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    expect(css).toMatch(/\.tap-44::after\s*\{[^}]*max\(100%, 44px\)[^}]*max\(100%, 44px\)/);
  });
});
