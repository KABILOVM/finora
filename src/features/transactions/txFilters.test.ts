import { describe, expect, it } from 'vitest';
import { activeFilterCount, activeFilterLabels, totalsByCurrency, withKind } from './txFilters';

describe('фильтры из шита «Фильтры»: чистая логика', () => {
  it('activeFilterCount: считает только то, что лежит в шите (кошелёк, вид, категория)', () => {
    expect(activeFilterCount({ walletId: '', kind: '', categoryId: '' })).toBe(0);
    expect(activeFilterCount({ walletId: 'w1', kind: '', categoryId: '' })).toBe(1);
    expect(activeFilterCount({ walletId: 'w1', kind: 'expense', categoryId: '' })).toBe(2);
    expect(activeFilterCount({ walletId: 'w1', kind: 'income', categoryId: '__none__' })).toBe(3); // «Без категории» — тоже фильтр
  });

  it('withKind: категория другого вида и любая при «Переводы» сбрасывается, подходящая остаётся', () => {
    const base = { walletId: 'w1', kind: '' as const, categoryId: 'c1' };
    expect(withKind(base, 'income', 'expense')).toEqual({ walletId: 'w1', kind: 'income', categoryId: '' });
    expect(withKind(base, 'expense', 'expense')).toEqual({ walletId: 'w1', kind: 'expense', categoryId: 'c1' });
    expect(withKind(base, 'transfer', 'expense')).toEqual({ walletId: 'w1', kind: 'transfer', categoryId: '' });
    expect(withKind(base, '', 'expense')).toEqual({ walletId: 'w1', kind: '', categoryId: 'c1' });
    // «Без категории» (вида нет) к расходам и доходам подходит
    expect(withKind({ ...base, categoryId: '__none__' }, 'income', undefined).categoryId).toBe('__none__');
  });

  it('activeFilterLabels: названия включённых фильтров по порядку', () => {
    const wallets = [{ id: 'w1', name: 'Карта' }];
    const categories = [{ id: 'c1', name: 'Еда' }];
    expect(activeFilterLabels({ walletId: '', kind: '', categoryId: '' }, wallets, categories)).toEqual([]);
    expect(activeFilterLabels({ walletId: 'w1', kind: 'expense', categoryId: 'c1' }, wallets, categories)).toEqual(['Карта', 'Расходы', 'Еда']);
    expect(activeFilterLabels({ walletId: '', kind: '', categoryId: '__none__' }, wallets, categories)).toEqual(['Без категории']);
  });
});

describe('totalsByCurrency', () => {
  const cur = (id: string) => ({ a: 'TJS', b: 'USD' })[id as 'a' | 'b'];
  it('суммирует доходы и расходы по валютам счетов, пропуская переводы и долги', () => {
    const r = totalsByCurrency(
      [
        { kind: 'expense', walletId: 'a', amountMinor: 500 },
        { kind: 'expense', walletId: 'a', amountMinor: 250 },
        { kind: 'expense', walletId: 'b', amountMinor: 2000 },
        { kind: 'income', walletId: 'b', amountMinor: 9000 },
        { kind: 'transfer', walletId: 'a', amountMinor: 100 },
        { kind: 'expense', walletId: 'a', amountMinor: 700, debtId: 'd' },
      ],
      cur,
    );
    expect(r).toEqual([
      { currency: 'TJS', incomeMinor: 0, expenseMinor: 750 },
      { currency: 'USD', incomeMinor: 9000, expenseMinor: 2000 },
    ]);
  });
});
