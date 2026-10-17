import { describe, expect, it } from 'vitest';
import { deleteHint, keepHint, previewDebtDelete, previewText } from './debtDeleteText';

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

describe('пояснения в окне удаления долга', () => {
  const wallets = new Map([['w1', { currency: 'TJS' }]]);
  const many = (n: number) => previewDebtDelete(new Map(Array.from({ length: n }, (_, i) => tx('expense', i + 1))), wallets, 'TJS');

  it('«только долг»: глагол и слова согласуются с числом (1 операция останется, 2 операции останутся, 5 операций останутся)', () => {
    expect(keepHint(1)).toMatch(/^1 операция останется в истории как обычная: .* она считается обычным доходом или расходом месяца и попадёт в итоги/);
    expect(keepHint(2)).toMatch(/^2 операции останутся в истории как обычные: .* они считаются обычными доходами и расходами месяца и попадут/);
    expect(keepHint(5)).toMatch(/^5 операций останутся в истории как обычные/);
    expect(keepHint(21)).toMatch(/^21 операция останется в истории как обычная/);
    expect(keepHint(11)).toMatch(/^11 операций останутся/);
  });

  it('«долг и его операции»: что удалится и что будет с остатками', () => {
    expect(deleteHint(many(2)).replace(/\s/g, ' ')).toMatch(/^Будет удалено: 2 операции: расходов на .+\. Остатки кошельков вернутся такими, как были до этого долга\.$/);
  });

  it('операций нет: одна понятная фраза, без «Будет удалено: Операций… нет.»', () => {
    const none = previewDebtDelete(new Map(), wallets, 'TJS');
    expect(deleteHint(none)).toBe('Операций по этому долгу нет: удалится только сам долг.');
    expect(keepHint(0)).toBe('Операций по этому долгу нет: удалится только сам долг.');
    expect(deleteHint(none)).not.toContain('Будет удалено');
  });
});
