import { describe, expect, it } from 'vitest';
import { filterTransactions } from '@/db';
import { tx } from './helpers';

describe('фильтр «без категории»', () => {
  it('переводы не попадают в «без категории» (в описании фильтра: только расходы и доходы)', () => {
    const list = [
      tx({ id: 'transfer', kind: 'transfer', toWalletId: 'w2', toAmountMinor: 100, baseAmountMinor: 0, fxRate: null, fxSource: null }),
      tx({ id: 'expense-no-cat', categoryId: null }),
      tx({ id: 'income-no-cat', kind: 'income', categoryId: null }),
    ];
    const ids = filterTransactions(list, { categoryId: null }).map((t) => t.id).sort();
    expect(ids).toEqual(['expense-no-cat', 'income-no-cat']);
  });
});
