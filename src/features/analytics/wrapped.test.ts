import { describe, expect, it } from 'vitest';
import { type AnomalyTx } from './anomalies';
import { buildReport, yearPeriod } from './periods';

type T = AnomalyTx & Parameters<typeof buildReport>[0][number];
import { MIN_STREAK_DAYS, wrappedCards, wrappedFacts } from './wrapped';

const BASE = 'TJS';
const TODAY = '2026-10-15';
let seq = 0;
const tx = (over: Partial<T> & { occurredOn: string; amountMinor: number }): T => ({
  id: over.id ?? `t${String(++seq).padStart(4, '0')}`,
  kind: 'expense',
  walletId: 'w1',
  toWalletId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  categoryId: 'food',
  baseAmountMinor: over.amountMinor,
  baseCurrency: BASE,
  note: '',
  debtId: null,
  recurringRuleId: null,
  deletedAt: null,
  ...over,
});
const name = (id: string | null) => (id === null ? 'Без категории' : id === 'food' ? 'Еда' : id === 'taxi' ? 'Транспорт' : id);

describe('wrappedFacts', () => {
  const period = { from: '2026-10-01', to: '2026-10-14' }; // 14 дней: по два каждого дня недели

  it('операций — расходы и доходы человека; самая крупная трата — по сумме в основной валюте', () => {
    const txs = [
      tx({ occurredOn: '2026-10-02', amountMinor: 100 }),
      tx({ id: 'big', occurredOn: '2026-10-05', amountMinor: 900, note: ' банкет ' }),
      tx({ occurredOn: '2026-10-06', amountMinor: 5_000, kind: 'income', categoryId: 'salary' }),
      tx({ occurredOn: '2026-10-07', amountMinor: 70_000, kind: 'transfer', categoryId: null }),
      tx({ occurredOn: '2026-10-08', amountMinor: 70_000, debtId: 'd' }),
      tx({ occurredOn: '2026-10-08', amountMinor: 70_000, fxSource: 'adjust' }),
      tx({ occurredOn: '2026-10-08', amountMinor: 70_000, deletedAt: 'x' }),
      tx({ occurredOn: '2026-09-30', amountMinor: 70_000 }), // вне периода
    ];
    const f = wrappedFacts(txs, period, BASE);
    expect(f.operations).toBe(3);
    expect(f.biggest).toEqual({ txId: 'big', categoryId: 'food', note: 'банкет', amountMinor: 900, occurredOn: '2026-10-05' });
  });

  it('день недели: средняя трата в такой день; нужно хотя бы 4 таких дня', () => {
    // 1 октября 2026 — четверг. Период с 1 по 28 октября: по четыре каждого дня; тратим только по четвергам (1, 8, 15, 22)
    const thursdays = ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'].map((d) => tx({ occurredOn: d, amountMinor: 400 }));
    const f = wrappedFacts(thursdays, { from: '2026-10-01', to: '2026-10-28' }, BASE);
    expect(f.weekday).toEqual({ day: 3, avgMinor: 400 });
    // две недели — по два таких дня: данных мало
    expect(wrappedFacts(thursdays.slice(0, 2), period, BASE).weekday).toBeNull();
  });

  it('серия дней без трат: самая длинная, от первой записи периода; короче трёх — не серия', () => {
    expect(MIN_STREAK_DAYS).toBe(3);
    const txs = [tx({ occurredOn: '2026-10-01', amountMinor: 100 }), tx({ occurredOn: '2026-10-06', amountMinor: 100 }), tx({ occurredOn: '2026-10-08', amountMinor: 100 })];
    // между 1 и 6 октября — 2, 3, 4, 5 (четыре дня); между 6 и 8 — один день; после 8-го до 14-го — шесть дней (9–14)
    expect(wrappedFacts(txs, period, BASE).streak).toEqual({ days: 6, from: '2026-10-09', to: '2026-10-14' });
    const dense = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14].map((d) => tx({ occurredOn: `2026-10-${String(d).padStart(2, '0')}`, amountMinor: 100 }));
    expect(wrappedFacts(dense, period, BASE).streak).toBeNull();
  });

  it('до первой записи периода дни не считаются «без трат»', () => {
    const txs = [tx({ occurredOn: '2026-10-12', amountMinor: 100 })];
    expect(wrappedFacts(txs, period, BASE).streak).toBeNull(); // 13 и 14 — два дня, меньше трёх
    // с 1 по 11 октября записей нет вовсе: серия считается только после 12-го, а не «11 дней без трат»
    expect(wrappedFacts(txs, { from: '2026-10-01', to: '2026-10-20' }, BASE).streak).toEqual({ days: 8, from: '2026-10-13', to: '2026-10-20' });
  });

  it('пустой период — нули', () => {
    expect(wrappedFacts([], period, BASE)).toEqual({ operations: 0, biggest: null, weekday: null, streak: null });
  });
});

describe('wrappedCards', () => {
  const year = yearPeriod(2026, TODAY)!;
  const txs = [
    tx({ occurredOn: '2026-02-01', amountMinor: 300_000, kind: 'income', categoryId: 'salary' }),
    tx({ occurredOn: '2026-02-10', amountMinor: 12_000, note: 'банкет' }),
    tx({ occurredOn: '2026-08-05', amountMinor: 3_000, categoryId: 'taxi' }),
    tx({ occurredOn: '2025-03-10', amountMinor: 10_000 }),
    tx({ occurredOn: '2025-03-01', amountMinor: 200_000, kind: 'income', categoryId: 'salary' }),
  ];
  const report = buildReport(txs, year, 'prev', BASE);
  const cards = wrappedCards(report, wrappedFacts(txs, year, BASE), name, TODAY);

  it('набор слайдов по данным: от вступления до сравнения с прошлым годом', () => {
    expect(cards.map((c) => c.id)).toEqual(['intro', 'totals', 'savings', 'categories', 'months', 'biggest', 'weekday', 'streak', 'compare'].filter((id) => id !== 'weekday' || cards.some((c) => c.id === 'weekday')));
    expect(cards[0]!.heading).toBe('2026 год: итоги на сегодня');
    expect(cards.find((c) => c.id === 'categories')!.big).toEqual(['Еда']);
    expect(cards.find((c) => c.id === 'biggest')!.lines[0]).toEqual(['«банкет»']);
  });

  it('суммы — структурные: экран выведет их через MoneyText', () => {
    const totals = cards.find((c) => c.id === 'totals')!;
    expect(totals.big).toEqual([{ money: 15_000, tone: 'none' }]);
    expect(totals.lines[1]).toEqual(['Получено: ', { money: 300_000, tone: 'none' }]);
  });

  it('норма сбережений и сравнение с прошлым годом по тем же дням', () => {
    const savings = cards.find((c) => c.id === 'savings')!;
    expect(savings.big).toEqual(['95%']); // (3 000 − 150) ÷ 3 000
    expect(savings.lines.flat()).toContain('В прошлом году было 95%.');
    const cmp = cards.find((c) => c.id === 'compare')!;
    expect(cmp.big).toEqual(['+50%']); // 150 против 100
    expect(cmp.tone).toBe('expense');
  });

  it('без данных слайдов нет; без сравнения слайда сравнения нет', () => {
    const empty = buildReport([], year, 'prev', BASE);
    expect(wrappedCards(empty, wrappedFacts([], year, BASE), name, TODAY)).toEqual([]);
    const noCompare = buildReport(txs, year, 'none', BASE);
    expect(wrappedCards(noCompare, wrappedFacts(txs, year, BASE), name, TODAY).some((c) => c.id === 'compare')).toBe(false);
  });

  it('законченный год — «Ваш 2025 год», сравнение «в прошлом году»', () => {
    const y25 = yearPeriod(2025, TODAY)!;
    const r = buildReport(txs, y25, 'prev', BASE);
    const c = wrappedCards(r, wrappedFacts(txs, y25, BASE), name, TODAY);
    expect(c[0]!.heading).toBe('Ваш 2025 год');
  });
});
