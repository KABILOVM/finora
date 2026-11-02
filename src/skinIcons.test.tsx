import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Icon } from '@/components/Icon';
import { setSkinIconPack } from '@/components/skinIconStore';
import { act, render, waitFor } from '@/components/testUtils';
import { DUO } from '@/components/iconData';
import { SKIN_ICON_PACKS } from './skinCore';
import { SKINS } from './skins';
import { ICON_GEOMETRY, ICON_STYLES, lineMarkup, PIXEL_BITMAPS, pixelMarkup, SKIN_ICON_STYLE, skinIconPack, type IconStyleId } from './skinIcons';
import { saveSkinPref } from './theme';

const reset = () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  setSkinIconPack(null, null);
};
beforeEach(reset);
afterEach(reset);

const parse = (markup: string): Document => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
const iconHtml = (name: 'home' | 'cart'): string => render(<Icon name={name} />).container.innerHTML;

describe('наборы значков образов: «Пиксель»', () => {
  const names = Object.keys(PIXEL_BITMAPS);

  it('каждая картинка — 12×12, только «#», «+» и «.», и в ней есть сплошные пиксели', () => {
    for (const name of names) {
      const rows = PIXEL_BITMAPS[name] ?? [];
      expect(rows, name).toHaveLength(12);
      for (const row of rows) expect(row, `${name}: ${row}`).toMatch(/^[#+.]{12}$/);
      expect(rows.join('').includes('#'), name).toBe(true);
    }
  });

  it('значков хватает для нижней панели и главных категорий, и все они из встроенных двухтонных (есть что подменять)', () => {
    for (const name of ['home', 'list', 'pie', 'chart', 'more', 'cart', 'food', 'cup', 'bus', 'car', 'heart', 'gift', 'wallet']) expect(names, name).toContain(name);
    for (const name of names) expect(name in DUO, `${name} — не встроенный двухтонный значок`).toBe(true);
    expect(names.length).toBeGreaterThanOrEqual(18);
  });

  it('разметка каждого значка разбирается как SVG и укладывается в сетку 24×24', () => {
    const pack = skinIconPack('pixel') ?? {};
    expect(Object.keys(pack).sort()).toEqual([...names].sort());
    for (const [name, markup] of Object.entries(pack)) {
      const doc = parse(markup);
      expect(doc.querySelector('parsererror'), name).toBeNull();
      const d = [...doc.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '').join('');
      // все квадраты начинаются в пределах 24×24, ничего не торчит за край
      for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v2h-\d+z/g)) {
        expect(Number(m[1]) + Number(m[3]), `${name}: ширина`).toBeLessThanOrEqual(24);
        expect(Number(m[2]) + 2, `${name}: высота`).toBeLessThanOrEqual(24);
      }
    }
  });

  it('pixelMarkup: подряд идущие пиксели одной строки склеиваются, полупрозрачные идут отдельным путём', () => {
    expect(pixelMarkup(['##.#', '.+..'])).toBe('<g fill="currentColor"><path d="M2 2h2v2h-2z" opacity=".5"/><path d="M0 0h4v2h-4zM6 0h2v2h-2z"/></g>');
    expect(pixelMarkup(['#'])).toBe('<g fill="currentColor"><path d="M0 0h2v2h-2z"/></g>');
  });

  it('набор есть у каждого образа, кроме «Классики»: SKIN_ICON_PACKS, SKIN_ICON_STYLE и список образов совпадают', () => {
    const ids = SKINS.map((s) => s.id).filter((id) => id !== 'classic');
    expect([...SKIN_ICON_PACKS].sort()).toEqual([...ids].sort());
    expect(Object.keys(SKIN_ICON_STYLE).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(skinIconPack(id), id).toBeDefined();
    expect(skinIconPack('classic')).toBeUndefined();
  });
});

describe('линейные наборы: общий рисунок и пять стилей', () => {
  const geometry = Object.keys(ICON_GEOMETRY);
  const styles = Object.keys(ICON_STYLES) as IconStyleId[];

  it('рисунков не меньше 24, все — встроенные двухтонные значки, и у каждого есть хотя бы один путь', () => {
    expect(geometry.length).toBeGreaterThanOrEqual(24);
    for (const name of geometry) {
      expect(name in DUO, `${name} — не встроенный двухтонный значок`).toBe(true);
      expect(ICON_GEOMETRY[name]?.length, name).toBeGreaterThan(0);
      for (const d of ICON_GEOMETRY[name] ?? []) expect(d, name).toMatch(/^M[-\d. ]/);
    }
    // линейные наборы закрывают всё, что нарисовано пикселями (нижняя панель и главные категории)
    for (const name of Object.keys(PIXEL_BITMAPS)) expect(geometry, name).toContain(name);
  });

  it('разметка каждого значка в каждом стиле разбирается как SVG, без «NaN» и «undefined»', () => {
    for (const style of styles) {
      for (const name of geometry) {
        const markup = lineMarkup(ICON_GEOMETRY[name] ?? [], style);
        expect(parse(markup).querySelector('parsererror'), `${style}/${name}`).toBeNull();
        expect(markup, `${style}/${name}`).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('стили различаются между собой, и каждый стиль достался хотя бы одному образу', () => {
    const sample = ICON_GEOMETRY.home ?? [];
    expect(new Set(styles.map((st) => lineMarkup(sample, st))).size).toBe(styles.length);
    const used = new Set(Object.values(SKIN_ICON_STYLE));
    for (const style of styles) expect(used.has(style), style).toBe(true);
    expect(used.has('pixel')).toBe(true);
  });

  it('образы с одним стилем получают один и тот же набор, образы с разными — разные', () => {
    expect(skinIconPack('cyber')).toEqual(skinIconPack('spider'));
    expect(skinIconPack('barca')).toEqual(skinIconPack('messi'));
    expect(skinIconPack('cyber')).not.toEqual(skinIconPack('racing'));
    expect(skinIconPack('kawaii')).not.toEqual(skinIconPack('real'));
  });

  it('точки («M6 12h.01») рисуются толще линии, а стиль с заливкой красит фигуры мягким оттенком', () => {
    expect(lineMarkup(['M6 12h.01'], 'fine')).toContain('stroke-width="3.1"');
    expect(lineMarkup(['M6 12h.01'], 'sharp')).toContain('stroke-width="4.4"'); // у толстой линии точка не шире 4,4: три точки не слипаются
    expect(lineMarkup(['M4 4h4v4z'], 'sport')).toContain('fill-opacity="0.2"');
    expect(lineMarkup(['M4 4h4v4z'], 'fine')).toContain('fill="none"');
  });
});

describe('Icon берёт рисунок из набора образа', () => {
  it('со набором значок заменён, без него — прежний; у значка без замены ничего не меняется', () => {
    const before = iconHtml('home');
    const cartBefore = iconHtml('cart');
    setSkinIconPack({ home: pixelMarkup(['#']) }, 'test');
    document.body.innerHTML = '';
    expect(iconHtml('home')).not.toBe(before);
    expect(iconHtml('home')).toContain('M0 0h2v2h-2z');
    document.body.innerHTML = '';
    expect(iconHtml('cart')).toBe(cartBefore);
    setSkinIconPack(null, null);
    document.body.innerHTML = '';
    expect(iconHtml('home')).toBe(before);
  });

  it('значок, уже стоящий на экране, перерисовывается сам, когда набор приходит или уходит', () => {
    const { container } = render(<Icon name="home" />);
    const before = container.innerHTML;
    act(() => setSkinIconPack({ home: pixelMarkup(['#']) }, 'test'));
    expect(container.innerHTML).not.toBe(before);
    act(() => setSkinIconPack(null, null));
    expect(container.innerHTML).toBe(before);
  });
});

describe('выбор образа подгружает набор значков', () => {
  it('«Пиксель» ставит пиксельный набор, другой образ — свой, «Классика» убирает набор', async () => {
    const { container } = render(<Icon name="home" />);
    const plain = container.innerHTML;
    saveSkinPref('pixel');
    await waitFor(() => expect(container.innerHTML).toContain('v2h-'));
    saveSkinPref('barca');
    await waitFor(() => expect(container.innerHTML).toContain('stroke-linecap'));
    expect(container.innerHTML).not.toContain('v2h-');
    act(() => saveSkinPref('classic'));
    await waitFor(() => expect(container.innerHTML).toBe(plain));
  });

  it('если образ успели сменить до прихода файла, чужой набор не ставится', async () => {
    const { container } = render(<Icon name="home" />);
    const plain = container.innerHTML;
    saveSkinPref('pixel');
    saveSkinPref('classic'); // сразу передумали
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe(plain);
  });
});
