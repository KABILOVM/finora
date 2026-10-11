import { describe, expect, it } from 'vitest';
import { filterTransactions, groupByDay, summarizeDay, summarizeMonth } from '@/db';
import { tx } from './helpers';

const M = '2026-10';
const transfer = (id: string, fee: number, over = {}) =>
  tx({ id, kind: 'transfer', toWalletId: 'w2', toAmountMinor: 90, amountMinor: 100, baseAmountMinor: fee, fxRate: null, fxSource: null, ...over });

describe('summarizeMonth: комиссии и долги', () => {
  it('комиссия перевода — расход; строка комиссий в byCategory помечена kind: "fee"', () => {
    const s = summarizeMonth([tx({ id: '1', categoryId: 'food', baseAmountMinor: 500 }), transfer('2', 30), transfer('3', 20), transfer('4', 0)], M, 'TJS');
    expect(s).toMatchObject({ expenseMinor: 550, feeMinor: 50, incomeMinor: 0, excludedCount: 0 });
    expect(s.byCategory).toEqual([
      { categoryId: 'food', totalMinor: 500 },
      { categoryId: null, totalMinor: 50, kind: 'fee' },
    ]);
  });

  it('строка комиссий не склеивается с «без категории»; при равной сумме идёт после неё', () => {
    const s = summarizeMonth([tx({ id: '1', categoryId: null, baseAmountMinor: 50 }), transfer('2', 50)], M, 'TJS');
    expect(s.byCategory).toEqual([
      { categoryId: null, totalMinor: 50 },
      { categoryId: null, totalMinor: 50, kind: 'fee' },
    ]);
  });

  it('у обычных строк поля kind нет (старые потребители byCategory не ломаются)', () => {
    const s = summarizeMonth([tx({ id: '1', categoryId: 'a', baseAmountMinor: 5 })], M, 'TJS');
    expect(Object.keys(s.byCategory[0]!)).toEqual(['categoryId', 'totalMinor']);
  });

  it('операции по долгам не доходы/расходы и не в категориях; считаются отдельным итогом', () => {
    const s = summarizeMonth(
      [
        tx({ id: '1', kind: 'expense', categoryId: 'food', baseAmountMinor: 100 }),
        tx({ id: '2', kind: 'expense', debtId: 'd1', baseAmountMinor: 3_000 }), // дал в долг
        tx({ id: '3', kind: 'income', debtId: 'd1', baseAmountMinor: 1_000 }), // вернули часть
        tx({ id: '4', kind: 'income', debtId: 'd2', baseAmountMinor: 700 }), // взял в долг
        tx({ id: '5', kind: 'income', categoryId: 'salary', baseAmountMinor: 9_000 }),
      ],
      M,
      'TJS',
    );
    expect(s).toMatchObject({ incomeMinor: 9_000, expenseMinor: 100, debtInMinor: 1_700, debtOutMinor: 3_000, debtFlowMinor: -1_300, feeMinor: 0 });
    expect(s.byCategory).toEqual([{ categoryId: 'food', totalMinor: 100 }]);
  });

  it('удалённые операции долга и операции другого месяца не считаются; чужая базовая валюта — в excludedCount', () => {
    const s = summarizeMonth(
      [
        tx({ id: '1', debtId: 'd', baseAmountMinor: 10, deletedAt: '2026-10-07T00:00:00.000Z' }),
        tx({ id: '2', debtId: 'd', baseAmountMinor: 20, occurredOn: '2026-09-30' }),
        tx({ id: '3', debtId: 'd', baseAmountMinor: 40, baseCurrency: 'USD' }),
        transfer('4', 5, { baseCurrency: 'USD' }),
        transfer('5', 0, { baseCurrency: 'USD' }), // без комиссии — считать нечего, не «исключённая»
      ],
      M,
      'TJS',
    );
    expect(s).toMatchObject({ debtOutMinor: 0, feeMinor: 0, expenseMinor: 0, excludedCount: 2 });
  });

  it('debtId: undefined (старые заготовки без поля) считается «нет долга»', () => {
    const row = { ...tx({ id: '1', baseAmountMinor: 10 }) } as Partial<ReturnType<typeof tx>>;
    delete row.debtId;
    expect(summarizeMonth([row as ReturnType<typeof tx>], M, 'TJS').expenseMinor).toBe(10);
  });

  it('переполнение комиссий — явная ошибка', () => {
    expect(() => summarizeMonth([transfer('1', Number.MAX_SAFE_INTEGER), transfer('2', 10)], M, 'TJS')).toThrow(/Переполнение/);
  });
});

describe('summarizeDay: итог дня по тем же правилам', () => {
  it('netMinor = доходы − расходы с комиссиями; долги отдельно', () => {
    const d = summarizeDay(
      [
        tx({ id: '1', kind: 'income', baseAmountMinor: 1_000 }),
        tx({ id: '2', kind: 'expense', baseAmountMinor: 300 }),
        transfer('3', 40),
        tx({ id: '4', kind: 'expense', debtId: 'd', baseAmountMinor: 5_000 }),
        tx({ id: '5', kind: 'income', baseAmountMinor: 77, baseCurrency: 'USD' }),
      ],
      'TJS',
    );
    expect(d).toMatchObject({ netMinor: 660, incomeMinor: 1_000, expenseMinor: 340, feeMinor: 40, debtOutMinor: 5_000, excludedCount: 1 });
  });

  it('пустой день', () => {
    expect(summarizeDay([], 'TJS')).toMatchObject({ netMinor: 0, excludedCount: 0, byCategory: [] });
  });

  it('месяц и день согласованы: сумма итогов дней = итог месяца', () => {
    const rows = [
      tx({ id: '1', kind: 'income', baseAmountMinor: 1_000, occurredOn: '2026-10-01' }),
      tx({ id: '2', kind: 'expense', baseAmountMinor: 300, occurredOn: '2026-10-02' }),
      transfer('3', 40, { occurredOn: '2026-10-02' }),
      tx({ id: '4', kind: 'expense', debtId: 'd', baseAmountMinor: 5_000, occurredOn: '2026-10-03' }),
    ];
    const month = summarizeMonth(rows, M, 'TJS');
    const days = groupByDay(rows).map((g) => summarizeDay(g.items, 'TJS'));
    expect(days.reduce((a, d) => a + d.incomeMinor, 0)).toBe(month.incomeMinor);
    expect(days.reduce((a, d) => a + d.expenseMinor, 0)).toBe(month.expenseMinor);
    expect(days.reduce((a, d) => a + d.debtFlowMinor, 0)).toBe(month.debtFlowMinor);
  });
});

describe('filterTransactions: по долгу', () => {
  it('debtId отбирает операции только этого долга; остальные фильтры работают вместе с ним', () => {
    const rows = [
      tx({ id: '1', debtId: 'd1', occurredOn: '2026-10-01' }),
      tx({ id: '2', debtId: 'd1', occurredOn: '2026-10-09', kind: 'income' }),
      tx({ id: '3', debtId: 'd2' }),
      tx({ id: '4', debtId: null }),
    ];
    expect(filterTransactions(rows, { debtId: 'd1' }).map((t) => t.id)).toEqual(['2', '1']);
    expect(filterTransactions(rows, { debtId: 'd1', kind: 'income' }).map((t) => t.id)).toEqual(['2']);
    expect(filterTransactions(rows, { debtId: 'нет' })).toEqual([]);
    expect(filterTransactions(rows, {})).toHaveLength(4);
  });
});
