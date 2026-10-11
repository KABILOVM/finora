import { describe, expect, it } from 'vitest';
import { summarizeDay } from '@/db';
import { dayTotal } from '@/features/transactions/txFilters';
import { tx } from './helpers';

describe('итог дня в списке операций = итог дня в сводке', () => {
  it('комиссия перевода и операции по долгу считаются одинаково в dayTotal и summarizeDay', () => {
    const items = [
      tx({ id: 'a', kind: 'transfer', toWalletId: 'w2', toAmountMinor: 9_800, amountMinor: 10_000, baseAmountMinor: 200, fxRate: null, fxSource: null }),
      tx({ id: 'b', kind: 'expense', amountMinor: 50_000, baseAmountMinor: 50_000, debtId: 'debt-1' }),
      tx({ id: 'c', kind: 'expense', amountMinor: 100, baseAmountMinor: 100 }),
    ];
    const day = dayTotal(items, 'TJS');
    const sum = summarizeDay(items, 'TJS');
    expect(day?.netMinor).toBe(sum.netMinor); // -300 (комиссия 200 + расход 100); долг не входит
  });
});
