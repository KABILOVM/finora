import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { cityId } from './api';
import { cityFromCoords, HERE_NAME, locate, LocateError, roundCoord } from './geolocation';

type Ok = (p: { coords: { latitude: number; longitude: number } }) => void;
type Fail = (e: { code: number }) => void;

const geoOk = (lat: number, lon: number) => ({
  getCurrentPosition: vi.fn((ok: Ok) => ok({ coords: { latitude: lat, longitude: lon } })),
});
const geoFail = (code: number) => ({ getCurrentPosition: vi.fn((_ok: Ok, fail: Fail) => fail({ code })) });

describe('roundCoord', () => {
  it('округляет до 0,01° (около километра)', () => {
    expect(roundCoord(38.559812)).toBe(38.56);
    expect(roundCoord(68.7871)).toBe(68.79);
    expect(roundCoord(-0.004)).toBe(0); // без «минус нуля»
    expect(Object.is(roundCoord(-0.004), -0)).toBe(false);
  });
  it('никогда не уходит дальше 0,005° от настоящего значения и не даёт точный адрес', () => {
    fc.assert(
      fc.property(fc.double({ min: -180, max: 180, noNaN: true }), (v) => {
        expect(Math.abs(roundCoord(v) - v)).toBeLessThanOrEqual(0.005 + 1e-9);
        expect(Math.round(roundCoord(v) * 100) / 100).toBe(roundCoord(v));
      }),
    );
  });
});

describe('cityFromCoords', () => {
  it('место «я здесь»: округлённые координаты, подпись без адреса, id по округлённым координатам', () => {
    const c = cityFromCoords(38.559812, 68.7871);
    expect(c).toEqual({ id: cityId(38.56, 68.79), name: HERE_NAME, region: '', lat: 38.56, lon: 68.79, here: true });
  });
  it.each([
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
    [91, 0],
    [0, 181],
    [-90.5, 0],
  ])('неправдоподобные координаты (%s, %s) — не место', (lat, lon) => {
    expect(cityFromCoords(lat, lon)).toBeNull();
  });
  it('границы диапазона допустимы', () => {
    expect(cityFromCoords(90, 180)).not.toBeNull();
    expect(cityFromCoords(-90, -180)).not.toBeNull();
  });
});

describe('locate', () => {
  it('отдаёт место по координатам устройства и просит у браузера небольшую точность и недавнее положение', async () => {
    const geo = geoOk(38.5598, 68.787);
    const c = await locate(geo);
    expect(c).toMatchObject({ lat: 38.56, lon: 68.79, here: true });
    const options = geo.getCurrentPosition.mock.calls[0]![2] as PositionOptions;
    expect(options.enableHighAccuracy).toBe(false);
    expect(options.timeout).toBeLessThanOrEqual(15_000);
    expect(options.maximumAge).toBeGreaterThan(0);
  });
  it('отказ в доступе, сбой и долгое ожидание — понятным русским текстом', async () => {
    await expect(locate(geoFail(1))).rejects.toThrow(/не разрешён/);
    await expect(locate(geoFail(2))).rejects.toThrow(/Не удалось определить/);
    await expect(locate(geoFail(3))).rejects.toThrow(/слишком долго/);
    await expect(locate(geoFail(1))).rejects.toBeInstanceOf(LocateError);
  });
  it('устройство без геолокации', async () => {
    await expect(locate(undefined as never)).rejects.toThrow(/не умеет определять/);
  });
  it('устройство вернуло мусор вместо координат', async () => {
    await expect(locate(geoOk(Number.NaN, 5))).rejects.toThrow(/непонятное/);
  });
});
