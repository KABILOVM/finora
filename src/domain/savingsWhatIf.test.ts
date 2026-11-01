import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { WHATIF_ROWS, daysEarlier, whatIfRows } from './savingsWhatIf';

describe('daysEarlier', () => {
  it('сокращение 10 % у пары «300 000 осталось, 150 000 в месяц» даёт пять дней', () => {
    // 2 месяца против 300 000 ÷ 165 000 ≈ 1,82 месяца: разница ≈ 0,18 месяца ≈ 5,5 дня, вниз
    expect(daysEarlier(300_000, 150_000, 15_000)).toBe(5);
  });

  it('нечего копить, нет плана или добавки — ноль', () => {
    expect(daysEarlier(0, 150_000, 15_000)).toBe(0);
    expect(daysEarlier(300_000, 0, 15_000)).toBe(0);
    expect(daysEarlier(300_000, 150_000, 0)).toBe(0);
    expect(daysEarlier(300_000, 150_000, -1)).toBe(0);
    expect(daysEarlier(Number.NaN, 150_000, 15_000)).toBe(0);
  });

  it('свойство: больше добавка — не меньше выигрыш; выигрыш меньше всего срока по плану', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (remaining, monthly, extra, more) => {
          const a = daysEarlier(remaining, monthly, extra);
          const b = daysEarlier(remaining, monthly, extra + more);
          expect(b).toBeGreaterThanOrEqual(a);
          expect(b).toBeLessThanOrEqual(Math.ceil((remaining / monthly) * 30.4375));
        },
      ),
    );
  });
});

describe('whatIfRows', () => {
  const cats = [
    { categoryId: 'fun', essential: false, usualMonthlyMinor: 200_000 },
    { categoryId: 'rent', essential: true, usualMonthlyMinor: 500_000 },
    { categoryId: 'food', essential: false, usualMonthlyMinor: 600_000 },
    { categoryId: 'none', essential: false, usualMonthlyMinor: 0 },
  ];

  it('необязательные категории по убыванию привычных трат; обязательные и пустые не входят', () => {
    const rows = whatIfRows(cats, 20, 300_000, 150_000);
    expect(rows.map((r) => r.categoryId)).toEqual(['food', 'fun']);
    expect(rows[0]).toEqual({ categoryId: 'food', percent: 20, extraMonthlyMinor: 120_000, daysEarlier: 27 });
    expect(rows[1]).toEqual({ categoryId: 'fun', percent: 20, extraMonthlyMinor: 40_000, daysEarlier: 12 });
  });

  it(`не больше ${WHATIF_ROWS} строк по умолчанию и не больше заданного предела`, () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ categoryId: `c${i}`, essential: false, usualMonthlyMinor: 100_000 + i }));
    expect(whatIfRows(many, 10, 300_000, 150_000)).toHaveLength(WHATIF_ROWS);
    expect(whatIfRows(many, 10, 300_000, 150_000, 5)).toHaveLength(5);
    expect(whatIfRows(many, 10, 300_000, 150_000, 0)).toHaveLength(0);
  });

  it('нечего копить или нет плана — строк нет', () => {
    expect(whatIfRows(cats, 20, 0, 150_000)).toEqual([]);
    expect(whatIfRows(cats, 20, 300_000, 0)).toEqual([]);
    expect(whatIfRows(cats, 0, 300_000, 150_000)).toEqual([]);
  });
});
