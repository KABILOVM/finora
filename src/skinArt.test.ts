import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SKIN_THUMBS } from './skinThumbs';
import { SKINS } from './skins';

const bytes = (relative: string): Buffer => readFileSync(new URL(relative, import.meta.url));
const css = bytes('./index.css').toString('utf8');
const viteConfig = bytes('../vite.config.ts').toString('utf8');

/** Содержимое блока `html[data-skin='id'] { … }` из index.css (дополнительные переменные образа: узор, знак, картинка). */
const extras = (id: string): string => {
  const m = css.match(new RegExp(`html\\[data-skin='${id}'\\] \\{\\n([\\s\\S]*?)\\n\\}\\n`));
  expect(m, `блок html[data-skin='${id}']`).not.toBeNull();
  return m?.[1] ?? '';
};
const artSkins = SKINS.filter((s) => s.id !== 'classic' && extras(s.id).includes('--skin-art:'));
const KB = 1024;

describe('картинки образов: фон карточки «Всего»', () => {
  it('картинки есть у образов по клубам, играм и странам, которым есть что показать (не меньше восьми)', () => {
    expect(artSkins.map((s) => s.id).sort()).toEqual(['akatsuki', 'barca', 'messi', 'pamir', 'real', 'shinobi', 'spider', 'tajik']);
  });

  it('каждая картинка — webp 640×320 из assets/skins/art, файл есть и не тяжелее 40 КБ; рядом задан --skin-art-content', () => {
    for (const skin of artSkins) {
      const body = extras(skin.id);
      const url = body.match(/--skin-art: url\('\.\/(assets\/skins\/art\/[a-z0-9-]+-hero\.webp)'\);/)?.[1];
      expect(url, `--skin-art у ${skin.id}`).toBe(`assets/skins/art/${skin.id}-hero.webp`);
      expect(body, `--skin-art-content у ${skin.id}`).toContain("--skin-art-content: '';");
      const file = bytes(`./${url}`);
      expect(file.length, `${skin.id}: размер`).toBeLessThanOrEqual(40 * KB);
      // webp: «RIFF» … «WEBP»; ширину и высоту читаем из заголовка (формат VP8 / VP8L / VP8X)
      expect(file.subarray(0, 4).toString('latin1'), skin.id).toBe('RIFF');
      expect(file.subarray(8, 12).toString('latin1'), skin.id).toBe('WEBP');
      const kind = file.subarray(12, 16).toString('latin1');
      if (kind === 'VP8X') {
        const w = 1 + file.readUIntLE(24, 3);
        const h = 1 + file.readUIntLE(27, 3);
        expect([w, h], `${skin.id}: размер картинки`).toEqual([640, 320]);
      }
    }
  });

  it('слой с картинкой появляется только когда она задана: content берётся из --skin-art-content, без него — none, и слой лежит под текстом', () => {
    const rule = css.match(/html\[data-skin\] \.skin-hero::after \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(rule).toContain('content: var(--skin-art-content, none);');
    expect(rule).toContain('z-index: -1;');
    expect(rule).toContain('pointer-events: none;');
    expect(rule).toContain('var(--skin-art, none)');
    expect(css).toMatch(/html\[data-skin\] \.skin-hero \{\n  isolation: isolate;\n\}/);
    for (const skin of SKINS.filter((s) => s.id !== 'classic' && !artSkins.includes(s))) expect(extras(skin.id).includes('--skin-art-content'), skin.id).toBe(false);
  });

  it('картинки образов не попадают в офлайн-кэш: webp, jpg и jpeg нет в globPatterns, а в сборке webp всегда отдельным файлом', () => {
    const globs = viteConfig.match(/globPatterns: \[([^\]]*)\]/)?.[1] ?? '';
    expect(globs).toContain('js,css,html');
    for (const ext of ['webp', 'jpg', 'jpeg', 'avif']) expect(globs.includes(ext), ext).toBe(false);
    expect(viteConfig).toMatch(/assetsInlineLimit: \(file\) => \(file\.endsWith\('\.woff2'\) \|\| file\.endsWith\('\.webp'\)/);
  });

  it('гербы в углу карточки (--skin-mark) у Барселоны, Реала и Таджикистана — webp до 30 КБ', () => {
    for (const id of ['barca', 'real', 'tajik']) {
      const url = extras(id).match(/--skin-mark: url\('\.\/(assets\/skins\/art\/[a-z0-9-]+-mark\.webp)'\);/)?.[1];
      expect(url, id).toBe(`assets/skins/art/${id}-mark.webp`);
      expect(bytes(`./${url}`).length, id).toBeLessThanOrEqual(30 * KB);
    }
  });

  it('там, где картинка уже с героем (Месси, Шиноби, Паутина), водяной знак в углу не рисуется поверх него', () => {
    for (const id of ['messi', 'shinobi', 'spider']) {
      const body = extras(id);
      expect(body.includes('--skin-mark:'), `${id}: --skin-mark`).toBe(false);
      expect(body.includes('--skin-mark-text:'), `${id}: --skin-mark-text`).toBe(false);
    }
  });
});

describe('миниатюры образов в настройках', () => {
  it('миниатюры заданы только для существующих образов, файл есть, webp 112×112, до 12 КБ', () => {
    const ids = SKINS.map((s) => s.id);
    const withThumb = Object.keys(SKIN_THUMBS);
    expect(withThumb.length).toBeGreaterThanOrEqual(9);
    for (const id of withThumb) {
      expect(ids, id).toContain(id);
      expect(SKIN_THUMBS[id as keyof typeof SKIN_THUMBS], id).toContain(`${id}-thumb`);
      const file = bytes(`./assets/skins/art/${id}-thumb.webp`);
      expect(file.length, id).toBeLessThanOrEqual(12 * KB);
      expect(file.subarray(8, 12).toString('latin1'), id).toBe('WEBP');
    }
    expect(withThumb).not.toContain('classic');
  });
});
