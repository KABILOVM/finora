import { describe, expect, it } from 'vitest';
import type { CategoryTotal } from '@/db/queries';
import { categoryDeltas, monthlySeries, topExpenses, weekdayOf, weekdayProfile } from './analytics';

type Tx = Parameters<typeof monthlySeries>[0][number] & { id: string };
let n = 0;
const tx = (over: Partial<Tx> & Pick<Tx, 'occurredOn' | 'kind' | 'baseAmountMinor'>): Tx =>
  ({
    id: `t${++n}`,
    walletId: 'w',
    toWalletId: null,
    categoryId: null,
    note: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    baseCurrency: 'TJS',
    ...over,
  }) as Tx;

describe('monthlySeries: доходы и расходы по месяцам', () => {
  const txs = [
    tx({ occurredOn: '2026-08-10', kind: 'expense', baseAmountMinor: 1_000 }),
    tx({ occurredOn: '2026-09-02', kind: 'income', baseAmountMinor: 50_000 }),
    tx({ occurredOn: '2026-09-15', kind: 'expense', baseAmountMinor: 12_000 }),
    tx({ occurredOn: '2026-10-05', kind: 'expense', baseAmountMinor: 3_000 }),
    tx({ occurredOn: '2026-10-06', kind: 'expense', baseAmountMinor: 700, debtId: 'd1' }), // долг — не расход
    tx({ occurredOn: '2026-10-07', kind: 'expense', baseAmountMinor: 9_999, baseCurrency: 'USD' }), // другая основная валюта
    tx({ occurredOn: '2026-10-08', kind: 'expense', baseAmountMinor: 500, deletedAt: '2026-10-09T00:00:00.000Z' }),
  ];

  it('месяцы по порядку, старые первыми; пустой месяц — нули; чистый поток = доходы − расходы', () => {
    expect(monthlySeries(txs, '2026-10', 4, 'TJS')).toEqual([
      { month: '2026-07', incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
      { month: '2026-08', incomeMinor: 0, expenseMinor: 1_000, netMinor: -1_000 },
      { month: '2026-09', incomeMinor: 50_000, expenseMinor: 12_000, netMinor: 38_000 },
      { month: '2026-10', incomeMinor: 0, expenseMinor: 3_000, netMinor: -3_000 },
    ]);
  });

  it('счёт месяцев пересекает границу года', () => {
    expect(monthlySeries([], '2027-02', 4, 'TJS').map((p) => p.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('один месяц и ни одного', () => {
    expect(monthlySeries(txs, '2026-09', 1, 'TJS')).toHaveLength(1);
    expect(monthlySeries(txs, '2026-09', 0, 'TJS')).toEqual([]);
  });

  it('комиссия перевода — расход месяца', () => {
    const fee = tx({ occurredOn: '2026-10-03', kind: 'transfer', baseAmountMinor: 250, toWalletId: 'w2' });
    expect(monthlySeries([fee], '2026-10', 1, 'TJS')[0]).toMatchObject({ expenseMinor: 250 });
  });

  it('суммы не помещаются в безопасное целое — RangeError, а не неверное число', () => {
    const big = [
      tx({ occurredOn: '2026-10-01', kind: 'expense', baseAmountMinor: Number.MAX_SAFE_INTEGER }),
      tx({ occurredOn: '2026-10-02', kind: 'expense', baseAmountMinor: 10 }),
    ];
    expect(() => monthlySeries(big, '2026-10', 1, 'TJS')).toThrow(RangeError);
  });
});

describe('categoryDeltas: сравнение с прошлым месяцем', () => {
  const cat = (categoryId: string | null, totalMinor: number, kind?: 'fee'): CategoryTotal => ({ categoryId, totalMinor, ...(kind ? { kind } : {}) }) as CategoryTotal;

  it('больше, меньше, столько же, новая и ушедшая категории', () => {
    const rows = categoryDeltas(
      [cat('food', 30_000), cat('taxi', 5_000), cat('home', 10_000), cat('gift', 2_000)],
      [cat('food', 20_000), cat('taxi', 10_000), cat('home', 10_000), cat('rent', 40_000)],
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['food']).toMatchObject({ status: 'up', deltaMinor: 10_000, percent: 50, currentMinor: 30_000, previousMinor: 20_000 });
    expect(by['taxi']).toMatchObject({ status: 'down', deltaMinor: -5_000, percent: -50 });
    expect(by['home']).toMatchObject({ status: 'same', deltaMinor: 0, percent: 0 });
    expect(by['gift']).toMatchObject({ status: 'new', deltaMinor: 2_000, percent: null, previousMinor: 0 });
    expect(by['rent']).toMatchObject({ status: 'gone', deltaMinor: -40_000, percent: -100, currentMinor: 0 });
  });

  it('порядок: больше в этом месяце — выше; ушедшие — в конце, самая крупная из прошлого первой', () => {
    const rows = categoryDeltas([cat('a', 1_000), cat('b', 5_000)], [cat('c', 100), cat('d', 900)]);
    expect(rows.map((r) => r.key)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('«без категории» и «комиссии» различаются между собой и от категорий', () => {
    const rows = categoryDeltas([cat(null, 400), cat(null, 100, 'fee')], [cat(null, 200), cat(null, 300, 'fee')]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['none']).toMatchObject({ currentMinor: 400, previousMinor: 200, status: 'up' });
    expect(by['fee']).toMatchObject({ currentMinor: 100, previousMinor: 300, status: 'down', kind: 'fee' });
  });

  it('процент округляется как обычно', () => {
    expect(categoryDeltas([cat('a', 1_001)], [cat('a', 1_000)])[0]?.percent).toBe(0); // +0,1%
    expect(categoryDeltas([cat('a', 1_300)], [cat('a', 1_000)])[0]?.percent).toBe(30);
    expect(categoryDeltas([cat('a', 2)], [cat('a', 3)])[0]?.percent).toBe(-33);
  });

  it('пусто и там, и там — пусто', () => {
    expect(categoryDeltas([], [])).toEqual([]);
  });
});

describe('weekdayProfile: средний расход по дням недели', () => {
  it('weekdayOf: понедельник — 0, воскресенье — 6', () => {
    expect(weekdayOf('2026-10-12')).toBe(0); // понедельник
    expect(weekdayOf('2026-10-15')).toBe(3); // четверг
    expect(weekdayOf('2026-10-18')).toBe(6);
  });

  it('прошлый месяц считается целиком; среднее = расход ÷ число таких дней (вниз)', () => {
    // сентябрь 2026: 30 дней, начинается со вторника. Вторников 5 (1, 8, 15, 22, 29), понедельников 4 (7, 14, 21, 28)
    const txs = [
      tx({ occurredOn: '2026-09-01', kind: 'expense', baseAmountMinor: 1_000 }),
      tx({ occurredOn: '2026-09-08', kind: 'expense', baseAmountMinor: 2_000 }),
      tx({ occurredOn: '2026-09-07', kind: 'expense', baseAmountMinor: 700 }),
    ];
    const p = weekdayProfile(txs, '2026-09', '2026-10-15', 'TJS');
    expect(p).toHaveLength(7);
    expect(p[1]).toEqual({ weekday: 1, totalMinor: 3_000, days: 5, avgMinor: 600 });
    expect(p[0]).toEqual({ weekday: 0, totalMinor: 700, days: 4, avgMinor: 175 });
    expect(p.reduce((s, x) => s + x.days, 0)).toBe(30);
    expect(p[2]).toMatchObject({ totalMinor: 0, avgMinor: 0 });
  });

  it('текущий месяц — только дни до сегодняшнего включительно', () => {
    const p = weekdayProfile([tx({ occurredOn: '2026-10-15', kind: 'expense', baseAmountMinor: 900 })], '2026-10', '2026-10-15', 'TJS');
    expect(p.reduce((s, x) => s + x.days, 0)).toBe(15);
    expect(p[3]).toMatchObject({ weekday: 3, days: 3, totalMinor: 900, avgMinor: 300 }); // 1, 8 и 15 октября — четверги
  });

  it('месяц ещё не начался — все дни нули, делить не на что', () => {
    const p = weekdayProfile([], '2026-11', '2026-10-15', 'TJS');
    expect(p.every((x) => x.days === 0 && x.avgMinor === 0 && x.totalMinor === 0)).toBe(true);
  });

  it('долги, переводы без комиссии и удалённые операции в расход не входят', () => {
    const p = weekdayProfile(
      [
        tx({ occurredOn: '2026-09-01', kind: 'expense', baseAmountMinor: 500, debtId: 'd' }),
        tx({ occurredOn: '2026-09-01', kind: 'transfer', baseAmountMinor: 0, toWalletId: 'w2' }),
        tx({ occurredOn: '2026-09-01', kind: 'expense', baseAmountMinor: 800, deletedAt: '2026-09-02T00:00:00.000Z' }),
        tx({ occurredOn: '2026-09-01', kind: 'expense', baseAmountMinor: 300 }),
      ],
      '2026-09',
      '2026-10-15',
      'TJS',
    );
    expect(p[1]?.totalMinor).toBe(300);
  });

  it('февраль високосного года: 29 дней', () => {
    expect(weekdayProfile([], '2028-02', '2028-03-10', 'TJS').reduce((s, x) => s + x.days, 0)).toBe(29);
  });
});

describe('topExpenses: самые крупные траты', () => {
  const txs = [
    tx({ id: 'a', occurredOn: '2026-10-02', kind: 'expense', baseAmountMinor: 5_000, categoryId: 'food', note: 'базар' }),
    tx({ id: 'b', occurredOn: '2026-10-03', kind: 'expense', baseAmountMinor: 90_000, categoryId: 'rent' }),
    tx({ id: 'c', occurredOn: '2026-10-04', kind: 'expense', baseAmountMinor: 5_000 }),
    tx({ id: 'd', occurredOn: '2026-10-05', kind: 'income', baseAmountMinor: 999_999 }),
    tx({ id: 'e', occurredOn: '2026-10-06', kind: 'expense', baseAmountMinor: 70_000, debtId: 'долг' }),
    tx({ id: 'f', occurredOn: '2026-10-07', kind: 'expense', baseAmountMinor: 60_000, baseCurrency: 'USD' }),
    tx({ id: 'g', occurredOn: '2026-10-08', kind: 'expense', baseAmountMinor: 40_000, deletedAt: '2026-10-09T00:00:00.000Z' }),
    tx({ id: 'h', occurredOn: '2026-09-30', kind: 'expense', baseAmountMinor: 80_000 }),
    tx({ id: 'i', occurredOn: '2026-10-09', kind: 'transfer', baseAmountMinor: 100 }),
  ];

  it('только расходы месяца без долгов, удалённых, чужой валюты и переводов; крупные первыми', () => {
    expect(topExpenses(txs, '2026-10', 'TJS').map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('равные суммы: новее — выше', () => {
    expect(topExpenses(txs, '2026-10', 'TJS').map((t) => t.occurredOn)).toEqual(['2026-10-03', '2026-10-04', '2026-10-02']);
  });

  it('лимит и поля строки', () => {
    const top = topExpenses(txs, '2026-10', 'TJS', 1);
    expect(top).toEqual([{ id: 'b', occurredOn: '2026-10-03', categoryId: 'rent', note: '', amountMinor: 90_000 }]);
    expect(topExpenses(txs, '2026-10', 'TJS', 0)).toEqual([]);
  });

  it('месяц без расходов — пусто', () => {
    expect(topExpenses(txs, '2026-07', 'TJS')).toEqual([]);
  });
});
