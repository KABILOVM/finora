import { describe, expect, it } from 'vitest';
import { startSeason } from './engine';
import { SEASON_PRESETS } from './presets';
import { SEASON_PREFS } from './season';

describe('описания сезонов', () => {
  it('у каждого сезона и каждой погоды есть описание; числа разумные', () => {
    const seasons = SEASON_PREFS.filter((p) => p !== 'auto' && p !== 'off');
    expect(Object.keys(SEASON_PRESETS).sort()).toEqual([...seasons, 'rain', 'downpour', 'blizzard'].sort());
    for (const [name, p] of Object.entries(SEASON_PRESETS)) {
      // частиц немного: каждая — отдельный слой, который двигает браузер
      expect(p.count, name).toBeGreaterThanOrEqual(8);
      expect(p.count, name).toBeLessThanOrEqual(70);
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

  it('сугробом лежит только снег, остальное — россыпью, летом не лежит ничего, дождь только брызгает; у каждого сезона своё украшение', () => {
    expect(Object.entries(SEASON_PRESETS).map(([name, p]) => [name, p.pile, p.accent])).toEqual([
      ['winter', 'cap', 'frost'],
      ['spring', 'scatter', 'sprout'],
      ['summer', 'none', 'none'],
      ['autumn', 'scatter', 'leaves'],
      ['rain', 'splash', 'none'],
      ['downpour', 'splash', 'none'],
      ['blizzard', 'cap', 'frost'],
    ]);
    expect(SEASON_PRESETS.winter.grow).toBeGreaterThan(0);
  });

  it('летом — жара, пуха мало и он только летает; в дождь — пелена, в метель — порывы', () => {
    expect(Object.entries(SEASON_PRESETS).map(([name, p]) => [name, p.mood])).toEqual([
      ['winter', null],
      ['spring', null],
      ['summer', 'heat'],
      ['autumn', null],
      ['rain', 'mist'],
      ['downpour', 'mist'],
      ['blizzard', 'blow'],
    ]);
    expect(SEASON_PRESETS.summer.count).toBeLessThanOrEqual(10);
    expect(SEASON_PRESETS.summer.count).toBeLessThan(SEASON_PRESETS.autumn.count);
  });

  it('дождь — быстрые косые капли, ливень гуще и быстрее; метель гуще, быстрее и злее снегопада, сугроб растёт быстрее', () => {
    const { rain, downpour, winter, blizzard } = SEASON_PRESETS;
    expect(rain.along).toBe(true);
    expect(downpour.along).toBe(true);
    expect(rain.vy[0]).toBeGreaterThan(400);
    expect(rain.vx[0]).toBeGreaterThan(0); // ветер дует в одну сторону: капли косые
    expect(downpour.count).toBeGreaterThan(rain.count);
    expect(downpour.vy[0]).toBeGreaterThan(rain.vy[0]);
    expect(blizzard.count).toBeGreaterThan(winter.count);
    expect(blizzard.vy[1]).toBeGreaterThan(winter.vy[1] * 3);
    expect(blizzard.vx[0]).toBeGreaterThan(winter.vx[1]); // ветер сильнее обычного покачивания
    expect(blizzard.grow).toBeGreaterThan(winter.grow);
    expect(blizzard.stick).toBeGreaterThan(winter.stick);
    expect(blizzard.along).toBe(true); // снег в метель вытянут по ветру: видна скорость
    expect(winter.along).toBe(false);
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
