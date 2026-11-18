import { describe, expect, it } from 'vitest';
import { activeSeason, isSeasonPref, SEASON_PREFS, seasonOf, type SeasonPref } from './season';

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe('seasonOf: время года по дате', () => {
  it('календарные сезоны: декабрь–февраль зима, март–май весна, июнь–август лето, сентябрь–ноябрь осень', () => {
    expect(['2026-12-15', '2027-01-15', '2027-02-15'].map((s) => seasonOf(d(s)))).toEqual(['winter', 'winter', 'winter']);
    expect(['2026-03-15', '2026-04-15', '2026-05-15'].map((s) => seasonOf(d(s)))).toEqual(['spring', 'spring', 'spring']);
    expect(['2026-06-15', '2026-07-15', '2026-08-15'].map((s) => seasonOf(d(s)))).toEqual(['summer', 'summer', 'summer']);
    expect(['2026-09-15', '2026-10-15', '2026-11-15'].map((s) => seasonOf(d(s)))).toEqual(['autumn', 'autumn', 'autumn']);
  });

  it('границы: 30 ноября ещё осень, 1 декабря зима; 29 февраля зима, 1 марта весна', () => {
    expect(seasonOf(d('2026-11-30'))).toBe('autumn');
    expect(seasonOf(d('2026-12-01'))).toBe('winter');
    expect(seasonOf(d('2028-02-29'))).toBe('winter');
    expect(seasonOf(d('2028-03-01'))).toBe('spring');
    expect(seasonOf(d('2026-05-31'))).toBe('spring');
    expect(seasonOf(d('2026-06-01'))).toBe('summer');
    expect(seasonOf(d('2026-08-31'))).toBe('summer');
    expect(seasonOf(d('2026-09-01'))).toBe('autumn');
  });
});

describe('isSeasonPref', () => {
  it('принимает только известные значения', () => {
    expect(SEASON_PREFS).toEqual(['auto', 'winter', 'spring', 'summer', 'autumn', 'off']);
    for (const p of SEASON_PREFS) expect(isSeasonPref(p)).toBe(true);
    for (const bad of [null, '', 'snow', 'AUTO', 'on']) expect(isSeasonPref(bad)).toBe(false);
  });
});

describe('activeSeason: какой сезонный эффект показать', () => {
  const NOV = d('2026-11-18');
  const JAN = d('2027-01-10');
  const on = (over: Partial<{ pref: SeasonPref; fx: boolean; reduced: boolean; scene: string; now: Date }> = {}) =>
    activeSeason({ pref: 'auto', fx: true, reduced: false, scene: 'aurora', now: NOV, ...over });

  it('«Авто» — сезон по дате', () => {
    expect(on()).toBe('autumn');
    expect(on({ now: JAN })).toBe('winter');
  });

  it('выбранный сезон показывается в любое время года', () => {
    expect(on({ pref: 'winter' })).toBe('winter');
    expect(on({ pref: 'summer', now: JAN })).toBe('summer');
  });

  it('ничего: «Выкл», эффекты выключены или у устройства «уменьшить движение»', () => {
    expect(on({ pref: 'off' })).toBeNull();
    expect(on({ fx: false })).toBeNull();
    expect(on({ reduced: true })).toBeNull();
    expect(on({ pref: 'winter', fx: false })).toBeNull();
    expect(on({ pref: 'winter', reduced: true })).toBeNull();
  });

  it('«Авто» не трогает образ со своими частицами другого рода (звёзды, сердца): человек выбрал их сам', () => {
    expect(on({ scene: 'stars' })).toBeNull();
    expect(on({ scene: 'hearts', now: JAN })).toBeNull();
    // фоны, нарисованные в CSS (сетка, огни), и «нет фона» частиц не имеют — сезон виден
    for (const scene of ['none', 'aurora', 'grid', 'lights']) expect(on({ scene }), scene).toBe('autumn');
  });

  it('«Авто» заменяет частицы образа того же рода: снег зимой, лепестки весной, листья осенью', () => {
    expect(on({ scene: 'snow', now: JAN })).toBe('winter');
    expect(on({ scene: 'petals', now: d('2026-04-10') })).toBe('spring');
    expect(on({ scene: 'leaves' })).toBe('autumn');
    // снег образа летом остаётся снегом образа
    expect(on({ scene: 'snow', now: d('2026-07-10') })).toBeNull();
  });

  it('выбранный сезон показывается и поверх образа со своими частицами', () => {
    expect(on({ pref: 'winter', scene: 'stars' })).toBe('winter');
  });
});
