import { describe, expect, it } from 'vitest';
import { activeFilterCount, activeFilterLabels, filtersFromParams, NO_CATEGORY, totalsByCurrency, transactionsLink, withKind } from './txFilters';

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

describe('filtersFromParams: фильтры из адреса', () => {
  const q = (s: string) => new URLSearchParams(s);
  const today = '2026-10-15';

  it('нет параметров — ничего не меняет', () => {
    expect(filtersFromParams(q(''), today)).toEqual({});
  });
  it('месяц: другой — period «month», сегодняшний — «this»', () => {
    expect(filtersFromParams(q('month=2026-09'), today)).toEqual({ period: 'month', month: '2026-09' });
    expect(filtersFromParams(q('month=2026-10'), today)).toEqual({ period: 'this', month: '2026-10' });
  });
  it('категория: id, «none» — без категории', () => {
    expect(filtersFromParams(q('category=abc-123'), today)).toEqual({ categoryId: 'abc-123' });
    expect(filtersFromParams(q('category=none'), today)).toEqual({ categoryId: NO_CATEGORY });
  });
  it('вид операции', () => {
    expect(filtersFromParams(q('kind=expense'), today)).toEqual({ kind: 'expense' });
    expect(filtersFromParams(q('kind=transfer'), today)).toEqual({ kind: 'transfer' });
  });
  it('всё вместе', () => {
    expect(filtersFromParams(q('month=2026-08&category=c1&kind=expense'), today)).toEqual({ period: 'month', month: '2026-08', categoryId: 'c1', kind: 'expense' });
  });
  it.each([
    ['month=2026-13'],
    ['month=2026-9'],
    ['month=1999-12'],
    ['month=2101-01'],
    ['month=вчера'],
    ['month='],
    ['category=a b'],
    ['category=%3Cscript%3E'],
    ['category='],
    ['category=' + 'x'.repeat(65)],
    ['kind=все'],
    ['kind=EXPENSE'],
  ])('мусор «%s» пропускается', (s) => {
    expect(filtersFromParams(q(s), today)).toEqual({});
  });
});

describe('transactionsLink: ссылка с готовыми фильтрами', () => {
  it('месяц, категория и вид', () => {
    expect(transactionsLink({ month: '2026-10', categoryId: 'c1', kind: 'expense' })).toBe('/transactions?month=2026-10&category=c1&kind=expense');
  });
  it('без категории — none; без категории и вида — только месяц', () => {
    expect(transactionsLink({ month: '2026-10', categoryId: null })).toBe('/transactions?month=2026-10&category=none');
    expect(transactionsLink({ month: '2026-09' })).toBe('/transactions?month=2026-09');
  });
  it('ссылка разбирается обратно', () => {
    const link = transactionsLink({ month: '2026-09', categoryId: 'c-1', kind: 'expense' });
    expect(filtersFromParams(new URLSearchParams(link.split('?')[1]), '2026-10-15')).toEqual({ period: 'month', month: '2026-09', categoryId: 'c-1', kind: 'expense' });
  });
});

