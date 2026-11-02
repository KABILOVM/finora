import { describe, expect, it } from 'vitest';
import type { Forecast, HourPoint } from './api';
import { ADVICE_MAX_AGE_MS, weatherAdvice } from './advice';

const FETCHED = new Date('2026-10-15T09:00:00Z'); // 14:00 по Душанбе
const at = (minutes: number) => new Date(FETCHED.getTime() + minutes * 60_000);

/** Прогноз, загруженный в 14:15; коды и температуры по часам с 14:00 (hours[0] = 14:00). */
function forecast(nowCode: number, hours: [code: number, temp: number][], nowTemp = 20): Forecast {
  return {
    fetchedAt: FETCHED.toISOString(),
    current: { temp: nowTemp, feels: nowTemp, humidity: 40, code: nowCode, isDay: true, wind: 2, pressure: 690, time: '2026-10-15T14:15' },
    hours: hours.map(([code, temp], i): HourPoint => ({ time: `${String(14 + i).padStart(2, '0')}:00`, temp, code, isDay: true, rain: null })),
    days: [],
    sunrise: null,
    sunset: null,
  };
}

const CLEAR = [0, 20] as [number, number];

describe('weatherAdvice', () => {
  it('ясно и облачно — советов нет', () => {
    const f = forecast(0, [CLEAR, [1, 21], [3, 19], [45, 18], [2, 18], [0, 17], [0, 16]]);
    expect(weatherAdvice(f, at(0))).toBeNull();
  });

  it('идёт дождь — «возьмите зонт»', () => {
    const f = forecast(63, [[63, 18], [63, 18], CLEAR, CLEAR, CLEAR, CLEAR]);
    expect(weatherAdvice(f, at(5))).toEqual({ icon: 'rain', text: 'Сейчас дождь — возьмите зонт' });
  });

  it('дождь ожидается позже — называет время и сам дождь', () => {
    const f = forecast(0, [CLEAR, CLEAR, [61, 18], [63, 18], CLEAR, CLEAR]);
    expect(weatherAdvice(f, at(5))).toEqual({ icon: 'rain', text: 'К 16:00 ожидается небольшой дождь — возьмите зонт' });
  });

  it('морось и ливень — тоже дождь', () => {
    expect(weatherAdvice(forecast(53, [[53, 18]]), at(0))?.text).toBe('Сейчас морось — возьмите зонт');
    expect(weatherAdvice(forecast(81, [[81, 18]]), at(0))?.text).toBe('Сейчас ливень — возьмите зонт');
  });

  it('гроза — тоже с зонтом', () => {
    expect(weatherAdvice(forecast(95, [[95, 22]]), at(0))).toEqual({ icon: 'storm', text: 'Сейчас гроза — возьмите зонт' });
  });

  it('снег — «оденьтесь потеплее» (без зонта)', () => {
    const f = forecast(73, [[73, -2], [73, -3], [73, -3]], -2);
    expect(weatherAdvice(f, at(0))).toEqual({ icon: 'snow', text: 'Сейчас снег — оденьтесь потеплее' });
  });

  it('снег позже', () => {
    const f = forecast(3, [[3, 1], [3, 1], [71, 0], [71, 0]], 1);
    expect(weatherAdvice(f, at(0))?.text).toBe('К 16:00 ожидается небольшой снег — оденьтесь потеплее');
  });

  it('дождь в холод — и зонт, и потеплее', () => {
    const f = forecast(61, [[61, 8], [61, 7]], 8);
    expect(weatherAdvice(f, at(0))?.text).toBe('Сейчас небольшой дождь — возьмите зонт и оденьтесь потеплее');
  });

  it('дождь в тепло — одеваться потеплее не просит; ровно +10° — уже холодно', () => {
    expect(weatherAdvice(forecast(63, [[63, 11]], 11), at(0))?.text).toBe('Сейчас дождь — возьмите зонт');
    expect(weatherAdvice(forecast(63, [[63, 10]], 10), at(0))?.text).toBe('Сейчас дождь — возьмите зонт и оденьтесь потеплее');
  });

  it('дождь со снегом в ближайшие часы — оба совета', () => {
    const f = forecast(0, [CLEAR, [63, 12], [73, 1]]);
    expect(weatherAdvice(f, at(0))?.text).toBe('К 15:00 ожидается дождь — возьмите зонт и оденьтесь потеплее');
  });

  it('смотрит только на ближайшие 6 часов: дождь вечером не повод брать зонт днём', () => {
    const f = forecast(0, [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR, CLEAR, [63, 18]]); // дождь в 20:00
    expect(weatherAdvice(f, at(0))).toBeNull();
    expect(weatherAdvice(f, at(70))?.text).toBe('К 20:00 ожидается дождь — возьмите зонт'); // через час-полтора он уже в окне
  });

  it('прогноз из памяти: прошедшие часы не считаются', () => {
    // загружен в 14:15, сейчас 16:20: дождь был в 14–15 часов, а дальше сухо
    const f = forecast(63, [[63, 18], [63, 18], CLEAR, CLEAR, CLEAR, CLEAR, CLEAR, CLEAR]);
    expect(weatherAdvice(f, at(125))).toBeNull();
  });

  it('прогноз из памяти: «сейчас» — тот час, до которого дошли', () => {
    // загружен в 14:15, сейчас 16:20 — дождь идёт в слоте 16:00
    const f = forecast(0, [CLEAR, CLEAR, [63, 18], CLEAR, CLEAR, CLEAR, CLEAR, CLEAR]);
    expect(weatherAdvice(f, at(125))?.text).toBe('Сейчас дождь — возьмите зонт');
  });

  it('текущий час: слот 14:00 описывает «сейчас» по текущей погоде, а не по почасовой', () => {
    const f = forecast(0, [[63, 18], CLEAR, CLEAR]); // почасовой «дождь», а сейчас по факту ясно
    expect(weatherAdvice(f, at(0))).toBeNull();
  });

  it('прогноз старше трёх часов — молчим', () => {
    const f = forecast(63, [[63, 18], [63, 18], [63, 18], [63, 18], [63, 18], [63, 18], [63, 18], [63, 18]]);
    expect(weatherAdvice(f, at(ADVICE_MAX_AGE_MS / 60_000))).not.toBeNull();
    expect(weatherAdvice(f, at(ADVICE_MAX_AGE_MS / 60_000 + 1))).toBeNull();
  });

  it('часов в прогнозе не осталось или их нет вовсе — молчим, не падаем', () => {
    expect(weatherAdvice(forecast(63, [[63, 18]]), at(150))).toBeNull();
    expect(weatherAdvice(forecast(63, []), at(0))?.text).toBe('Сейчас дождь — возьмите зонт');
    expect(weatherAdvice(forecast(0, []), at(0))).toBeNull();
  });

  it('часы устройства чуть отстают от времени загрузки или время испорчено — не падаем', () => {
    expect(weatherAdvice(forecast(63, [[63, 18]]), at(-5))?.text).toBe('Сейчас дождь — возьмите зонт');
    expect(weatherAdvice({ ...forecast(63, [[63, 18]]), fetchedAt: 'вчера' }, at(0))).toBeNull();
  });
});
