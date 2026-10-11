import { describe, expect, it } from 'vitest';
import { totalInBase } from './totals';

const rates: Record<string, number> = { 'USD>TJS': 10.9, 'EUR>TJS': 12 };
const getRate = (from: string, to: string) => rates[`${from}>${to}`] ?? null;

describe('totalInBase', () => {
  it('суммирует в базовой валюте и переводит остальные по курсу', () => {
    const r = totalInBase(
      [
        { currency: 'TJS', balanceMinor: 100_00 },
        { currency: 'USD', balanceMinor: 10_00 },
        { currency: 'USD', balanceMinor: 5_00 },
      ],
      'TJS',
      getRate,
    );
    expect(r.totalMinor).toBe(100_00 + Math.round(15_00 * 10.9));
    expect(r.missing).toEqual([]);
  });

  it('валюты без курса не входят в итог, но перечислены', () => {
    const r = totalInBase(
      [
        { currency: 'TJS', balanceMinor: 500 },
        { currency: 'GBP', balanceMinor: 999 },
        { currency: 'AED', balanceMinor: 1 },
      ],
      'TJS',
      getRate,
    );
    expect(r.totalMinor).toBe(500);
    expect(r.missing).toEqual(['AED', 'GBP']);
  });

  it('плохой курс считается отсутствием курса', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(totalInBase([{ currency: 'USD', balanceMinor: 100 }], 'TJS', () => bad).missing).toEqual(['USD']);
    }
  });

  it('отрицательные остатки и пустой список', () => {
    expect(totalInBase([], 'TJS', getRate)).toEqual({ totalMinor: 0, missing: [] });
    expect(totalInBase([{ currency: 'USD', balanceMinor: -1000 }], 'TJS', getRate).totalMinor).toBe(-10900);
  });

  it('округляет один раз на валюту, а не на каждый кошелёк', () => {
    // три кошелька по 0,01$ при курсе 10,9: по отдельности 3 × 0,11 = 0,33; суммой 0,03$ → 0,327 → 0,33
    const three = totalInBase(Array.from({ length: 3 }, () => ({ currency: 'USD', balanceMinor: 1 })), 'TJS', getRate);
    expect(three.totalMinor).toBe(33);
    const hundred = totalInBase(Array.from({ length: 100 }, () => ({ currency: 'USD', balanceMinor: 1 })), 'TJS', getRate);
    expect(hundred.totalMinor).toBe(1090); // 1$ = 10,90 сомони; при поштучном округлении было бы 1100
  });
});
