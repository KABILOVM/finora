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
  it('картинка на карточке есть у всех образов, кроме «Классики» (там обычный цвет без картинки)', () => {
    const ids = SKINS.map((s) => s.id).filter((id) => id !== 'classic');
    expect(artSkins.map((s) => s.id).sort()).toEqual([...ids].sort());
    expect(ids).toHaveLength(23);
  });

  it('каждая картинка — webp 640×320 из assets/skins/art, файл есть и не тяжелее 45 КБ; рядом задан --skin-art-content', () => {
    for (const skin of artSkins) {
      const body = extras(skin.id);
      const url = body.match(/--skin-art: url\('\.\/(assets\/skins\/art\/[a-z0-9-]+-hero\.webp)'\);/)?.[1];
      expect(url, `--skin-art у ${skin.id}`).toBe(`assets/skins/art/${skin.id}-hero.webp`);
      expect(body, `--skin-art-content у ${skin.id}`).toContain("--skin-art-content: '';");
      const file = bytes(`./${url}`);
      expect(file.length, `${skin.id}: размер`).toBeLessThanOrEqual(45 * KB);
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
    // слой по высоте карточки: картинка 2:1 не растягивается на широкой карточке и не уезжает под текст
    expect(rule).toContain('right center / auto 100% no-repeat');
  });

  it('картинки образов не попадают в офлайн-кэш: webp, jpg и jpeg нет в globPatterns, а в сборке webp всегда отдельным файлом', () => {
    const globs = viteConfig.match(/globPatterns: \[([^\]]*)\]/)?.[1] ?? '';
    expect(globs).toContain('js,css,html');
    for (const ext of ['webp', 'jpg', 'jpeg', 'avif']) expect(globs.includes(ext), ext).toBe(false);
    expect(viteConfig).toMatch(/assetsInlineLimit: \(file\) => \(file\.endsWith\('\.woff2'\) \|\| file\.endsWith\('\.webp'\)/);
  });

  it('гербы в углу карточки (--skin-mark) у Барселоны и Реала — webp до 30 КБ', () => {
    for (const id of ['barca', 'real']) {
      const url = extras(id).match(/--skin-mark: url\('\.\/(assets\/skins\/art\/[a-z0-9-]+-mark\.webp)'\);/)?.[1];
      expect(url, id).toBe(`assets/skins/art/${id}-mark.webp`);
      expect(bytes(`./${url}`).length, id).toBeLessThanOrEqual(30 * KB);
    }
  });

  it('там, где на карточке картинка (герой, фото, флаг), водяной знак в углу не рисуется поверх неё; он остался только у клубов и «Акацуки»', () => {
    for (const id of ['akatsuki', 'barca', 'real']) expect(extras(id).includes('--skin-mark:'), id).toBe(true);
    for (const id of ['messi', 'shinobi', 'spider', 'tajik', 'argentina', 'football', 'comic', 'kawaii', 'racing', 'spain', 'cr7']) {
      const body = extras(id);
      expect(body.includes('--skin-mark:'), `${id}: --skin-mark`).toBe(false);
      expect(body.includes('--skin-mark-text:'), `${id}: --skin-mark-text`).toBe(false);
    }
  });
});

describe('значки образов в настройках', () => {
  it('значок есть у каждого образа, включая «Классику»: файл на месте, webp 112×112, до 12 КБ, и у всех образов разные', () => {
    const ids = SKINS.map((s) => s.id);
    expect(Object.keys(SKIN_THUMBS).sort()).toEqual([...ids].sort());
    expect(ids).toHaveLength(24);
    for (const id of ids) {
      expect(SKIN_THUMBS[id], id).toContain(`${id}-thumb`);
      const file = bytes(`./assets/skins/art/${id}-thumb.webp`);
      expect(file.length, id).toBeLessThanOrEqual(12 * KB);
      expect(file.subarray(8, 12).toString('latin1'), id).toBe('WEBP');
    }
    expect(new Set(ids.map((id) => bytes(`./assets/skins/art/${id}-thumb.webp`).toString('base64'))).size).toBe(ids.length);
  });
});
