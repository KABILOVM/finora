import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from './scene/presets';
import { DEFAULT_TRAITS, HEROES, MATERIALS, MOTIONS, NAVS, parseTraits, SCENES, SHAPES, skinTraits, traitsLine, type SkinTraits } from './skinCore';
import { SKINS } from './skins';
import { applySkin, saveSkinPref } from './theme';

/**
 * Черты образов (src/skinCore.ts) и их оформление (src/styles/look.css) должны совпадать: черта без правила в CSS ничего не меняет,
 * а правило для несуществующей черты — мёртвый код. CSS в тестах не подключается, поэтому файл читается как текст.
 */
// адрес собирается в функции: запись new URL('…css', import.meta.url) одной строкой сборщик принял бы за подключение файла
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');
const css = read('./styles/look.css');
const html = document.documentElement;
const ATTRS = ['data-skin', 'data-look', 'data-shape', 'data-material', 'data-nav', 'data-hero', 'data-motion', 'data-scene', 'data-accent', 'style'];
const reset = () => {
  localStorage.clear();
  for (const a of ATTRS) html.removeAttribute(a);
  document.head.innerHTML = '';
};
beforeEach(reset);
afterEach(reset);

const onPage = (): SkinTraits => parseTraits(['shape', 'material', 'nav', 'hero', 'motion', 'scene'].map((k) => html.getAttribute(`data-${k}`)).join(' '));

describe('черты образов', () => {
  it('у каждого образа шесть известных черт, и строка разбирается без потерь', () => {
    for (const skin of SKINS) {
      const t = skinTraits(skin.id);
      expect(SHAPES, skin.id).toContain(t.shape);
      expect(MATERIALS, skin.id).toContain(t.material);
      expect(NAVS, skin.id).toContain(t.nav);
      expect(HEROES, skin.id).toContain(t.hero);
      expect(MOTIONS, skin.id).toContain(t.motion);
      expect(SCENES, skin.id).toContain(t.scene);
      expect(parseTraits(traitsLine(t)), skin.id).toEqual(t);
    }
  });

  it('образы — не перекраска: наборов черт много, и каждое значение каждой черты кому-то досталось', () => {
    const lines = new Set(SKINS.filter((s) => !s.resolves).map((s) => traitsLine(skinTraits(s.id))));
    expect(lines.size).toBeGreaterThan(40);
    const used = <K extends keyof SkinTraits>(key: K) => new Set(SKINS.map((s) => skinTraits(s.id)[key]));
    expect([...used('shape')].sort()).toEqual([...SHAPES].sort());
    expect([...used('material')].sort()).toEqual([...MATERIALS].sort());
    expect([...used('nav')].sort()).toEqual([...NAVS].sort());
    expect([...used('hero')].sort()).toEqual([...HEROES].sort());
    expect([...used('motion')].sort()).toEqual([...MOTIONS].sort());
    expect([...used('scene')].sort()).toEqual([...SCENES].sort());
  });

  it('чужая или испорченная строка черт заменяется чертами «Классики», а не ломает страницу', () => {
    expect(parseTraits(null)).toEqual(DEFAULT_TRAITS);
    expect(parseTraits('')).toEqual(DEFAULT_TRAITS);
    expect(parseTraits('round что-то island <script> bouncy snow')).toEqual({ ...DEFAULT_TRAITS, shape: 'round', nav: 'island', motion: 'bouncy', scene: 'snow' });
  });

  it('выбор образа ставит его черты на <html>; «Классика» возвращает свои', () => {
    saveSkinPref('pixel');
    expect(onPage()).toEqual(skinTraits('pixel'));
    expect(html.getAttribute('data-shape')).toBe('square');
    saveSkinPref('classic');
    expect(onPage()).toEqual(DEFAULT_TRAITS);
  });

  it('«Классика (прежняя)»: палитры нет (data-skin не ставится, цвет от акцента), прежний вид включает data-look="legacy"', () => {
    localStorage.setItem('finora-accent', 'teal');
    applySkin('legacy');
    expect(html.hasAttribute('data-skin')).toBe(false);
    expect(html.getAttribute('data-look')).toBe('legacy');
    expect(html.getAttribute('data-accent')).toBe('teal');
    expect(html.getAttribute('data-hero')).toBe('gradient');
    applySkin('barca');
    expect(html.hasAttribute('data-look')).toBe(false);
  });
});

describe('оформление черт (src/styles/look.css)', () => {
  const has = (selector: string) => expect(css.includes(selector), selector).toBe(true);

  it('у каждого значения формы, материала, меню, карточки и движения (кроме значений «Классики») есть правило', () => {
    for (const v of SHAPES.filter((v) => v !== DEFAULT_TRAITS.shape)) has(`html[data-shape='${v}']`);
    for (const v of MATERIALS.filter((v) => v !== DEFAULT_TRAITS.material)) has(`html[data-material='${v}']`);
    for (const v of NAVS.filter((v) => v !== DEFAULT_TRAITS.nav)) has(`html[data-nav='${v}']`);
    for (const v of HEROES.filter((v) => v !== DEFAULT_TRAITS.hero && v !== 'gradient')) has(`html[data-hero='${v}']`);
    for (const v of MOTIONS.filter((v) => v !== DEFAULT_TRAITS.motion)) has(`html[data-motion='${v}']`);
  });

  it('клавиши суммы следуют материалу образа: у каждого материала свои --key-*, а в «Классике (прежней)» действуют классы самих клавиш', () => {
    for (const v of MATERIALS.filter((v) => v !== DEFAULT_TRAITS.material)) {
      const blocks = css.split(`html[data-material='${v}'] {`).slice(1).map((b) => b.slice(0, b.indexOf('}')));
      expect(blocks.some((b) => b.includes('--key-bg:')), `материал ${v}: клавиши`).toBe(true);
    }
    has("html:not([data-look='legacy']) .key {");
    has("html:not([data-look='legacy']) .amount-stage {");
    has("html:not([data-look='legacy']) .seg-thumb {");
    has("html:not([data-look='legacy']) .tx-sheet::before {");
    // без ползунка (прежний вид) выбранный вариант переключателя закрашен своим классом: ползунок по умолчанию спрятан
    expect(/\n\.seg-thumb \{\s*display: none;/.test(css)).toBe(true);
  });

  it('в CSS нет правил для черт, которых не существует', () => {
    const known: Record<string, readonly string[]> = { shape: SHAPES, material: MATERIALS, nav: NAVS, hero: HEROES, motion: MOTIONS };
    for (const m of css.matchAll(/html\[data-(shape|material|nav|hero|motion)='([a-z]+)'\]/g)) expect(known[m[1] ?? ''], m[0]).toContain(m[2]);
    for (const m of css.matchAll(/data-scene-layer='([a-z]+)'/g)) expect(SCENES, m[0]).toContain(m[1]);
  });

  it('каждый живой фон либо нарисован в CSS (слой data-scene-layer), либо описан частицами; «без фона» и «свечение» слоя не требуют', () => {
    for (const scene of SCENES) {
      if (scene === 'none' || scene === 'aurora') continue;
      const inCss = css.includes(`data-scene-layer='${scene}'`);
      expect(inCss || scene in PRESETS, scene).toBe(true);
      expect(inCss && scene in PRESETS, `${scene}: и в CSS, и частицами`).toBe(false);
    }
  });

  it('прежний вид возвращает прежние скругления, полупрозрачные карточки и прежнюю тень; выключенные эффекты гасят фон', () => {
    const legacy = css.match(/html\[data-look='legacy'\] \{([^}]*)\}/)?.[1] ?? '';
    expect(legacy).toContain('--r-card: 1.5rem;');
    expect(legacy).toContain('--card-bg: rgb(var(--surface) / 0.85);');
    expect(legacy).toContain('--shadow-card: 0 10px 34px -14px rgb(var(--glass-shadow) / 0.32), inset 0 1px 0 rgb(255 255 255 / 0.28);');
    expect(css).toMatch(/html\[data-fx='off'\] body::before,[\s\S]*?animation: none !important;/);
  });

  it('предпросмотр образа: элемент с data-skin-scope заново выводит токены темы из палитры (светлая, тёмная и «как в системе»)', () => {
    expect(css).toMatch(/\n\[data-skin-scope\] \{[^}]*--brand: var\(--ac-brand-l\);/);
    expect(css).toMatch(/:root\[data-theme='dark'\] \[data-skin-scope\] \{[^}]*--brand: var\(--ac-brand-d\);/);
    expect(css).toMatch(/:root:not\(\[data-theme\]\) \[data-skin-scope\] \{[^}]*--brand: var\(--ac-brand-d\);/);
  });
});
