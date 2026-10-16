import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseWeather, readWeather, stringifyWeather, WEATHER_MAX_CHARS, WEATHER_MAX_CITIES, type WeatherCity, type WeatherPlaces } from './weatherPlaces';

const city = (n: number, over: Partial<WeatherCity> = {}): WeatherCity => ({ id: `${n}.00,${n}.00`, name: `Город ${n}`, region: 'Область', lat: n, lon: n, ...over });
const places = (n = 2): WeatherPlaces => ({ selected: city(1).id, cities: Array.from({ length: n }, (_, i) => city(i + 1)) });

describe('stringifyWeather / readWeather', () => {
  it('круговой обмен: что записали, то и прочитали', () => {
    const p = places(3);
    expect(readWeather(stringifyWeather(p))).toEqual({ ok: true, places: p });
  });
  it('«я здесь» и «ничего не выбрано» сохраняются', () => {
    const p: WeatherPlaces = { selected: null, cities: [city(1), city(2, { here: true, name: 'Моё местоположение', region: '' })] };
    expect(parseWeather(stringifyWeather(p))).toEqual(p);
  });
  it('канонический текст: одинаковое содержимое — одинаковый текст, порядок ключей не зависит от входа', () => {
    const a = stringifyWeather({ selected: 'x', cities: [{ lon: 1, lat: 2, region: '', name: 'Х', id: 'x' }] });
    const b = stringifyWeather({ selected: 'x', cities: [{ id: 'x', name: 'Х', region: '', lat: 2, lon: 1 }] });
    expect(a).toBe(b);
    expect(stringifyWeather(parseWeather(a)!)).toBe(a); // повторная запись ничего не меняет
  });
  it('управляющие символы в названии убираются, пробелы по краям тоже', () => {
    const p = parseWeather(stringifyWeather({ selected: null, cities: [city(1, { name: '  До\u0001\u0000ш  ', region: 'Р\nег' })] }))!;
    expect(p.cities[0]).toMatchObject({ name: 'Дош', region: 'Рег' });
  });
  it('границы: 8 городов можно, 9 нельзя, 0 нельзя', () => {
    expect(readWeather(stringifyWeather(places(WEATHER_MAX_CITIES))).ok).toBe(true);
    expect(() => stringifyWeather(places(WEATHER_MAX_CITIES + 1))).toThrow(/городов должно быть/);
    expect(() => stringifyWeather({ selected: null, cities: [] })).toThrow(/городов должно быть/);
  });
  it('границы названия: 80 знаков можно (считаются символы, а не половинки пар), 81 нельзя, пустое нельзя', () => {
    expect(readWeather(stringifyWeather({ selected: null, cities: [city(1, { name: '🌤'.repeat(80) })] })).ok).toBe(true);
    expect(() => stringifyWeather({ selected: null, cities: [city(1, { name: '🌤'.repeat(81) })] })).toThrow(/название/);
    expect(() => stringifyWeather({ selected: null, cities: [city(1, { name: '   ' })] })).toThrow(/название/);
    expect(() => stringifyWeather({ selected: null, cities: [city(1, { region: 'я'.repeat(121) })] })).toThrow(/регион/);
  });
  it('координаты: на границах можно, за ними, NaN и бесконечность нельзя', () => {
    expect(readWeather(stringifyWeather({ selected: null, cities: [city(1, { lat: 90, lon: -180 })] })).ok).toBe(true);
    for (const bad of [{ lat: 90.01 }, { lat: -91 }, { lon: 180.5 }, { lon: -181 }]) {
      expect(() => stringifyWeather({ selected: null, cities: [city(1, bad)] }), JSON.stringify(bad)).toThrow(/вне диапазона/);
    }
    expect(() => stringifyWeather({ selected: null, cities: [city(1, { lat: Number.NaN })] })).toThrow();
    expect(() => stringifyWeather({ selected: null, cities: [city(1, { lon: Number.POSITIVE_INFINITY })] })).toThrow();
  });
  it('повторы идентификаторов, два «я здесь» и выбранный не из списка — отказ', () => {
    expect(() => stringifyWeather({ selected: null, cities: [city(1), city(1)] })).toThrow(/повторяются/);
    expect(() => stringifyWeather({ selected: null, cities: [city(1, { here: true }), city(2, { here: true })] })).toThrow(/только одно/);
    expect(() => stringifyWeather({ selected: 'нет такого', cities: [city(1)] })).toThrow(/нет в списке/);
  });
  it('любой допустимый набор укладывается в лимит текста даже при самых «тяжёлых» знаках', () => {
    const heavy = (n: number) => city(n, { name: '"\\'.repeat(40), region: '"\\'.repeat(60) });
    const p: WeatherPlaces = { selected: heavy(1).id, cities: Array.from({ length: WEATHER_MAX_CITIES }, (_, i) => heavy(i + 1)) };
    expect(stringifyWeather(p).length).toBeLessThanOrEqual(WEATHER_MAX_CHARS);
  });
});

describe('мягкое чтение: мусор — «ничего не выбрано», а не ошибка', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['пусто', ''],
    ['не JSON', '{'],
    ['число', '5'],
    ['массив', '[]'],
    ['версия 2', '{"v":2,"selected":null,"cities":[]}'],
    ['без городов', '{"v":1,"selected":null}'],
    ['город-строка', '{"v":1,"selected":null,"cities":["Душанбе"]}'],
    ['слишком длинное', ' '.repeat(WEATHER_MAX_CHARS + 1)],
  ])('%s', (_n, text) => {
    expect(parseWeather(text as never)).toBeNull();
  });
  it('readWeather не бросает ни на каких входных типах', () => {
    fc.assert(fc.property(fc.anything(), (v) => typeof readWeather(v).ok === 'boolean'));
  });
  it('свойство: любой набор, который принял stringify, читается обратно без потерь', () => {
    const arbCity = fc.record({
      n: fc.integer({ min: 1, max: 20 }),
      name: fc.string({ minLength: 1, maxLength: 20 }),
      region: fc.string({ maxLength: 20 }),
      lat: fc.double({ min: -90, max: 90, noNaN: true }),
      lon: fc.double({ min: -180, max: 180, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(arbCity, { minLength: 1, maxLength: 8 }), (raw) => {
        const cities = raw.map((r, i) => ({ id: `${i}`, name: r.name, region: r.region, lat: r.lat, lon: r.lon }));
        let text: string;
        try {
          text = stringifyWeather({ selected: cities[0]!.id, cities });
        } catch {
          return; // например, название из одних пробелов — отказ допустим
        }
        const back = parseWeather(text)!;
        // «+ 0»: в тексте JSON минус-ноль записывается как 0
        expect(back.cities.map((c) => [c.id, c.lat, c.lon])).toEqual(cities.map((c) => [c.id, c.lat + 0, c.lon + 0]));
        expect(stringifyWeather(back)).toBe(text);
      }),
    );
  });
});
