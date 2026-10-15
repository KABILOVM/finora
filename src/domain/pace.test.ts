import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  budgetPace,
  MIN_PACE_DAYS,
  monthPace,
  projectMonthEnd,
  unusualCategories,
  type BudgetPace,
} from './pace';
import type { SpendRow } from './budgetProgress';

describe('monthPace: дни идущего месяца', () => {
  it('текущий месяц: прошло дней (с сегодняшним) и всего в месяце', () => {
    expect(monthPace('2026-10', '2026-10-15')).toEqual({ elapsedDays: 15, totalDays: 31 });
    expect(monthPace('2026-10', '2026-10-01')).toEqual({ elapsedDays: 1, totalDays: 31 });
    expect(monthPace('2026-10', '2026-10-31')).toEqual({ elapsedDays: 31, totalDays: 31 });
  });
  it('февраль: 28 дней, а в високосный год — 29', () => {
    expect(monthPace('2026-02', '2026-02-10')?.totalDays).toBe(28);
    expect(monthPace('2028-02', '2028-02-10')?.totalDays).toBe(29);
  });
  it('прошедший, будущий и некорректный месяц — null', () => {
    expect(monthPace('2026-09', '2026-10-15')).toBeNull();
    expect(monthPace('2026-11', '2026-10-15')).toBeNull();
    expect(monthPace('2025-10', '2026-10-15')).toBeNull(); // тот же месяц, но другой год
    expect(monthPace('2026-13', '2026-13-01')).toBeNull();
    expect(monthPace('октябрь', '2026-10-15')).toBeNull();
  });
});

describe('projectMonthEnd: расход к концу месяца', () => {
  it('floor(потрачено × дней в месяце ÷ прошло дней)', () => {
    expect(projectMonthEnd(46_500, 15, 31)).toBe(96_100); // 46 500 × 31 ÷ 15 = 96 100
    expect(projectMonthEnd(1_000, 3, 31)).toBe(10_333); // 10 333,33… вниз
    expect(projectMonthEnd(0, 10, 31)).toBe(0);
  });
  it('в последний день месяца прогноз равен потраченному', () => {
    expect(projectMonthEnd(12_345, 31, 31)).toBe(12_345);
  });
  it('большие суммы считаются точно (BigInt), не помещающиеся — RangeError', () => {
    const edge = Math.floor(Number.MAX_SAFE_INTEGER / 31) - 1; // × 31 ещё помещается в безопасное целое
    expect(projectMonthEnd(edge, 1, 31)).toBe(edge * 31);
    expect(projectMonthEnd(Number.MAX_SAFE_INTEGER, 31, 31)).toBe(Number.MAX_SAFE_INTEGER); // промежуточное произведение не помещается в double, ответ — да
    expect(() => projectMonthEnd(Number.MAX_SAFE_INTEGER, 1, 31)).toThrow(RangeError);
  });
  it.each([
    [-1, 10, 31],
    [1.5, 10, 31],
    [100, 0, 31],
    [100, 10.5, 31],
    [100, 32, 31],
    [100, 10, Number.NaN],
  ])('некорректные входные (%s, %s, %s) — RangeError', (spent, elapsed, total) => {
    expect(() => projectMonthEnd(spent, elapsed, total)).toThrow(RangeError);
  });
});

describe('budgetPace: хватит ли лимита до конца месяца', () => {
  const pace = (limitMinor: number, spentMinor: number, elapsedDays = 15, totalDays = 31): BudgetPace => budgetPace({ limitMinor, spentMinor, elapsedDays, totalDays });

  it('уложитесь: прогноз не выше лимита (ровно в лимит — тоже)', () => {
    expect(pace(100_000, 40_000)).toEqual({ status: 'on-track', projectedMinor: 82_666 });
    expect(pace(82_666, 40_000)).toEqual({ status: 'on-track', projectedMinor: 82_666 });
  });
  it('не уложитесь: день исчерпания лимита и перерасход к концу месяца', () => {
    // 400 с. за 15 дней → 82 666 за 31 день при лимите 500: лимит кончится на ceil(500 × 15 ÷ 400) = 19-й день
    expect(pace(50_000, 40_000)).toEqual({ status: 'will-exceed', projectedMinor: 82_666, overByMinor: 32_666, exhaustDay: 19 });
  });
  it('на единицу выше лимита — уже «не уложитесь»', () => {
    expect(pace(82_665, 40_000)).toMatchObject({ status: 'will-exceed', overByMinor: 1 });
  });
  it('лимит уже исчерпан или превышен — over (в любой день)', () => {
    expect(pace(50_000, 50_000)).toEqual({ status: 'over' });
    expect(pace(50_000, 70_000)).toEqual({ status: 'over' });
    expect(pace(50_000, 60_000, 1)).toEqual({ status: 'over' });
  });
  it('ранние дни, нет трат и некорректный лимит — unknown', () => {
    expect(pace(50_000, 10_000, MIN_PACE_DAYS - 1)).toEqual({ status: 'unknown' });
    expect(pace(50_000, 10_000, MIN_PACE_DAYS)).not.toEqual({ status: 'unknown' });
    expect(pace(50_000, 0)).toEqual({ status: 'unknown' });
    expect(pace(0, 10_000)).toEqual({ status: 'unknown' });
    expect(pace(-5, 10_000)).toEqual({ status: 'unknown' });
    expect(pace(50_000.5, 10_000)).toEqual({ status: 'unknown' });
  });
  it('последний день месяца: прогноз равен потраченному, «не уложитесь» не бывает', () => {
    expect(pace(50_000, 40_000, 31, 31)).toEqual({ status: 'on-track', projectedMinor: 40_000 });
  });
  it('огромные суммы — RangeError, а не неверное число', () => {
    expect(() => pace(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)).toThrow(RangeError);
  });

  it('свойства: день исчерпания — после сегодняшнего и не позже конца месяца; прогноз растёт вместе с тратами', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: MIN_PACE_DAYS, max: 31 }),
        fc.constantFrom(28, 29, 30, 31),
        (limit, spent, elapsedRaw, totalDays) => {
          const elapsed = Math.min(elapsedRaw, totalDays);
          const p = budgetPace({ limitMinor: limit, spentMinor: spent, elapsedDays: elapsed, totalDays });
          if (spent >= limit) return p.status === 'over';
          const projected = projectMonthEnd(spent, elapsed, totalDays);
          if (projected <= limit) return p.status === 'on-track' && p.projectedMinor === projected;
          return (
            p.status === 'will-exceed' &&
            p.exhaustDay > elapsed &&
            p.exhaustDay <= totalDays &&
            p.overByMinor === projected - limit &&
            // на конец найденного дня траты при прежнем темпе уже дошли до лимита, а днём раньше — ещё нет
            spent * p.exhaustDay >= limit * elapsed &&
            spent * (p.exhaustDay - 1) < limit * elapsed
          );
        },
      ),
      { numRuns: 500 },
    );
  });
  it('свойство: больше трат — не меньше прогноз', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 1, max: 31 }), (a, b, d) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return projectMonthEnd(lo, d, 31) <= projectMonthEnd(hi, d, 31);
      }),
    );
  });
});

describe('unusualCategories: необычно много для этой категории', () => {
  const row = (categoryId: string | null, totalMinor: number, kind?: 'fee'): SpendRow => ({ categoryId, totalMinor, ...(kind ? { kind } : {}) });
  const months = (...amounts: number[]): SpendRow[][] => amounts.map((a) => (a > 0 ? [row('fun', a)] : []));

  it('потрачено ≥ 120 % медианы трёх прошлых месяцев — необычно; ровно 120 % тоже', () => {
    expect(unusualCategories([row('fun', 84_000)], months(70_000, 60_000, 80_000))).toEqual([{ categoryId: 'fun', spentMinor: 84_000, usualMinor: 70_000 }]);
    expect(unusualCategories([row('fun', 83_999)], months(70_000, 60_000, 80_000))).toEqual([]);
  });
  it('нули входят в медиану: [0, 100, 300] → обычно 100', () => {
    expect(unusualCategories([row('fun', 130)], months(0, 100, 300))).toEqual([{ categoryId: 'fun', spentMinor: 130, usualMinor: 100 }]);
  });
  it('история в одном месяце из трёх (или нет вовсе) — «обычного» нет', () => {
    expect(unusualCategories([row('fun', 999_999)], months(0, 0, 500))).toEqual([]);
    expect(unusualCategories([row('fun', 999_999)], months(0, 0, 0))).toEqual([]);
    expect(unusualCategories([row('fun', 999_999)], [])).toEqual([]);
  });
  it('две «живые» месяца из трёх — достаточно', () => {
    expect(unusualCategories([row('fun', 1_000)], months(0, 100, 200))).toEqual([{ categoryId: 'fun', spentMinor: 1_000, usualMinor: 100 }]);
  });
  it('обычно медиана нулевая (тратили в двух месяцах из трёх, но медиана 0) — пропускаем', () => {
    expect(unusualCategories([row('fun', 1_000)], months(0, 0, 0, 100, 200))).toEqual([]); // [0,0,0,100,200] → медиана 0
  });
  it('«комиссии» и «без категории» не проверяются, категории не смешиваются', () => {
    const hist = [[row(null, 100), row(null, 100, 'fee'), row('fun', 100)], [row(null, 100), row(null, 100, 'fee'), row('fun', 100)], [row('fun', 100)]];
    expect(unusualCategories([row(null, 9_999), row(null, 9_999, 'fee'), row('other', 9_999)], hist)).toEqual([]);
  });
  it('порядок: больше превышение — выше', () => {
    const hist = [[row('a', 100), row('b', 100)], [row('a', 100), row('b', 100)], [row('a', 100), row('b', 100)]];
    expect(unusualCategories([row('a', 300), row('b', 900)], hist).map((x) => x.categoryId)).toEqual(['b', 'a']);
  });
  it('нет трат в этом месяце — ничего', () => {
    expect(unusualCategories([row('fun', 0)], months(100, 100, 100))).toEqual([]);
  });
  it('огромные суммы — точное сравнение без потери разрядов', () => {
    const big = Number.MAX_SAFE_INTEGER - 10;
    expect(unusualCategories([row('fun', big)], months(big, big, big))).toHaveLength(0); // равно обычному — не необычно
  });
});
