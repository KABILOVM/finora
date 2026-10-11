import { describe, expect, it } from 'vitest';
import { balanceSeries, sparkPath } from './homeData';

type Tx = Parameters<typeof balanceSeries>[0][number];

const tx = (over: Partial<Tx> & Pick<Tx, 'occurredOn' | 'kind' | 'baseAmountMinor'>): Tx =>
  ({
    id: Math.random().toString(36).slice(2),
    walletId: 'w',
    toWalletId: null,
    categoryId: null,
    note: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    baseCurrency: 'TJS',
    ...over,
  }) as Tx;

describe('balanceSeries: остаток по дням назад от сегодняшнего итога', () => {
  it('без операций — ровная линия из days + 1 точек', () => {
    expect(balanceSeries([], 1000, '2026-10-11', 3, 'TJS')).toEqual([1000, 1000, 1000, 1000]);
  });

  it('доход и расход сдвигают остаток прошлых дней в обратную сторону', () => {
    const txs = [
      tx({ occurredOn: '2026-10-11', kind: 'expense', baseAmountMinor: 300 }), // сегодня потратили 3
      tx({ occurredOn: '2026-10-09', kind: 'income', baseAmountMinor: 2000 }), // позавчера получили 20
    ];
    // точки — остаток на конец дня 8, 9, 10 и 11 октября: 0, потом доход 20 (9-го) → 20, расход 3 (11-го) → 17
    expect(balanceSeries(txs, 1700, '2026-10-11', 3, 'TJS')).toEqual([0, 2000, 2000, 1700]);
  });

  it('удалённые операции, чужая базовая валюта и переводы без комиссии не влияют', () => {
    const txs = [
      tx({ occurredOn: '2026-10-11', kind: 'expense', baseAmountMinor: 500, deletedAt: '2026-10-11T10:00:00.000Z' }),
      tx({ occurredOn: '2026-10-11', kind: 'expense', baseAmountMinor: 500, baseCurrency: 'USD' }),
      tx({ occurredOn: '2026-10-11', kind: 'transfer', baseAmountMinor: 0 }),
    ];
    expect(balanceSeries(txs, 800, '2026-10-11', 2, 'TJS')).toEqual([800, 800, 800]);
  });

  it('комиссия перевода — расход, движение по долгам тоже меняет деньги на руках', () => {
    const txs = [
      tx({ occurredOn: '2026-10-11', kind: 'transfer', baseAmountMinor: 100 }), // комиссия 1
      tx({ occurredOn: '2026-10-10', kind: 'income', baseAmountMinor: 5000, debtId: 'd1' } as Partial<Tx> & Pick<Tx, 'occurredOn' | 'kind' | 'baseAmountMinor'>), // взяли в долг 50
    ];
    expect(balanceSeries(txs, 4900, '2026-10-11', 2, 'TJS')).toEqual([0, 5000, 4900]);
  });
});

describe('sparkPath: линия графика', () => {
  it('ровная линия идёт посередине, а путь начинается в левом краю', () => {
    const { d, lastY } = sparkPath([5, 5, 5]);
    expect(d.startsWith('M0.0 45.0')).toBe(true);
    expect(lastY).toBe(45);
  });

  it('рост рисуется снизу вверх: последняя точка выше первой', () => {
    const { lastY } = sparkPath([0, 10, 20, 30]);
    expect(lastY).toBeLessThan(45);
  });

  it('одна точка не ломает расчёт', () => {
    expect(() => sparkPath([7])).not.toThrow();
  });
});
