import { describe, expect, it } from 'vitest';
import { monthlyEquivalent, monthlyTotals } from './monthly';

const rule = (over: Partial<Parameters<typeof monthlyTotals>[0][number]> = {}) => ({
  id: 'r',
  kind: 'expense' as const,
  walletId: 'w-tjs',
  amountMinor: 100_000,
  frequency: 'monthly' as const,
  intervalN: 1,
  endOn: null,
  archivedAt: null,
  deletedAt: null,
  ...over,
});
const cur = (w: string) => (w === 'w-tjs' ? 'TJS' : w === 'w-usd' ? 'USD' : undefined);

describe('monthlyEquivalent: платёж, пересчитанный на месяц', () => {
  it('раз в месяц — как есть; раз в два месяца — половина; раз в год — двенадцатая часть', () => {
    expect(monthlyEquivalent(100_000, 'monthly', 1)).toBe(100_000);
    expect(monthlyEquivalent(100_000, 'monthly', 2)).toBe(50_000);
    expect(monthlyEquivalent(120_000, 'yearly', 1)).toBe(10_000);
  });
  it('раз в неделю — ×52/12, раз в две недели — вдвое меньше; каждый день — ×365/12', () => {
    expect(monthlyEquivalent(1_200, 'weekly', 1)).toBe(5_200);
    expect(monthlyEquivalent(1_200, 'weekly', 2)).toBe(2_600);
    expect(monthlyEquivalent(1_200, 'daily', 1)).toBe(36_500);
  });
  it('округляет до ближайшей минорной единицы, а суммы до 1e15 не теряют точность', () => {
    expect(monthlyEquivalent(100, 'weekly', 1)).toBe(433); // 433,33
    expect(monthlyEquivalent(1_000_000_000_000_000, 'monthly', 3)).toBe(333_333_333_333_333);
  });
});

describe('monthlyTotals: итоги в месяц', () => {
  const today = '2026-10-15';

  it('расходы и доходы отдельно, по валютам кошельков; базовая первой', () => {
    const r = monthlyTotals(
      [rule({ amountMinor: 200_000 }), rule({ id: 'b', kind: 'income', amountMinor: 500_000 }), rule({ id: 'c', walletId: 'w-usd', amountMinor: 1_000 })],
      cur,
      today,
      'TJS',
    );
    expect(r).toEqual([
      { currency: 'TJS', expenseMinor: 200_000, incomeMinor: 500_000 },
      { currency: 'USD', expenseMinor: 1_000, incomeMinor: 0 },
    ]);
  });

  it('не считаются: переводы, архив, удалённые, закончившиеся, остановленные, без кошелька, с нулевой суммой', () => {
    const r = monthlyTotals(
      [
        rule({ id: 'ok', amountMinor: 10_000 }),
        rule({ id: 't', kind: 'transfer' }),
        rule({ id: 'a', archivedAt: '2026-10-01T00:00:00.000Z' }),
        rule({ id: 'd', deletedAt: '2026-10-01T00:00:00.000Z' }),
        rule({ id: 'e', endOn: '2026-10-14' }),
        rule({ id: 's' }),
        rule({ id: 'w', walletId: 'нет' }),
        rule({ id: 'z', amountMinor: 0 }),
      ],
      cur,
      today,
      'TJS',
      (x) => x.id === 's',
    );
    expect(r).toEqual([{ currency: 'TJS', expenseMinor: 10_000, incomeMinor: 0 }]);
  });

  it('платёж, который заканчивается сегодня, ещё считается (дата окончания — последний день)', () => {
    expect(monthlyTotals([rule({ endOn: today })], cur, today, 'TJS')).toHaveLength(1);
  });

  it('частый платёж с огромной суммой не даёт небезопасное число: итог «не посчитать» (null), а не искажённая сумма', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    expect(monthlyTotals([rule({ amountMinor: huge, frequency: 'daily' })], cur, today, 'TJS')).toBeNull();
    expect(monthlyTotals([rule({ amountMinor: huge, frequency: 'weekly' })], cur, today, 'TJS')).toBeNull();
  });

  it('пусто — пустой список; не помещается в расчёт — null, а не неверное число', () => {
    expect(monthlyTotals([], cur, today, 'TJS')).toEqual([]);
    const huge = Number.MAX_SAFE_INTEGER;
    expect(monthlyTotals([rule({ id: '1', amountMinor: huge }), rule({ id: '2', amountMinor: huge })], cur, today, 'TJS')).toBeNull();
  });
});
