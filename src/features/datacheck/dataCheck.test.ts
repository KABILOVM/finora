import { describe, expect, it } from 'vitest';
import { checkData, DUPLICATE_DAYS, issueCount, MAX_ITEMS, OUTLIER_DAYS, UNCATEGORIZED_DAYS, type CheckTx } from './dataCheck';

const BASE = 'TJS';
const TODAY = '2026-10-15';
let seq = 0;
const tx = (over: Partial<CheckTx> & { occurredOn: string; amountMinor: number }): CheckTx => ({
  id: over.id ?? `t${String(++seq).padStart(4, '0')}`,
  kind: 'expense',
  walletId: 'w1',
  categoryId: 'food',
  baseAmountMinor: over.amountMinor,
  baseCurrency: BASE,
  note: '',
  debtId: null,
  recurringRuleId: null,
  deletedAt: null,
  ...over,
});
const wallets = [
  { id: 'w1', name: 'Наличные', currency: 'TJS', archivedAt: null },
  { id: 'w2', name: 'Доллары', currency: 'USD', archivedAt: null },
  { id: 'old', name: 'Старый', currency: 'TJS', archivedAt: '2026-01-01T00:00:00.000Z' },
];
const check = (txs: CheckTx[], balances: [string, number][] = []) => checkData({ txs, wallets, balances: new Map(balances), today: TODAY, base: BASE });

describe('checkData: дубли', () => {
  it('одинаковые траты в один день за последние 180 дней', () => {
    const a = tx({ occurredOn: '2026-10-10', amountMinor: 1_500, note: 'кофе', id: 'a' });
    const b = tx({ occurredOn: '2026-10-10', amountMinor: 1_500, note: 'кофе', id: 'b' });
    const old = [tx({ occurredOn: '2026-01-01', amountMinor: 700, note: 'чай' }), tx({ occurredOn: '2026-01-01', amountMinor: 700, note: 'чай' })];
    const c = check([a, b, ...old]);
    expect(DUPLICATE_DAYS).toBe(180);
    expect(c.dupes.map((d) => d.txIds)).toEqual([['a', 'b']]); // январские — старше 180 дней
  });
  it('удалённые не считаются', () => {
    const a = tx({ occurredOn: '2026-10-10', amountMinor: 1_500, note: 'кофе' });
    const b = tx({ occurredOn: '2026-10-10', amountMinor: 1_500, note: 'кофе', deletedAt: '2026-10-11T00:00:00.000Z' });
    expect(check([a, b]).dupes).toEqual([]);
  });
});

describe('checkData: без категории', () => {
  it('расходы и доходы без категории за 90 дней, свежие первыми; счётчик больше показанного списка', () => {
    expect(UNCATEGORIZED_DAYS).toBe(90);
    const rows = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => tx({ occurredOn: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, amountMinor: 100 + i, categoryId: null }));
    const c = check(rows);
    expect(c.uncategorized.total).toBe(MAX_ITEMS + 5);
    expect(c.uncategorized.items).toHaveLength(MAX_ITEMS);
    expect(c.uncategorized.items[0]!.occurredOn >= c.uncategorized.items[MAX_ITEMS - 1]!.occurredOn).toBe(true);
  });
  it('не считаются: переводы, долги, корректировки, по расписанию, старше 90 дней, будущие, с категорией', () => {
    const rows = [
      tx({ occurredOn: '2026-10-01', amountMinor: 1, categoryId: null, kind: 'transfer' }),
      tx({ occurredOn: '2026-10-01', amountMinor: 2, categoryId: null, debtId: 'd' }),
      tx({ occurredOn: '2026-10-01', amountMinor: 3, categoryId: null, fxSource: 'adjust' }),
      tx({ occurredOn: '2026-10-01', amountMinor: 4, categoryId: null, recurringRuleId: 'r' }),
      tx({ occurredOn: '2026-06-01', amountMinor: 5, categoryId: null }),
      tx({ occurredOn: '2026-10-20', amountMinor: 6, categoryId: null }),
      tx({ occurredOn: '2026-10-01', amountMinor: 7 }),
    ];
    expect(check(rows).uncategorized.total).toBe(0);
  });
  it('сумма — в валюте кошелька', () => {
    const c = check([tx({ occurredOn: '2026-10-01', amountMinor: 1_000, categoryId: null, walletId: 'w2', baseAmountMinor: 10_900 })]);
    expect(c.uncategorized.items[0]).toMatchObject({ amountMinor: 1_000, currency: 'USD', kind: 'expense' });
  });
});

describe('checkData: дата в будущем', () => {
  it('операции позже сегодняшнего дня, ближайшие первыми, с числом дней', () => {
    const c = check([tx({ occurredOn: '2062-10-15', amountMinor: 100, id: 'far' }), tx({ occurredOn: '2026-10-18', amountMinor: 200, id: 'near' }), tx({ occurredOn: '2026-10-15', amountMinor: 300 })]);
    expect(c.future.total).toBe(2);
    expect(c.future.items.map((f) => f.id)).toEqual(['near', 'far']);
    expect(c.future.items[0]).toMatchObject({ daysAhead: 3, key: 'fut:near' });
  });
  it('долги и корректировки не считаются; перевод считается', () => {
    const c = check([tx({ occurredOn: '2026-11-01', amountMinor: 1, debtId: 'd' }), tx({ occurredOn: '2026-11-01', amountMinor: 2, fxSource: 'adjust' }), tx({ occurredOn: '2026-11-01', amountMinor: 3, kind: 'transfer', categoryId: null })]);
    expect(c.future.items.map((f) => f.kind)).toEqual(['transfer']);
  });
});

describe('checkData: выбросы', () => {
  const history = (n: number, amount = 1_000) => Array.from({ length: n }, (_, i) => tx({ occurredOn: `2026-0${i + 3}-10`, amountMinor: amount }));

  it('в десять раз больше обычной и больше любой другой — выброс (лишний ноль)', () => {
    const typo = tx({ occurredOn: '2026-10-10', amountMinor: 100_000, note: 'обед', id: 'typo' });
    const c = check([...history(5), typo]);
    expect(c.outliers).toEqual([{ key: 'out:typo', txId: 'typo', categoryId: 'food', amountMinor: 100_000, usualMinor: 1_000, occurredOn: '2026-10-10', note: 'обед' }]);
  });
  it('ровно в десять раз — выброс, чуть меньше — нет', () => {
    expect(check([...history(5), tx({ occurredOn: '2026-10-10', amountMinor: 10_000 })]).outliers).toHaveLength(1);
    expect(check([...history(5), tx({ occurredOn: '2026-10-10', amountMinor: 9_999 })]).outliers).toHaveLength(0);
  });
  it('мало трат в категории (меньше шести) — нечего сравнивать', () => {
    expect(check([...history(4), tx({ occurredOn: '2026-10-10', amountMinor: 100_000 })]).outliers).toEqual([]);
  });
  it('старше года, по расписанию и без категории не считаются', () => {
    expect(OUTLIER_DAYS).toBe(365);
    const rows = [...history(5), tx({ occurredOn: '2025-01-10', amountMinor: 100_000 }), tx({ occurredOn: '2026-10-10', amountMinor: 100_000, recurringRuleId: 'r' }), tx({ occurredOn: '2026-10-10', amountMinor: 100_000, categoryId: null })];
    expect(check(rows).outliers).toEqual([]);
  });
});

describe('checkData: отрицательные остатки', () => {
  it('активные кошельки с минусом; архивные и нулевые — нет', () => {
    const c = check([], [['w1', -5_000], ['w2', 0], ['old', -9_999]]);
    expect(c.negative).toEqual([{ key: 'neg:w1', walletId: 'w1', name: 'Наличные', currency: 'TJS', balanceMinor: -5_000 }]);
  });
});

describe('issueCount', () => {
  it('складывает все находки; пусто — ноль', () => {
    expect(issueCount(check([]))).toBe(0);
    expect(issueCount(check([tx({ occurredOn: '2026-10-01', amountMinor: 1, categoryId: null })], [['w1', -1]]))).toBe(2);
  });
});
