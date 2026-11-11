import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@/components/testUtils';
import { saveFxPref, saveSkinPref } from '@/theme';
import { isCanvasScene, PRESETS } from './presets';
import { SceneHost } from './SceneHost';

const html = document.documentElement;
const reset = () => {
  vi.unstubAllGlobals();
  localStorage.clear();
  for (const a of ['data-skin', 'data-look', 'data-fx', 'data-scene', 'data-shape', 'data-material', 'data-nav', 'data-hero', 'data-motion', 'style']) html.removeAttribute(a);
  document.head.innerHTML = '';
};
beforeEach(reset);
afterEach(reset);

const layer = () => document.querySelector('[data-scene-layer]');

describe('живой фон образа', () => {
  it('у «Классики» слоя нет: её мягкое свечение — это фон страницы', () => {
    act(() => saveSkinPref('classic'));
    render(<SceneHost />);
    expect(layer()).toBeNull();
  });

  it('у образа с фоном слой есть, он украшение (aria-hidden) и меняется вместе с образом', () => {
    act(() => saveSkinPref('cyber'));
    render(<SceneHost />);
    expect(layer()?.getAttribute('data-scene-layer')).toBe('grid');
    expect(layer()?.getAttribute('aria-hidden')).toBe('true');
    act(() => saveSkinPref('barca'));
    expect(layer()?.getAttribute('data-scene-layer')).toBe('lights');
    act(() => saveSkinPref('notebook')); // у «Тетради» живого фона нет
    expect(layer()).toBeNull();
  });

  it('человек выключил эффекты — слоя нет; включил — вернулся', () => {
    act(() => saveSkinPref('cyber'));
    render(<SceneHost />);
    act(() => saveFxPref(false));
    expect(layer()).toBeNull();
    act(() => saveFxPref(true));
    expect(layer()).not.toBeNull();
  });

  it('у устройства включено «уменьшить движение» — слоя нет', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    act(() => saveSkinPref('cyber'));
    render(<SceneHost />);
    expect(layer()).toBeNull();
  });

  it('описания частиц: разумные числа, цвета — переменные темы или «R G B»', () => {
    for (const [name, p] of Object.entries(PRESETS)) {
      expect(p.count, name).toBeGreaterThan(5);
      expect(p.count, name).toBeLessThanOrEqual(70);
      expect(p.size[0], name).toBeLessThanOrEqual(p.size[1]);
      expect(p.alpha[1], name).toBeLessThanOrEqual(1);
      expect(p.tints.length, name).toBeGreaterThan(0);
      for (const t of p.tints) expect(t, name).toMatch(/^(brand|accent|line|text|income|expense|\d{1,3} \d{1,3} \d{1,3})$/);
      expect(isCanvasScene(name), name).toBe(true);
    }
    expect(isCanvasScene('grid')).toBe(false);
    expect(isCanvasScene('constructor')).toBe(false);
  });
});
