import { describe, expect, it } from 'vitest';
import type { Forecast, HourPoint } from './api';
import { elapsedMs, hoursFrom, slotIndex } from './slots';

const FETCHED = new Date('2026-10-15T09:00:00Z');
const at = (minutes: number) => new Date(FETCHED.getTime() + minutes * 60_000);

/** Прогноз, загруженный в 14:15 (текущее +14°, ясно); почасовые 14:00…18:00: +15°, +16°, +17°, +16°, +15° (почасовой «сейчас» тёплее текущего). */
function forecast(): Forecast {
  const temps = [15, 16, 17, 16, 15];
  return {
    fetchedAt: FETCHED.toISOString(),
    current: { temp: 14, feels: 13, humidity: 40, code: 0, isDay: true, wind: 2, pressure: 690, time: '2026-10-15T14:15' },
    hours: temps.map((temp, i): HourPoint => ({ time: `${14 + i}:00`, temp, code: 3, isDay: false, rain: null })),
    days: [],
    sunrise: null,
    sunset: null,
  };
}

describe('slotIndex', () => {
  it('свежий прогноз — слот 0; следующий слот наступает через 45 минут после загрузки в 14:15', () => {
    expect(slotIndex(forecast(), at(0))).toBe(0);
    expect(slotIndex(forecast(), at(44))).toBe(0);
    expect(slotIndex(forecast(), at(45))).toBe(1);
    expect(slotIndex(forecast(), at(105))).toBe(2);
  });

  it('часы устройства отстают от времени загрузки или время загрузки испорчено — слот 0', () => {
    expect(slotIndex(forecast(), at(-30))).toBe(0);
    expect(slotIndex({ ...forecast(), fetchedAt: 'вчера' }, at(500))).toBe(0);
    expect(elapsedMs({ ...forecast(), fetchedAt: 'вчера' }, at(500))).toBe(0);
  });

  it('время прогноза без минут не ломает расчёт', () => {
    const f = { ...forecast(), current: { ...forecast().current, time: 'x' } };
    expect(slotIndex(f, at(59))).toBe(0);
    expect(slotIndex(f, at(60))).toBe(1);
  });
});

describe('hoursFrom', () => {
  it('свежий прогноз: «Сейчас» берёт температуру из текущей погоды, чтобы совпасть с карточкой (+14°, а не +15° по часам)', () => {
    const [first, second] = hoursFrom(forecast(), at(5));
    expect(first).toMatchObject({ now: true, hour: { time: '14:00', temp: 14, code: 0, isDay: true } });
    expect(second).toMatchObject({ now: false, hour: { time: '15:00', temp: 16 } });
  });

  it('прогноз из памяти: прошедшие часы убраны, «Сейчас» — час, до которого дошли, по почасовому прогнозу', () => {
    // загружен в 14:15, сейчас 16:20
    const list = hoursFrom(forecast(), at(125));
    expect(list.map((s) => s.hour.time)).toEqual(['16:00', '17:00', '18:00']);
    expect(list.map((s) => s.now)).toEqual([true, false, false]);
    expect(list[0]!.hour.temp).toBe(17); // почасовая оценка на этот час, не старая «текущая»
  });

  it('прошли все часы прогноза — пусто, а не падение', () => {
    expect(hoursFrom(forecast(), at(60 * 20))).toEqual([]);
  });

  it('исходный прогноз не меняется', () => {
    const f = forecast();
    hoursFrom(f, at(0));
    expect(f.hours[0]!.temp).toBe(15);
  });
});
