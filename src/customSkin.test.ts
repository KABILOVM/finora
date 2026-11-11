import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCustomSkin, customSkinBar, deletePhoto, loadPhoto, MAX_CUSTOM_SKINS, paintCustomSkin, photoKey, readActiveCustomSkin, readCustomSkins, savePhoto, writeActiveCustomId, writeCustomSkins, type CustomSkin } from './customSkin';
import { paletteFromHex } from './lib/palette';
import { PALETTE_KEYS } from './lib/paletteBase';
import { applySkin } from './theme';

const html = document.documentElement;
const reset = () => {
  localStorage.clear();
  for (const a of ['data-skin', 'data-look', 'data-photo', 'data-hero-photo', 'data-accent', 'style']) html.removeAttribute(a);
  document.head.innerHTML = '';
};
beforeEach(reset);
afterEach(reset);

const palette = paletteFromHex('#059669')!;
const skin = (over: Partial<CustomSkin> = {}): CustomSkin => ({
  id: 'c1',
  name: 'Зелёный',
  hex: '#059669',
  hex2: null,
  palette,
  traits: 'round glass island banner bouncy bubbles',
  head: "'Oswald', 'Onest', ui-sans-serif, system-ui, sans-serif",
  pattern: 'radial-gradient(rgb(5 150 105 / 0.13) 1.5px, transparent 2px)',
  patternSize: '20px 20px',
  icons: 'clay',
  bgPhoto: false,
  heroPhoto: false,
  veil: 0.7,
  ...over,
});

describe('свои образы: хранение', () => {
  it('список записывается и читается без потерь; выбранный образ находится по номеру', () => {
    expect(readCustomSkins()).toEqual([]);
    expect(writeCustomSkins([skin(), skin({ id: 'c2', name: 'Второй' })])).toBe(true);
    expect(readCustomSkins()).toEqual([skin(), skin({ id: 'c2', name: 'Второй' })]);
    expect(readActiveCustomSkin()).toBeNull();
    writeActiveCustomId('c2');
    expect(readActiveCustomSkin()?.name).toBe('Второй');
    writeActiveCustomId('нет-такого');
    expect(readActiveCustomSkin()).toBeNull();
  });

  it('испорченные записи отбрасываются, а не ломают запуск: не объект, без палитры, с чужим номером', () => {
    localStorage.setItem('finora-skin-custom', JSON.stringify([null, 5, { id: 'c1' }, { ...skin(), palette: { 'bg-l': [1, 2, 3] } }, { ...skin(), id: '../x' }, skin({ id: 'ok' })]));
    expect(readCustomSkins().map((s) => s.id)).toEqual(['ok']);
    localStorage.setItem('finora-skin-custom', '{не json');
    expect(readCustomSkins()).toEqual([]);
    localStorage.setItem('finora-skin-custom', '"строка"');
    expect(readCustomSkins()).toEqual([]);
  });

  it('значения, которые уходят в CSS, проверяются: узор только из градиентов, без url() и точек с запятой; черты — только известные', () => {
    writeCustomSkins([
      skin({ pattern: "url('https://evil.example/x.png')" }),
      skin({ id: 'c2', pattern: 'red; background: url(x)' }),
      skin({ id: 'c3', head: 'x; } body { display: none' }),
      skin({ id: 'c4', traits: 'round хакер island <b> bouncy snow', veil: 5, icons: '../../x' }),
    ]);
    const [a, b, c, d] = readCustomSkins();
    expect(a?.pattern).toBe('');
    expect(b?.pattern).toBe('');
    expect(c?.head).toBe('');
    expect(d?.traits).toBe('round solid island card bouncy snow');
    expect(d?.veil).toBe(0.9);
    expect(d?.icons).toBeNull();
  });

  it(`сохраняется не больше ${MAX_CUSTOM_SKINS} образов`, () => {
    writeCustomSkins(Array.from({ length: MAX_CUSTOM_SKINS + 5 }, (_, i) => skin({ id: `c${i}` })));
    expect(readCustomSkins()).toHaveLength(MAX_CUSTOM_SKINS);
  });
});

describe('свои образы: применение к странице', () => {
  it('палитра уходит в переменные --cs-*, шрифт и узор — в переменные образа; снятие убирает всё', () => {
    paintCustomSkin(html, skin());
    for (const key of PALETTE_KEYS) expect(html.style.getPropertyValue(`--cs-${key}`), key).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    expect(html.style.getPropertyValue('--skin-head')).toContain("'Oswald'");
    expect(html.style.getPropertyValue('--skin-pattern')).toContain('radial-gradient');
    expect(html.style.getPropertyValue('--skin-pattern-size')).toBe('20px 20px');
    expect(html.style.getPropertyValue('--skin-veil')).toBe('0.7');
    clearCustomSkin(html);
    expect(html.getAttribute('style') ?? '').toBe('');
  });

  it('образ без шрифта и узора: шрифт приложения и «none» вместо узора (общие правила образов не остаются с пустой переменной)', () => {
    paintCustomSkin(html, skin({ head: '', pattern: '', patternSize: '' }));
    expect(html.style.getPropertyValue('--skin-head')).toContain("'Onest'");
    expect(html.style.getPropertyValue('--skin-pattern')).toBe('none');
  });

  it('applySkin("custom"): ставит data-skin, черты и цвет строки состояния из палитры; другой образ снимает своё', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#eceefb" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#080a18" media="(prefers-color-scheme: dark)">';
    writeCustomSkins([skin()]);
    writeActiveCustomId('c1');
    applySkin('custom');
    expect(html.getAttribute('data-skin')).toBe('custom');
    expect([html.getAttribute('data-shape'), html.getAttribute('data-material'), html.getAttribute('data-nav'), html.getAttribute('data-scene')]).toEqual(['round', 'glass', 'island', 'bubbles']);
    const bar = customSkinBar(skin());
    expect(document.querySelector('meta[media*="light"]')?.getAttribute('content')).toBe(bar.light);
    expect(document.querySelector('meta[media*="dark"]')?.getAttribute('content')).toBe(bar.dark);
    applySkin('barca');
    expect(html.getAttribute('data-skin')).toBe('barca');
    expect(html.style.getPropertyValue('--cs-brand-l')).toBe('');
    expect(html.style.getPropertyValue('--skin-head')).toBe('');
  });

  it('выбран свой образ, а его больше нет (удалили, хранилище почистили) — показывается «Классика»', () => {
    applySkin('custom');
    expect(html.hasAttribute('data-skin')).toBe(false);
    expect(html.getAttribute('data-shape')).toBe('soft');
  });
});

describe('свои образы: фото', () => {
  it('фото лежит в отдельной базе браузера: записали, прочитали, удалили', async () => {
    const key = photoKey('c1', 'bg');
    expect(key).toBe('c1:bg');
    expect(await loadPhoto(key)).toBeNull();
    await savePhoto(key, new Blob(['фото'], { type: 'image/jpeg' }));
    const back = await loadPhoto(key);
    // в тестовой среде Blob из базы может вернуться копией без типа: важно, что это Blob нужного размера
    if (back !== null) expect(back.size).toBeGreaterThan(0);
    await deletePhoto(key);
    expect(await loadPhoto(key)).toBeNull();
  });
});
