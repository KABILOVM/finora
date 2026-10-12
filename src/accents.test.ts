import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENTS, DEFAULT_ACCENT } from './theme';

/**
 * Палитры акцентов проверяются по самому src/index.css, а не по копии значений: в тестах CSS не подключается, поэтому файл
 * читается и разбирается. Любая правка цвета, которая роняет контраст, оставляет акцент без части переменных или расходится
 * с таблицей ACCENTS (src/theme.ts) и index.html, здесь не пройдёт.
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

type Rgb = readonly [number, number, number];
type Decls = Record<string, string>;

/** Правила index.css с их переменными (--имя: значение). Ключ — селектор в одну строку; комментарии выброшены. */
function parseRules(css: string): Map<string, Decls> {
  const rules = new Map<string, Decls>();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Decls = {};
    for (const d of (m[2] ?? '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) decls[d[1] ?? ''] = (d[2] ?? '').trim();
    // перед первым правилом могут стоять директивы без скобок («@tailwind base;»): селектор — то, что после последней «;»
    const selector = (m[1] ?? '').split(';').pop() ?? '';
    if (Object.keys(decls).length > 0) rules.set(selector.trim().replace(/\s+/g, ' '), decls);
  }
  return rules;
}

const rules = parseRules(read('./index.css'));
const LIGHT = rules.get(':root') ?? {};
const DARK = rules.get(":root[data-theme='dark']") ?? {};
const SYSTEM_DARK = rules.get(':root:not([data-theme])') ?? {};

/** Блок каждого акцента: у фиолетового он общий с :root (значения по умолчанию). */
const BLOCKS = new Map<string, Decls>();
for (const [selector, decls] of rules) {
  const m = /^(?::root, )?\[data-accent='([a-z]+)'\]$/.exec(selector);
  if (m?.[1]) BLOCKS.set(m[1], decls);
}

/** Какие переменные должен задавать каждый акцент: «-l» — светлая тема, «-d» — тёмная (см. комментарий в index.css). */
const LIGHT_KEYS = ['bg', 'surface-2', 'text', 'muted', 'border', 'border-strong', 'brand', 'brand-hover', 'accent', 'hero', 'orb-1', 'orb-2', 'orb-3', 'glass-shadow'];
const DARK_KEYS = ['bg', 'surface', 'surface-2', 'text', 'muted', 'border', 'border-strong', 'brand', 'brand-hover', 'on-brand', 'accent', 'hero-from', 'hero', 'orb-1', 'orb-2', 'orb-3'];
const REQUIRED = [...LIGHT_KEYS.map((k) => `ac-${k}-l`), ...DARK_KEYS.map((k) => `ac-${k}-d`)];

const WHITE: Rgb = [255, 255, 255];

function rgb(value: string | undefined, what: string): Rgb {
  const m = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(value ?? '');
  if (!m) throw new Error(`${what}: ожидалось «R G B», а там «${value}»`);
  const channels = [Number(m[1]), Number(m[2]), Number(m[3])] as const;
  if (channels.some((c) => c > 255)) throw new Error(`${what}: канал больше 255 («${value}»)`);
  return channels;
}

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
/** Контраст WCAG двух цветов (от 1 до 21). */
const contrast = (a: Rgb, b: Rgb): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Цвет fg с прозрачностью alpha поверх bg — как это рисует браузер (bg-brand/10 на карточке). */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => [0, 1, 2].map((i) => (fg[i] ?? 0) * alpha + (bg[i] ?? 0) * (1 - alpha)) as unknown as Rgb;
const hex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** Палитра, как её видит страница: переменные темы с подставленными значениями акцента. */
function palette(theme: Decls, accent: Decls): Record<string, Rgb> {
  const out: Record<string, Rgb> = {};
  for (const [name, value] of Object.entries(theme)) {
    const ref = /^var\(--([\w-]+)\)$/.exec(value);
    out[name] = rgb(ref ? accent[ref[1] ?? ''] : value, `--${name}`);
  }
  return out;
}

describe('цвета акцентов (src/index.css)', () => {
  it('у каждого акцента из ACCENTS есть блок в index.css, и лишних блоков нет', () => {
    expect([...BLOCKS.keys()].sort()).toEqual(ACCENTS.map((a) => a.id).sort());
  });

  it('фиолетовый — акцент по умолчанию, первый в списке и общий с :root (прежняя палитра без атрибута)', () => {
    expect(DEFAULT_ACCENT).toBe('violet');
    expect(ACCENTS[0]?.id).toBe('violet');
    expect(rules.get(":root, [data-accent='violet']")).toBeDefined();
  });

  it('акценты различаются: нет двух одинаковых главных цветов', () => {
    for (const key of ['ac-brand-l', 'ac-brand-d', 'ac-bg-l', 'ac-bg-d']) {
      const values = ACCENTS.map((a) => BLOCKS.get(a.id)?.[key]);
      expect(new Set(values).size, key).toBe(ACCENTS.length);
    }
  });

  describe('блоки тем берут нужные наборы', () => {
    const refs = (decls: Decls): string[] => Object.values(decls).flatMap((v) => /^var\(--([\w-]+)\)$/.exec(v)?.[1] ?? []);

    it('светлая берёт «-l», тёмная и «как в системе» — «-d»', () => {
      expect(refs(LIGHT).length).toBeGreaterThan(10);
      expect(refs(LIGHT).filter((r) => !r.endsWith('-l'))).toEqual([]);
      expect(refs(DARK).filter((r) => !r.endsWith('-d'))).toEqual([]);
      expect(refs(DARK).length).toBeGreaterThan(10);
    });

    it('«тёмная как в системе» совпадает с тёмной, выбранной вручную (два блока не расходятся)', () => {
      expect(SYSTEM_DARK).toEqual(DARK);
    });

    it('у обеих тем одни и те же токены', () => {
      expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    });
  });

  describe.each(ACCENTS.map((a) => [a.label, a] as const))('акцент «%s»', (_label, accent) => {
    const block = BLOCKS.get(accent.id) ?? {};

    it('описан целиком: светлая и тёмная палитра, значения — «R G B»', () => {
      expect(Object.keys(block).sort()).toEqual([...REQUIRED].sort());
      for (const key of REQUIRED) rgb(block[key], `--${key}`);
    });

    it('все ссылки тем на этот акцент находят переменную', () => {
      expect(() => palette(LIGHT, block)).not.toThrow();
      expect(() => palette(DARK, block)).not.toThrow();
    });

    it('цвет строки состояния браузера (ACCENTS.bar) совпадает с фоном страницы', () => {
      expect(accent.bar.light).toBe(hex(rgb(block['ac-bg-l'], '--ac-bg-l')));
      expect(accent.bar.dark).toBe(hex(rgb(block['ac-bg-d'], '--ac-bg-d')));
    });

    describe.each([
      ['светлая', LIGHT],
      ['тёмная', DARK],
    ] as const)('%s тема: контраст WCAG', (_name, theme) => {
      // Палитра считается внутри проверок (а не при сборке набора): сломанный акцент роняет свои тесты с понятным сообщением.
      let cached: Record<string, Rgb> | undefined;
      const color = (name: string): Rgb => {
        cached ??= palette(theme, block);
        const c = cached[name];
        if (!c) throw new Error(`в теме нет токена --${name}`);
        return c;
      };
      const ratio = (a: string, b: Rgb | string) => contrast(color(a), typeof b === 'string' ? color(b) : b);

      it('текст, приглушённый текст, brand и цвета денег читаются на bg, surface и surface-2 (≥ 4.5:1)', () => {
        for (const surface of ['bg', 'surface', 'surface-2']) {
          for (const fg of ['text', 'muted', 'brand', 'danger', 'income', 'expense', 'warning']) {
            expect(ratio(fg, surface), `${fg} на ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it('рамки полей ввода различимы на всех поверхностях (≥ 3:1)', () => {
        for (const surface of ['bg', 'surface', 'surface-2']) {
          expect(ratio('border-strong', surface), `border-strong на ${surface}`).toBeGreaterThanOrEqual(3);
        }
      });

      it('текст кнопок и выбранных сегментов читается на brand, при наведении и на конце градиента', () => {
        expect(ratio('on-brand', 'brand'), 'on-brand на brand').toBeGreaterThanOrEqual(4.5);
        expect(ratio('on-brand', 'brand-hover'), 'on-brand на brand-hover').toBeGreaterThanOrEqual(4.5);
        // конец градиента кнопки (accent): жирный текст ≥ 16 px, для него достаточно 3:1
        expect(ratio('on-brand', 'accent'), 'on-brand на accent').toBeGreaterThanOrEqual(3);
        expect(ratio('on-danger', 'danger'), 'on-danger на danger').toBeGreaterThanOrEqual(4.5);
      });

      it('brand читается на подсвеченной плашке (выбранный чип: bg-brand/10 и /15 на surface)', () => {
        for (const alpha of [0.1, 0.15]) {
          expect(ratio('brand', over(color('brand'), alpha, color('surface'))), `bg-brand/${alpha * 100}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('белый текст читается на карточке «Всего» (градиент hero-from → hero, ≥ 4.5:1)', () => {
        expect(contrast(WHITE, color('hero-from')), 'hero-from').toBeGreaterThanOrEqual(4.5);
        expect(contrast(WHITE, color('hero')), 'hero').toBeGreaterThanOrEqual(4.5);
      });
    });
  });
});

describe('index.html и таблица ACCENTS', () => {
  it('начальный цвет строки состояния (до запуска скриптов) — фон фиолетового акцента', () => {
    const metas = [...read('../index.html').matchAll(/<meta name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: (light|dark)\)"/g)];
    expect(Object.fromEntries(metas.map((m) => [m[2], m[1]]))).toEqual({ light: ACCENTS[0]?.bar.light, dark: ACCENTS[0]?.bar.dark });
  });
});
