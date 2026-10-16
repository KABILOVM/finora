import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { cityId, type City } from './api';
import { cityFromCoords } from './geolocation';
import { rememberCity, withCity, withoutCity } from './places';
import { DEFAULT_CITIES, loadChosenCity, loadCities, loadSelected, MAX_CITIES } from './store';

const city = (n: number, over: Partial<City> = {}): City => ({ id: cityId(n, n), name: `Город ${n}`, region: '', lat: n, lon: n, ...over });
const here = (lat: number, lon: number): City => cityFromCoords(lat, lon)!;
const ids = (list: readonly City[]) => list.map((c) => c.id);

describe('withCity', () => {
  it('новый город добавляется в конец и выбирается', () => {
    const r = withCity([city(1)], city(2));
    expect(ids(r!.cities)).toEqual([city(1).id, city(2).id]);
    expect(r!.selectedId).toBe(city(2).id);
  });
  it('тот же город под своим названием второй раз не добавляется, а выбирается', () => {
    const r = withCity([city(1), city(2)], city(1, { name: 'Другое имя' }));
    expect(r!.cities).toHaveLength(2);
    expect(r!.selectedId).toBe(city(1).id);
    expect(r!.cities[0]!.name).toBe('Город 1');
  });
  it('«я здесь» заменяет прежнее «я здесь», а не копится', () => {
    const first = here(10, 10);
    const second = here(20, 20);
    const r = withCity([city(1), first], second)!;
    expect(ids(r.cities)).toEqual([city(1).id, second.id]);
    expect(r.selectedId).toBe(second.id);
  });
  it('геолокация попала на уже сохранённый город — выбирается он, имя не затирается', () => {
    const khujand = DEFAULT_CITIES[1]!;
    const r = withCity([...DEFAULT_CITIES], here(khujand.lat, khujand.lon))!;
    expect(r.cities).toHaveLength(DEFAULT_CITIES.length);
    expect(r.selectedId).toBe(khujand.id);
    expect(r.cities.some((c) => c.here)).toBe(false);
  });
  it('найденный по названию город заменяет «я здесь» с теми же координатами', () => {
    const h = here(5, 5);
    const named = { ...city(5), id: h.id };
    const r = withCity([city(1), h], named)!;
    expect(r.cities.map((c) => c.name)).toEqual(['Город 1', 'Город 5']);
    expect(r.cities.some((c) => c.here)).toBe(false);
  });
  it('список полон: новый город не помещается, а «я здесь» заменяет прежнее «я здесь»', () => {
    const full = Array.from({ length: MAX_CITIES }, (_, i) => city(i + 1));
    expect(withCity(full, city(99))).toBeNull();
    expect(withCity(full, here(50, 50))).toBeNull();
    const fullWithHere = [...full.slice(0, MAX_CITIES - 1), here(30, 30)];
    const r = withCity(fullWithHere, here(31, 31))!;
    expect(r.cities).toHaveLength(MAX_CITIES);
    expect(r.cities.filter((c) => c.here)).toHaveLength(1);
  });
  it('свойство: идентификаторы в списке всегда разные, «я здесь» не больше одного, выбранный есть в списке, длина ≤ 8', () => {
    const arbCity = fc.record({ n: fc.integer({ min: 1, max: 12 }), h: fc.boolean() }).map(({ n, h }) => (h ? here(n, n) : city(n)));
    fc.assert(
      fc.property(fc.array(arbCity, { maxLength: 30 }), (adds) => {
        let list: City[] = [];
        for (const c of adds) {
          const r = withCity(list, c);
          if (!r) continue;
          list = r.cities;
          expect(new Set(ids(list)).size).toBe(list.length);
          expect(list.filter((x) => x.here).length).toBeLessThanOrEqual(1);
          expect(ids(list)).toContain(r.selectedId);
          expect(list.length).toBeLessThanOrEqual(MAX_CITIES);
        }
      }),
    );
  });
});

describe('withoutCity', () => {
  it('убирает город; выбранный заменяется первым из оставшихся, невыбранный не трогает выбор', () => {
    const list = [city(1), city(2), city(3)];
    expect(withoutCity(list, city(2).id, city(2).id)).toMatchObject({ selectedId: city(1).id });
    expect(withoutCity(list, city(1).id, city(3).id)).toMatchObject({ selectedId: city(1).id });
  });
  it('последний город и неизвестный город не убираются', () => {
    expect(withoutCity([city(1)], city(1).id, city(1).id)).toBeNull();
    expect(withoutCity([city(1), city(2)], city(1).id, 'нет такого')).toBeNull();
  });
});

describe('rememberCity (хранилище устройства)', () => {
  beforeEach(() => localStorage.clear());

  it('запоминает и выбирает; loadChosenCity возвращает это место', () => {
    expect(loadChosenCity()).toBeNull();
    const h = here(37.5, 70.25); // не совпадает ни с одним городом по умолчанию
    expect(rememberCity(h)).toBe(true);
    expect(loadChosenCity()).toEqual(h);
    expect(loadSelected(loadCities())).toBe(h.id);
    expect(loadCities()).toHaveLength(DEFAULT_CITIES.length + 1);
  });
  it('список полон — false и ничего не меняется', () => {
    const full = Array.from({ length: MAX_CITIES }, (_, i) => city(i + 1));
    localStorage.setItem('finora:weather:cities:v1', JSON.stringify(full));
    expect(rememberCity(city(99))).toBe(false);
    expect(loadCities()).toHaveLength(MAX_CITIES);
    expect(loadChosenCity()).toBeNull();
  });
  it('мусор в памяти (чужой «here», выбор неизвестного города) не ломает загрузку', () => {
    localStorage.setItem('finora:weather:cities:v1', JSON.stringify([{ ...city(1), here: 'yes' }, city(2)]));
    localStorage.setItem('finora:weather:selected:v1', JSON.stringify('нет такого'));
    expect(loadCities().map((c) => c.id)).toEqual([city(2).id]);
    expect(loadChosenCity()).toBeNull();
  });
});
