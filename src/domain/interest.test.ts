import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  annuityPlan,
  formatRateBp,
  INTEREST_MINOR_MAX,
  interestFor,
  interestOf,
  parseRateBp,
  parseTermMonths,
  rateError,
  RATE_BP_MAX,
  suggestedMonthlyMinor,
  termError,
  TERM_MONTHS_MAX,
} from './interest';

describe('annuityPlan: кредит равными платежами', () => {
  it('10 000 под 24 % годовых на 12 месяцев — как в банковском калькуляторе: платёж 945,60, проценты 1 347,15', () => {
    // независимая сверка: 10 000 · 0,02 / (1 − 1,02^−12) = 945,5960…; 12 платежей ≈ 11 347,15
    expect(annuityPlan(1_000_000, 2400, 12)).toEqual({ paymentMinor: 94_560, lastPaymentMinor: 94_555, interestMinor: 134_715, totalMinor: 1_134_715 });
  });

  it('50 000 под 18,5 % на 36 месяцев', () => {
    expect(annuityPlan(5_000_000, 1850, 36)).toEqual({ paymentMinor: 182_019, lastPaymentMinor: 181_998, interestMinor: 1_552_663, totalMinor: 6_552_663 });
  });

  it('график сходится: (n − 1) обычных платежей и последний дают ровно «долг + проценты»', () => {
    for (const [s, bp, n] of [
      [1_000_000, 2400, 12],
      [5_000_000, 1850, 36],
      [123_456, 999, 7],
      [100, 100_000, 600],
    ] as const) {
      const p = annuityPlan(s, bp, n)!;
      expect((n - 1) * p.paymentMinor + p.lastPaymentMinor, `${s}/${bp}/${n}`).toBe(p.totalMinor);
      expect(p.totalMinor).toBe(s + p.interestMinor);
    }
  });

  it('один месяц: проценты одного месяца', () => {
    // 10 000 · 24 % / 12 = 200
    expect(annuityPlan(1_000_000, 2400, 1)).toMatchObject({ paymentMinor: 1_020_000, interestMinor: 20_000, totalMinor: 1_020_000 });
  });

  it('чем длиннее срок и выше ставка, тем больше переплата', () => {
    const a = annuityPlan(1_000_000, 2400, 12)!.interestMinor;
    expect(annuityPlan(1_000_000, 2400, 24)!.interestMinor).toBeGreaterThan(a);
    expect(annuityPlan(1_000_000, 3000, 12)!.interestMinor).toBeGreaterThan(a);
  });

  it('границы: вне допустимых ставки, срока и суммы — null', () => {
    expect(annuityPlan(1_000_000, 0, 12)).toBeNull();
    expect(annuityPlan(1_000_000, RATE_BP_MAX + 1, 12)).toBeNull();
    expect(annuityPlan(1_000_000, 2400, 0)).toBeNull();
    expect(annuityPlan(1_000_000, 2400, TERM_MONTHS_MAX + 1)).toBeNull();
    expect(annuityPlan(0, 2400, 12)).toBeNull();
    expect(annuityPlan(-5, 2400, 12)).toBeNull();
    expect(annuityPlan(1.5, 2400, 12)).toBeNull();
    expect(annuityPlan(1_000_000, 24.5, 12)).toBeNull();
    expect(annuityPlan(1_000_000, 2400, 12.5)).toBeNull();
    expect(annuityPlan(Number.NaN, 2400, 12)).toBeNull();
  });

  it('огромная сумма не превращается в неверные деньги: либо точный результат в пределах, либо null', () => {
    expect(annuityPlan(INTEREST_MINOR_MAX + 1, 2400, 12)).toBeNull();
    const huge = annuityPlan(INTEREST_MINOR_MAX, RATE_BP_MAX, TERM_MONTHS_MAX);
    if (huge !== null) {
      expect(Number.isSafeInteger(huge.totalMinor)).toBe(true);
      expect(huge.interestMinor).toBeLessThanOrEqual(INTEREST_MINOR_MAX);
    }
  });

  it('ничтожные проценты округляются в ноль — «процентов нет», а не «ноль процентов»', () => {
    expect(annuityPlan(100, 1, 1)).toMatchObject({ interestMinor: 0 });
    expect(interestFor(100, 1, 1)).toBeNull();
    expect(interestFor(1_000_000, 2400, 12)).toBe(134_715);
    expect(interestFor(1_000_000, 0, 12)).toBeNull();
  });

  it('свойство: для любых допустимых чисел итог целый, не меньше долга, график сходится', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000_000 }),
        fc.integer({ min: 1, max: RATE_BP_MAX }),
        fc.integer({ min: 1, max: TERM_MONTHS_MAX }),
        (s, bp, n) => {
          const p = annuityPlan(s, bp, n);
          if (p === null) return true;
          expect(Number.isSafeInteger(p.totalMinor)).toBe(true);
          expect(p.interestMinor).toBeGreaterThanOrEqual(0);
          expect(p.totalMinor).toBe(s + p.interestMinor);
          expect(p.paymentMinor).toBeGreaterThan(0);
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('interestOf и suggestedMonthlyMinor', () => {
  it('нет процентов — ноль', () => {
    expect(interestOf({ interestMinor: null })).toBe(0);
    expect(interestOf({})).toBe(0);
    expect(interestOf({ interestMinor: 500 })).toBe(500);
  });

  it('платёж по договору: сумма с процентами поровну на срок, вверх', () => {
    expect(suggestedMonthlyMinor(1_134_715, 12)).toBe(94_560);
    expect(suggestedMonthlyMinor(1_000, 3)).toBe(334);
    expect(suggestedMonthlyMinor(900, 3)).toBe(300);
    expect(suggestedMonthlyMinor(1_000, null)).toBeNull();
    expect(suggestedMonthlyMinor(1_000, 0)).toBeNull();
    expect(suggestedMonthlyMinor(0, 12)).toBeNull();
  });
});

describe('ставка и срок: разбор и показ', () => {
  it('parseRateBp: запятая и точка, до двух знаков', () => {
    expect(parseRateBp('24')).toBe(2400);
    expect(parseRateBp('24,5')).toBe(2450);
    expect(parseRateBp('24.55')).toBe(2455);
    expect(parseRateBp(' 18 ')).toBe(1800);
    expect(parseRateBp('0,05')).toBe(5);
    expect(parseRateBp('24,')).toBe(2400);
  });

  it('parseRateBp: двусмысленное и мусор не угадываем', () => {
    for (const bad of ['', ' ', '24,555', '-5', '1e2', 'двадцать', '1,2,3', '24%', '12345']) expect(parseRateBp(bad), bad).toBeNull();
  });

  it('formatRateBp обратен parseRateBp', () => {
    expect(formatRateBp(2400)).toBe('24');
    expect(formatRateBp(2450)).toBe('24,5');
    expect(formatRateBp(2455)).toBe('24,55');
    expect(formatRateBp(5)).toBe('0,05');
    fc.assert(fc.property(fc.integer({ min: 1, max: RATE_BP_MAX }), (bp) => parseRateBp(formatRateBp(bp)) === bp));
  });

  it('rateError: ноль, слишком большая и нечитаемая ставка', () => {
    expect(rateError(2400)).toBeNull();
    expect(rateError(null)).toMatch(/число/);
    expect(rateError(0)).toMatch(/больше нуля/);
    expect(rateError(RATE_BP_MAX)).toBeNull();
    expect(rateError(RATE_BP_MAX + 1)).toMatch(/1000/);
  });

  it('parseTermMonths и termError', () => {
    expect(parseTermMonths('12')).toBe(12);
    expect(parseTermMonths(' 7 ')).toBe(7);
    for (const bad of ['', '1,5', '-3', 'год', '12 мес', '12345']) expect(parseTermMonths(bad), bad).toBeNull();
    expect(termError(12)).toBeNull();
    expect(termError(null)).toMatch(/целое/);
    expect(termError(0)).toMatch(/не меньше месяца/);
    expect(termError(TERM_MONTHS_MAX)).toBeNull();
    expect(termError(TERM_MONTHS_MAX + 1)).toMatch(/не больше 600/);
  });
});
