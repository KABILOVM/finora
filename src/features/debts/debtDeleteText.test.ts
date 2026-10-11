import { describe, expect, it } from 'vitest';
import { previewDebtDelete, previewText } from './debtDeleteText';

const tx = (kind: 'income' | 'expense', amountMinor: number, walletId = 'w1', deletedAt: string | null = null) => [`${kind}${amountMinor}`, { kind, walletId, amountMinor, deletedAt }] as const;

describe('previewDebtDelete', () => {
  const wallets = new Map([['w1', { currency: 'TJS' }], ['w2', { currency: 'USD' }]]);
  it('считает количество и суммы по валютам, пропуская удалённые', () => {
    const p = previewDebtDelete(new Map([tx('expense', 40_000), tx('income', 10_000), tx('income', 500, 'w2'), tx('income', 9, 'w1', 'x')]), wallets, 'TJS');
    expect(p.count).toBe(3);
    expect(previewText(p).replace(/\s/g, ' ')).toMatch(/^3 операции: расходов на .*400.*, доходов на .*100.*и.*5/);
  });
  it('нет операций', () => {
    expect(previewText(previewDebtDelete(new Map(), wallets, 'TJS'))).toBe('Операций по этому долгу нет.');
  });
  it('склонение', () => {
    const one = previewText(previewDebtDelete(new Map([tx('expense', 100)]), wallets, 'TJS'));
    expect(one.startsWith('1 операция')).toBe(true);
    const five = new Map([1, 2, 3, 4, 5].map((n) => tx('expense', n)));
    expect(previewText(previewDebtDelete(five, wallets, 'TJS')).startsWith('5 операций')).toBe(true);
  });
});
