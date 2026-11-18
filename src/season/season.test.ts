import { describe, expect, it } from 'vitest';
import { activeSeason, isSeasonPref, SEASON_PREFS, seasonOf, weatherEffect, type SeasonKind, type SeasonPref } from './season';

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
  const on = (over: Partial<{ pref: SeasonPref; fx: boolean; reduced: boolean; scene: string; now: Date; weather: SeasonKind | null }> = {}) =>
    activeSeason({ pref: 'auto', fx: true, reduced: false, scene: 'aurora', now: NOV, weather: null, ...over });

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

describe('weatherEffect: что показать по коду погоды', () => {
  it('дождь любой силы — дождь, ливень и гроза — ливень', () => {
    for (const code of [51, 53, 55, 56, 57, 61, 63, 66, 67, 80]) expect(weatherEffect(code), String(code)).toBe('rain');
    for (const code of [65, 81, 82, 95, 96, 99]) expect(weatherEffect(code), String(code)).toBe('downpour');
  });

  it('слабый снег — обычный снегопад, сильный и снегопад — метель', () => {
    for (const code of [71, 77]) expect(weatherEffect(code), String(code)).toBe('winter');
    for (const code of [73, 75, 85, 86]) expect(weatherEffect(code), String(code)).toBe('blizzard');
  });

  it('ясно, облачно, туман, нет данных — погода эффекта не даёт (остаётся сезон по дате)', () => {
    for (const code of [0, 1, 2, 3, 45, 48, 4, 100, -1, Number.NaN]) expect(weatherEffect(code), String(code)).toBeNull();
    expect(weatherEffect(null)).toBeNull();
  });
});

describe('activeSeason с погодой', () => {
  const NOV = d('2026-11-18');
  const base = { pref: 'auto' as SeasonPref, fx: true, reduced: false, scene: 'aurora', now: NOV };

  it('«Авто»: погода главнее даты — дождь весной и осенью, метель летом', () => {
    expect(activeSeason({ ...base, weather: 'rain' })).toBe('rain');
    expect(activeSeason({ ...base, now: d('2026-04-10'), weather: 'rain' })).toBe('rain');
    expect(activeSeason({ ...base, now: d('2026-07-10'), weather: 'blizzard' })).toBe('blizzard');
    expect(activeSeason({ ...base, weather: null })).toBe('autumn');
  });

  it('выбранный вручную сезон погодой не перебивается; «Выкл», выключенные эффекты и «уменьшить движение» — тоже', () => {
    expect(activeSeason({ ...base, pref: 'summer', weather: 'rain' })).toBe('summer');
    expect(activeSeason({ ...base, pref: 'off', weather: 'rain' })).toBeNull();
    expect(activeSeason({ ...base, fx: false, weather: 'rain' })).toBeNull();
    expect(activeSeason({ ...base, reduced: true, weather: 'rain' })).toBeNull();
  });

  it('образ со своими частицами другого рода погодой тоже не трогается; свой дождь и снег — заменяются', () => {
    expect(activeSeason({ ...base, scene: 'stars', weather: 'rain' })).toBeNull();
    expect(activeSeason({ ...base, scene: 'rain', weather: 'downpour' })).toBe('downpour');
    expect(activeSeason({ ...base, scene: 'rain', weather: 'blizzard' })).toBeNull();
    expect(activeSeason({ ...base, scene: 'snow', weather: 'blizzard' })).toBe('blizzard');
    for (const scene of ['none', 'aurora', 'grid', 'lights']) expect(activeSeason({ ...base, scene, weather: 'rain' }), scene).toBe('rain');
  });
});
