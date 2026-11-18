import { describe, expect, it } from 'vitest';
import { startSeason } from './engine';
import { SEASON_PRESETS } from './presets';
import { SEASON_PREFS } from './season';

describe('описания сезонов', () => {
  it('у каждого сезона из настроек есть описание; числа разумные', () => {
    const seasons = SEASON_PREFS.filter((p) => p !== 'auto' && p !== 'off');
    expect(Object.keys(SEASON_PRESETS).sort()).toEqual([...seasons].sort());
    for (const [name, p] of Object.entries(SEASON_PRESETS)) {
      // частиц немного: каждая — отдельный слой, который двигает браузер
      expect(p.count, name).toBeGreaterThanOrEqual(8);
      expect(p.count, name).toBeLessThanOrEqual(50);
      expect(p.size[0], name).toBeLessThanOrEqual(p.size[1]);
      expect(p.alpha[0], name).toBeLessThanOrEqual(p.alpha[1]);
      expect(p.alpha[1], name).toBeLessThanOrEqual(1);
      expect(p.vy[0], `${name}: падает вниз`).toBeGreaterThan(0);
      expect(p.vy[0], name).toBeLessThanOrEqual(p.vy[1]);
      // ложится на блоки только то, что вообще ложится: у «ничего» доля нулевая
      if (p.pile === 'none') expect(p.stick, name).toBe(0);
      else expect(p.stick, name).toBeGreaterThan(0);
      expect(p.stick, name).toBeLessThanOrEqual(1);
      expect(p.gravity, name).toBeGreaterThan(0);
    }
  });

  it('сугробом лежит только снег, остальное — россыпью, а летом не лежит ничего; у каждого сезона своё украшение', () => {
    expect(Object.entries(SEASON_PRESETS).map(([name, p]) => [name, p.pile, p.accent])).toEqual([
      ['winter', 'cap', 'frost'],
      ['spring', 'scatter', 'sprout'],
      ['summer', 'none', 'none'],
      ['autumn', 'scatter', 'leaves'],
    ]);
    expect(SEASON_PRESETS.winter.grow).toBeGreaterThan(0);
  });

  it('летом — жара: марево поверх страницы; пуха мало, он только летает', () => {
    expect(Object.entries(SEASON_PRESETS).filter(([, p]) => p.haze).map(([name]) => name)).toEqual(['summer']);
    // пуха заметно меньше, чем снега или листьев
    expect(SEASON_PRESETS.summer.count).toBeLessThanOrEqual(10);
    expect(SEASON_PRESETS.summer.count).toBeLessThan(SEASON_PRESETS.autumn.count);
  });
});

describe('startSeason без Web Animations', () => {
  it('в среде, где элементы не умеют анимироваться, ничего не создаёт и не падает: эффект — украшение', () => {
    const sky = document.createElement('div');
    const ground = document.createElement('div');
    expect(typeof sky.animate).not.toBe('function'); // так в тестовой среде и в очень старых браузерах
    const stop = startSeason(sky, ground, 'winter');
    expect(sky.childElementCount).toBe(0);
    expect(ground.childElementCount).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});
