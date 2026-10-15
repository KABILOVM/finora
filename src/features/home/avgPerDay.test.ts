import { describe, expect, it } from 'vitest';
import { avgPerDay } from './homeData';

describe('avgPerDay: средний расход в день с начала месяца', () => {
  it('расход ÷ номер сегодняшнего дня, округление вниз', () => {
    expect(avgPerDay(12_450, '2026-10-15')).toBe(830); // 124,50 ÷ 15 = 8,30
    expect(avgPerDay(1_000, '2026-10-03')).toBe(333); // 333,33… вниз
  });

  it('первое число: весь расход приходится на один день', () => {
    expect(avgPerDay(4_200, '2026-10-01')).toBe(4_200);
  });

  it('последний день месяца делит на его номер, а не на 30', () => {
    expect(avgPerDay(31_000, '2026-10-31')).toBe(1_000);
    expect(avgPerDay(28_000, '2026-02-28')).toBe(1_000);
  });

  it('расходов нет (или отрицательная сумма) — null, а не «0 в день»', () => {
    expect(avgPerDay(0, '2026-10-15')).toBeNull();
    expect(avgPerDay(-1, '2026-10-15')).toBeNull();
  });

  it('очень большая сумма считается точно, без потери разрядов', () => {
    expect(avgPerDay(Number.MAX_SAFE_INTEGER, '2026-10-10')).toBe(Math.floor(Number.MAX_SAFE_INTEGER / 10));
  });

  it('сумма не целое число — RangeError (как и остальные «в день»), а не молчаливая ошибка', () => {
    expect(() => avgPerDay(10.5, '2026-10-15')).toThrow(RangeError);
  });
});
