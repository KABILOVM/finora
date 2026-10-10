import { describe, expect, it } from 'vitest';
import { filterTransactions, groupByDay, summarizeMonth } from '@/db';
import { tx } from './helpers';

const rows = [
  tx({ id: 'a', occurredOn: '2026-10-01', walletId: 'w1', categoryId: 'food', note: 'Обед в кафе', createdAt: '2026-10-01T08:00:00.000Z' }),
  tx({ id: 'b', occurredOn: '2026-10-05', walletId: 'w2', categoryId: 'taxi', note: 'ТАКСИ домой', createdAt: '2026-10-05T08:00:00.000Z' }),
  tx({ id: 'c', occurredOn: '2026-10-05', walletId: 'w1', kind: 'income', categoryId: 'salary', amountMinor: 500_000, baseAmountMinor: 500_000, createdAt: '2026-10-05T09:00:00.000Z' }),
  tx({ id: 'd', occurredOn: '2026-10-31', walletId: 'w1', kind: 'transfer', toWalletId: 'w2', toAmountMinor: 100, baseAmountMinor: 0, fxRate: null, fxSource: null, createdAt: '2026-10-31T08:00:00.000Z' }),
  tx({ id: 'e', occurredOn: '2026-09-30', walletId: 'w1', categoryId: null, createdAt: '2026-09-30T08:00:00.000Z' }),
  tx({ id: 'f', occurredOn: '2026-10-06', walletId: 'w1', categoryId: 'food', deletedAt: '2026-10-07T00:00:00.000Z', createdAt: '2026-10-06T08:00:00.000Z' }),
];
const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe('filterTransactions', () => {
  it('без фильтра: все живые, новые сверху; удалённые пропущены', () => {
    expect(ids(filterTransactions(rows))).toEqual(['d', 'c', 'b', 'a', 'e']);
  });

  it('порядок полностью определён: при равной дате — по времени создания, затем по id', () => {
    const same = [tx({ id: '1', createdAt: '2026-10-05T10:00:00.000Z' }), tx({ id: '2', createdAt: '2026-10-05T10:00:00.000Z' }), tx({ id: '3', createdAt: '2026-10-05T11:00:00.000Z' })];
    expect(ids(filterTransactions(same))).toEqual(['3', '2', '1']);
  });

  it('период включает обе границы', () => {
    expect(ids(filterTransactions(rows, { from: '2026-10-01', to: '2026-10-05' }))).toEqual(['c', 'b', 'a']);
    expect(ids(filterTransactions(rows, { from: '2026-10-05', to: '2026-10-05' }))).toEqual(['c', 'b']);
    expect(ids(filterTransactions(rows, { from: '2026-11-01' }))).toEqual([]);
  });

  it('кошелёк: и списания с него, и переводы на него', () => {
    expect(ids(filterTransactions(rows, { walletId: 'w2' }))).toEqual(['d', 'b']);
  });

  it('категория: конкретная, «без категории» (null) и любая (не задана)', () => {
    expect(ids(filterTransactions(rows, { categoryId: 'food' }))).toEqual(['a']);
    // 'd' — перевод: у перевода категории не бывает, в «без категории» он не попадает
    expect(ids(filterTransactions(rows, { categoryId: null }))).toEqual(['e']);
    expect(filterTransactions(rows, {})).toHaveLength(5);
  });

  it('вид операции', () => {
    expect(ids(filterTransactions(rows, { kind: 'income' }))).toEqual(['c']);
    expect(ids(filterTransactions(rows, { kind: 'transfer' }))).toEqual(['d']);
  });

  it('поиск по заметке без учёта регистра (в том числе кириллицы) и пробелов по краям', () => {
    expect(ids(filterTransactions(rows, { search: '  такси ' }))).toEqual(['b']);
    expect(ids(filterTransactions(rows, { search: 'КАФЕ' }))).toEqual(['a']);
    expect(ids(filterTransactions(rows, { search: 'нет такого' }))).toEqual([]);
    expect(filterTransactions(rows, { search: '   ' })).toHaveLength(5);
  });

  it('фильтры сочетаются; вход не мутируется', () => {
    const copy = [...rows];
    expect(ids(filterTransactions(rows, { walletId: 'w1', kind: 'expense', from: '2026-10-01' }))).toEqual(['a']);
    expect(rows).toEqual(copy);
  });
});

describe('groupByDay', () => {
  it('дни от новых к старым, внутри дня новые сверху; удалённые пропущены', () => {
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-31', '2026-10-05', '2026-10-01', '2026-09-30']);
    expect(ids(groups[1]!.items)).toEqual(['c', 'b']);
  });

  it('пустой список — пустой результат', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('summarizeMonth', () => {
  const month = [
    tx({ id: '1', kind: 'expense', categoryId: 'food', baseAmountMinor: 3000 }),
    tx({ id: '2', kind: 'expense', categoryId: 'food', baseAmountMinor: 2000 }),
    tx({ id: '3', kind: 'expense', categoryId: 'taxi', baseAmountMinor: 9000 }),
    tx({ id: '4', kind: 'expense', categoryId: null, baseAmountMinor: 500 }),
    tx({ id: '5', kind: 'income', categoryId: 'salary', baseAmountMinor: 100_000 }),
    tx({ id: '6', kind: 'transfer', baseAmountMinor: 0, fxRate: null, fxSource: null, toWalletId: 'w2', toAmountMinor: 777 }),
    tx({ id: '7', kind: 'expense', categoryId: 'food', baseAmountMinor: 999_999, deletedAt: '2026-10-07T00:00:00.000Z' }),
    tx({ id: '8', kind: 'expense', categoryId: 'food', baseAmountMinor: 111, occurredOn: '2026-11-01' }),
    tx({ id: '9', kind: 'expense', categoryId: 'food', baseAmountMinor: 222, occurredOn: '2026-09-30' }),
    tx({ id: '10', kind: 'expense', categoryId: 'food', baseAmountMinor: 100, baseCurrency: 'USD' }),
    tx({ id: '11', kind: 'income', categoryId: 'salary', baseAmountMinor: 50, baseCurrency: 'USD' }),
  ];

  it('считает по снимкам: без переводов, удалённых и чужих месяцев; по убыванию', () => {
    expect(summarizeMonth(month, '2026-10', 'TJS')).toEqual({
      incomeMinor: 100_000,
      expenseMinor: 14_500,
      byCategory: [
        { categoryId: 'taxi', totalMinor: 9000 },
        { categoryId: 'food', totalMinor: 5000 },
        { categoryId: null, totalMinor: 500 },
      ],
      excludedCount: 2,
    });
  });

  it('операции в иной базовой валюте не смешиваются, а считаются в excludedCount', () => {
    const s = summarizeMonth(month, '2026-10', 'USD');
    expect(s).toMatchObject({ incomeMinor: 50, expenseMinor: 100, excludedCount: 5 });
  });

  it('пустой месяц', () => {
    expect(summarizeMonth([], '2026-10', 'TJS')).toEqual({ incomeMinor: 0, expenseMinor: 0, byCategory: [], excludedCount: 0 });
  });

  it('при равных суммах порядок категорий устойчив (null — последним)', () => {
    const eq = [tx({ id: '1', categoryId: null, baseAmountMinor: 10 }), tx({ id: '2', categoryId: 'b', baseAmountMinor: 10 }), tx({ id: '3', categoryId: 'a', baseAmountMinor: 10 })];
    expect(summarizeMonth(eq, '2026-10', 'TJS').byCategory.map((c) => c.categoryId)).toEqual(['a', 'b', null]);
  });

  it.each(['2026-1', '2026-13', '2026-00', 'октябрь', '2026-10-05', ''])('неверный месяц «%s» — ошибка', (m) => {
    expect(() => summarizeMonth([], m, 'TJS')).toThrow(RangeError);
  });

  it('переполнение суммы — явная ошибка, а не тихая потеря точности', () => {
    const big = [tx({ id: '1', baseAmountMinor: Number.MAX_SAFE_INTEGER }), tx({ id: '2', baseAmountMinor: 10 })];
    expect(() => summarizeMonth(big, '2026-10', 'TJS')).toThrow(/Переполнение/);
  });
});
