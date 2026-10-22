import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildReport,
  comparePeriod,
  comparePhrase,
  customPeriod,
  FLOW_TOP,
  highlights,
  incomeFlow,
  MAX_CUSTOM_DAYS,
  periodDays,
  quarterOf,
  quarterPeriod,
  ratioPercent,
  shiftYear,
  summarizePeriod,
  yearPeriod,
} from './periods';

const TODAY = '2026-10-15';

type Tx = Parameters<typeof summarizePeriod>[0][number];
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
    debtId: null,
    ...over,
  }) as Tx;

describe('shiftYear', () => {
  it('тот же день и месяц в другом году; 29 февраля в невисокосном — 28 февраля', () => {
    expect(shiftYear('2026-10-15', -1)).toBe('2025-10-15');
    expect(shiftYear('2026-10-15', 1)).toBe('2027-10-15');
    expect(shiftYear('2028-02-29', -1)).toBe('2027-02-28');
    expect(shiftYear('2027-02-28', 1)).toBe('2028-02-28');
    expect(shiftYear('2024-02-29', 4)).toBe('2028-02-29');
  });
});

describe('периоды: год, квартал, свои даты', () => {
  it('год: идущий — по сегодня, прошедший — целиком; будущий и слишком ранний — null', () => {
    expect(yearPeriod(2026, TODAY)).toEqual({ kind: 'year', from: '2026-01-01', to: TODAY, fullEnd: '2026-12-31', partial: true });
    expect(yearPeriod(2025, TODAY)).toEqual({ kind: 'year', from: '2025-01-01', to: '2025-12-31', fullEnd: '2025-12-31', partial: false });
    expect(yearPeriod(2027, TODAY)).toBeNull();
    expect(yearPeriod(1999, TODAY)).toBeNull();
    expect(yearPeriod(2025.5, TODAY)).toBeNull();
    expect(yearPeriod(Number.NaN, TODAY)).toBeNull();
    // 31 декабря: год ещё не «закончился» по дате, а в 1 января следующего — прошедший
    expect(yearPeriod(2026, '2026-12-31')!.partial).toBe(false);
    expect(yearPeriod(2026, '2027-01-01')!.partial).toBe(false);
  });

  it('квартал: границы, идущий — по сегодня; високосный февраль не ломает конец I квартала', () => {
    expect(quarterPeriod(2026, 1, TODAY)).toEqual({ kind: 'quarter', from: '2026-01-01', to: '2026-03-31', fullEnd: '2026-03-31', partial: false });
    expect(quarterPeriod(2026, 2, TODAY)!.fullEnd).toBe('2026-06-30');
    expect(quarterPeriod(2026, 3, TODAY)!.fullEnd).toBe('2026-09-30');
    expect(quarterPeriod(2026, 4, TODAY)).toEqual({ kind: 'quarter', from: '2026-10-01', to: TODAY, fullEnd: '2026-12-31', partial: true });
    expect(quarterPeriod(2028, 1, '2030-01-01')!.fullEnd).toBe('2028-03-31');
    expect(quarterPeriod(2027, 1, TODAY)).toBeNull(); // будущий
    for (const q of [0, 5, 1.5, Number.NaN]) expect(quarterPeriod(2026, q, TODAY)).toBeNull();
    expect(quarterPeriod(1999, 1, TODAY)).toBeNull();
  });

  it('свои даты: конец подрезается до сегодня; наоборот, будущее начало, слишком длинный период и мусор — null', () => {
    expect(customPeriod('2026-03-01', '2026-04-15', TODAY)).toEqual({ kind: 'custom', from: '2026-03-01', to: '2026-04-15', fullEnd: '2026-04-15', partial: false });
    expect(customPeriod('2026-03-01', '2026-12-31', TODAY)!.to).toBe(TODAY);
    expect(customPeriod('2026-04-15', '2026-03-01', TODAY)).toBeNull();
    expect(customPeriod('2026-11-01', '2026-12-01', TODAY)).toBeNull();
    expect(customPeriod('2026-10-15', '2026-10-15', TODAY)).toMatchObject({ from: TODAY, to: TODAY });
    expect(customPeriod('1999-01-01', '2026-01-01', TODAY)).toBeNull();
    for (const bad of [null, undefined, '', 'вчера', '2026-02-30', 20261015, {}]) {
      expect(customPeriod(bad, '2026-10-01', TODAY), String(bad)).toBeNull();
      expect(customPeriod('2026-01-01', bad, TODAY), String(bad)).toBeNull();
    }
    expect(MAX_CUSTOM_DAYS).toBe(1830);
    expect(customPeriod('2021-10-15', TODAY, TODAY)).not.toBeNull(); // ~5 лет и 1 день: помещается
    expect(customPeriod('2018-01-01', TODAY, TODAY)).toBeNull(); // 8 лет
  });

  it('quarterOf и periodDays', () => {
    expect(quarterOf('2026-01-01')).toEqual({ year: 2026, quarter: 1 });
    expect(quarterOf('2026-03-31')).toEqual({ year: 2026, quarter: 1 });
    expect(quarterOf('2026-04-01')).toEqual({ year: 2026, quarter: 2 });
    expect(quarterOf('2026-12-31')).toEqual({ year: 2026, quarter: 4 });
    expect(periodDays({ from: '2026-10-01', to: '2026-10-01' })).toBe(1);
    expect(periodDays({ from: '2026-01-01', to: '2026-12-31' })).toBe(365);
    expect(periodDays({ from: '2028-01-01', to: '2028-12-31' })).toBe(366);
  });
});

describe('comparePeriod: с чем сравниваем', () => {
  it('год, прошедший: с прошлым годом целиком', () => {
    expect(comparePeriod(yearPeriod(2025, TODAY)!, 'prev')).toEqual({ from: '2024-01-01', to: '2024-12-31' });
  });

  it('год, идущий: с теми же числами прошлого года, а не со всем прошлым', () => {
    expect(comparePeriod(yearPeriod(2026, TODAY)!, 'prev')).toEqual({ from: '2025-01-01', to: '2025-10-15' });
    expect(comparePeriod(yearPeriod(2028, '2028-02-29')!, 'prev')).toEqual({ from: '2027-01-01', to: '2027-02-28' });
  });

  it('для года «год назад» совпадает с «прошлым»', () => {
    for (const y of [2025, 2026]) {
      const p = yearPeriod(y, TODAY)!;
      expect(comparePeriod(p, 'yoy')).toEqual(comparePeriod(p, 'prev'));
    }
  });

  it('квартал: с прошлым кварталом; I квартал — с IV прошлого года; идущий — с тем же числом дней', () => {
    expect(comparePeriod(quarterPeriod(2026, 2, TODAY)!, 'prev')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(comparePeriod(quarterPeriod(2026, 1, TODAY)!, 'prev')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    // IV квартал идёт с 1 по 15 октября (15 дней): сравниваем с 1–15 июля
    expect(comparePeriod(quarterPeriod(2026, 4, TODAY)!, 'prev')).toEqual({ from: '2026-07-01', to: '2026-07-15' });
    // 92 дня III квартала идут сравнением с 91-дневным II: не выходим за его конец
    expect(comparePeriod(quarterPeriod(2026, 3, '2026-09-29')!, 'prev')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('квартал, «год назад»: те же даты в прошлом году', () => {
    expect(comparePeriod(quarterPeriod(2026, 2, TODAY)!, 'yoy')).toEqual({ from: '2025-04-01', to: '2025-06-30' });
  });

  it('свой период: такой же длины сразу перед ним; «год назад» — те же даты прошлого года', () => {
    const p = customPeriod('2026-03-01', '2026-03-31', TODAY)!; // 31 день
    expect(comparePeriod(p, 'prev')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
    expect(periodDays(comparePeriod(p, 'prev')!)).toBe(periodDays(p));
    expect(comparePeriod(p, 'yoy')).toEqual({ from: '2025-03-01', to: '2025-03-31' });
  });

  it('без сравнения — null', () => {
    for (const p of [yearPeriod(2026, TODAY)!, quarterPeriod(2026, 2, TODAY)!, customPeriod('2026-03-01', '2026-03-31', TODAY)!]) {
      expect(comparePeriod(p, 'none')).toBeNull();
    }
  });

  it('свойство: свой период «prev» всегда такой же длины, идёт встык и не пересекается', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 0, max: 400 }), (ago, len) => {
        const from = shiftDays(TODAY, -(ago + len));
        const to = shiftDays(from, len);
        const p = customPeriod(from, to, TODAY);
        if (!p) return;
        const c = comparePeriod(p, 'prev')!;
        expect(periodDays(c)).toBe(periodDays(p));
        expect(shiftDays(c.to, 1)).toBe(p.from);
      }),
    );
  });
});

function shiftDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('comparePhrase', () => {
  it('«в прошлом году», «за те же дни прошлого года», «за предыдущие 31 день»', () => {
    expect(comparePhrase(yearPeriod(2025, TODAY)!, 'prev')).toBe('в прошлом году');
    expect(comparePhrase(yearPeriod(2026, TODAY)!, 'prev')).toBe('за те же дни прошлого года');
    expect(comparePhrase(quarterPeriod(2026, 2, TODAY)!, 'prev')).toBe('в прошлом квартале');
    expect(comparePhrase(quarterPeriod(2026, 4, TODAY)!, 'prev')).toBe('за те же дни прошлого квартала');
    expect(comparePhrase(customPeriod('2026-03-01', '2026-03-31', TODAY)!, 'prev')).toBe('за предыдущие 31 день');
    expect(comparePhrase(customPeriod('2026-03-01', '2026-03-22', TODAY)!, 'prev')).toBe('за предыдущие 22 дня');
    expect(comparePhrase(customPeriod('2026-03-01', '2026-03-10', TODAY)!, 'prev')).toBe('за предыдущие 10 дней');
    expect(comparePhrase(quarterPeriod(2026, 2, TODAY)!, 'yoy')).toBe('за тот же период год назад');
    expect(comparePhrase(yearPeriod(2026, TODAY)!, 'yoy')).toBe('за те же дни прошлого года');
    expect(comparePhrase(yearPeriod(2026, TODAY)!, 'none')).toBe('');
  });
});

describe('ratioPercent', () => {
  it('округляет «от нуля» и считает точно; нет дохода — null', () => {
    expect(ratioPercent(18, 100)).toBe(18);
    expect(ratioPercent(505, 1000)).toBe(51); // 50,5% → 51
    expect(ratioPercent(-505, 1000)).toBe(-51);
    expect(ratioPercent(504, 1000)).toBe(50);
    expect(ratioPercent(0, 1000)).toBe(0);
    expect(ratioPercent(1_000, 1_000)).toBe(100);
    expect(ratioPercent(-1_000, 1_000)).toBe(-100);
    expect(ratioPercent(1, 0)).toBeNull();
    expect(ratioPercent(1, -5)).toBeNull();
    // большие суммы без потери точности: 1/3 от 9·10^15
    expect(ratioPercent(3_000_000_000_000_000, 9_000_000_000_000_000)).toBe(33);
    expect(ratioPercent(Number.NaN, 100)).toBeNull();
  });
});

describe('summarizePeriod', () => {
  const txs = [
    tx({ occurredOn: '2026-01-10', kind: 'income', baseAmountMinor: 100_000, categoryId: 'salary' }),
    tx({ occurredOn: '2026-02-10', kind: 'income', baseAmountMinor: 100_000, categoryId: 'salary' }),
    tx({ occurredOn: '2026-02-12', kind: 'income', baseAmountMinor: 20_000, categoryId: 'gift' }),
    tx({ occurredOn: '2026-01-15', kind: 'expense', baseAmountMinor: 30_000, categoryId: 'food' }),
    tx({ occurredOn: '2026-02-15', kind: 'expense', baseAmountMinor: 50_000, categoryId: 'food' }),
    tx({ occurredOn: '2026-02-20', kind: 'expense', baseAmountMinor: 10_000, categoryId: 'taxi' }),
    tx({ occurredOn: '2026-02-21', kind: 'expense', baseAmountMinor: 5_000 }), // без категории
    tx({ occurredOn: '2026-02-22', kind: 'transfer', baseAmountMinor: 700, toWalletId: 'w2' }), // комиссия перевода — расход
    // не входят в доходы и расходы:
    tx({ occurredOn: '2026-02-23', kind: 'expense', baseAmountMinor: 9_999, debtId: 'd1' }),
    tx({ occurredOn: '2026-02-24', kind: 'income', baseAmountMinor: 8_888, debtId: 'd1' }),
    tx({ occurredOn: '2026-02-25', kind: 'expense', baseAmountMinor: 4_321, fxSource: 'adjust' } as Partial<Tx> & Pick<Tx, 'occurredOn' | 'kind' | 'baseAmountMinor'>),
    tx({ occurredOn: '2026-02-26', kind: 'expense', baseAmountMinor: 1_234, deletedAt: '2026-02-27T00:00:00.000Z' }),
    tx({ occurredOn: '2025-12-31', kind: 'expense', baseAmountMinor: 77_777 }), // до периода
    tx({ occurredOn: '2026-03-01', kind: 'expense', baseAmountMinor: 66_666 }), // после периода
    tx({ occurredOn: '2026-02-14', kind: 'expense', baseAmountMinor: 3_000, baseCurrency: 'USD' }), // другая основная валюта
  ];
  const s = summarizePeriod(txs, { from: '2026-01-01', to: '2026-02-28' }, 'TJS');

  it('доходы, расходы (с комиссией), разница и норма сбережений', () => {
    expect(s.incomeMinor).toBe(220_000);
    expect(s.expenseMinor).toBe(30_000 + 50_000 + 10_000 + 5_000 + 700);
    expect(s.netMinor).toBe(220_000 - 95_700);
    expect(s.savingsRate).toBe(57); // 124 300 / 220 000 = 56,5%: ровно половина, округляется «от нуля» вверх
    expect(s.days).toBe(59);
  });

  it('расходы по категориям: от большего; «без категории» и комиссии — своими строками', () => {
    expect(s.expenseByCategory).toEqual([
      { categoryId: 'food', totalMinor: 80_000 },
      { categoryId: 'taxi', totalMinor: 10_000 },
      { categoryId: null, totalMinor: 5_000 },
      { categoryId: null, totalMinor: 700, kind: 'fee' },
    ]);
  });

  it('доходы по категориям: от большего', () => {
    expect(s.incomeByCategory).toEqual([
      { categoryId: 'salary', totalMinor: 200_000 },
      { categoryId: 'gift', totalMinor: 20_000 },
    ]);
  });

  it('месяцы периода по порядку, итоги месяцев складываются в итог периода', () => {
    expect(s.months.map((m) => m.month)).toEqual(['2026-01', '2026-02']);
    expect(s.months.reduce((a, m) => a + m.incomeMinor, 0)).toBe(s.incomeMinor);
    expect(s.months.reduce((a, m) => a + m.expenseMinor, 0)).toBe(s.expenseMinor);
  });

  it('операции в другой основной валюте не смешиваются и считаются отдельно', () => {
    expect(s.excludedCount).toBe(1);
  });

  it('период, в котором нет доходов: нормы сбережений нет, но расходы считаются', () => {
    const only = summarizePeriod([tx({ occurredOn: '2026-02-01', kind: 'expense', baseAmountMinor: 100 })], { from: '2026-02-01', to: '2026-02-28' }, 'TJS');
    expect(only).toMatchObject({ incomeMinor: 0, expenseMinor: 100, netMinor: -100, savingsRate: null });
  });

  it('расходы больше доходов: норма сбережений отрицательная', () => {
    const over = summarizePeriod(
      [tx({ occurredOn: '2026-02-01', kind: 'income', baseAmountMinor: 1_000 }), tx({ occurredOn: '2026-02-02', kind: 'expense', baseAmountMinor: 1_500 })],
      { from: '2026-02-01', to: '2026-02-28' },
      'TJS',
    );
    expect(over).toMatchObject({ netMinor: -500, savingsRate: -50 });
  });

  it('пустой период — нули и месяцы с нулями', () => {
    const empty = summarizePeriod([], { from: '2026-03-01', to: '2026-03-31' }, 'TJS');
    expect(empty).toMatchObject({ incomeMinor: 0, expenseMinor: 0, netMinor: 0, savingsRate: null, expenseByCategory: [], incomeByCategory: [] });
    expect(empty.months).toEqual([{ month: '2026-03', incomeMinor: 0, expenseMinor: 0, netMinor: 0 }]);
  });

  it('период на стыке лет: декабрь и январь, месяцев ровно два', () => {
    const cross = summarizePeriod([], { from: '2025-12-20', to: '2026-01-05' }, 'TJS');
    expect(cross.months.map((m) => m.month)).toEqual(['2025-12', '2026-01']);
  });

  it('переполнение суммы — RangeError, а не неверная цифра', () => {
    const huge = [
      tx({ occurredOn: '2026-02-01', kind: 'income', baseAmountMinor: Number.MAX_SAFE_INTEGER }),
      tx({ occurredOn: '2026-02-02', kind: 'income', baseAmountMinor: Number.MAX_SAFE_INTEGER }),
    ];
    expect(() => summarizePeriod(huge, { from: '2026-02-01', to: '2026-02-28' }, 'TJS')).toThrow(RangeError);
  });

  it('свойство: сумма по месяцам равна итогу периода, а сумма по категориям — расходам', () => {
    const arb = fc.array(
      fc.record({
        ago: fc.integer({ min: 0, max: 400 }),
        kind: fc.constantFrom('income', 'expense'),
        amount: fc.integer({ min: 1, max: 1_000_000 }),
        cat: fc.constantFrom('a', 'b', null),
      }),
      { maxLength: 60 },
    );
    fc.assert(
      fc.property(arb, (rows) => {
        const list = rows.map((r) => tx({ occurredOn: shiftDays(TODAY, -r.ago), kind: r.kind as 'income' | 'expense', baseAmountMinor: r.amount, categoryId: r.cat }));
        const sum = summarizePeriod(list, { from: shiftDays(TODAY, -300), to: TODAY }, 'TJS');
        expect(sum.months.reduce((a, m) => a + m.incomeMinor, 0)).toBe(sum.incomeMinor);
        expect(sum.months.reduce((a, m) => a + m.expenseMinor, 0)).toBe(sum.expenseMinor);
        expect(sum.expenseByCategory.reduce((a, c) => a + c.totalMinor, 0)).toBe(sum.expenseMinor);
        expect(sum.incomeByCategory.reduce((a, c) => a + c.totalMinor, 0)).toBe(sum.incomeMinor);
        expect(sum.netMinor).toBe(sum.incomeMinor - sum.expenseMinor);
      }),
    );
  });
});

describe('buildReport: сравнение', () => {
  const txs = [
    tx({ occurredOn: '2025-03-10', kind: 'expense', baseAmountMinor: 10_000, categoryId: 'food' }),
    tx({ occurredOn: '2025-04-10', kind: 'expense', baseAmountMinor: 5_000, categoryId: 'gym' }),
    tx({ occurredOn: '2025-05-10', kind: 'income', baseAmountMinor: 50_000, categoryId: 'salary' }),
    tx({ occurredOn: '2026-03-10', kind: 'expense', baseAmountMinor: 15_000, categoryId: 'food' }),
    tx({ occurredOn: '2026-04-10', kind: 'expense', baseAmountMinor: 7_000, categoryId: 'taxi' }),
    tx({ occurredOn: '2026-05-10', kind: 'income', baseAmountMinor: 60_000, categoryId: 'salary' }),
    tx({ occurredOn: '2026-05-11', kind: 'income', baseAmountMinor: 1_000, categoryId: 'gift' }),
  ];

  it('год к году: итоги обоих периодов и сдвиги по категориям (новая, ушедшая, выросла)', () => {
    const r = buildReport(txs, yearPeriod(2026, TODAY)!, 'prev', 'TJS');
    expect(r.current.expenseMinor).toBe(22_000);
    expect(r.compare!.summary.expenseMinor).toBe(15_000);
    expect(r.compare!.range).toEqual({ from: '2025-01-01', to: '2025-10-15' });
    const byKey = Object.fromEntries(r.expenseDeltas.map((d) => [d.key, d]));
    expect(byKey.food).toMatchObject({ currentMinor: 15_000, previousMinor: 10_000, status: 'up', percent: 50 });
    expect(byKey.taxi).toMatchObject({ currentMinor: 7_000, previousMinor: 0, status: 'new' });
    expect(byKey.gym).toMatchObject({ currentMinor: 0, previousMinor: 5_000, status: 'gone' });
    const income = Object.fromEntries(r.incomeDeltas.map((d) => [d.key, d]));
    expect(income.salary).toMatchObject({ currentMinor: 60_000, previousMinor: 50_000, status: 'up', percent: 20 });
    expect(income.gift).toMatchObject({ status: 'new' });
  });

  it('без сравнения: compare пуст, а сдвиги — только текущие значения', () => {
    const r = buildReport(txs, yearPeriod(2026, TODAY)!, 'none', 'TJS');
    expect(r.compare).toBeNull();
    expect(r.expenseDeltas.every((d) => d.previousMinor === 0)).toBe(true);
  });

  it('два квартала подряд сравниваются между собой, а не с годом', () => {
    const r = buildReport(txs, quarterPeriod(2026, 2, TODAY)!, 'prev', 'TJS');
    expect(r.compare!.range).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(r.compare!.summary.expenseMinor).toBe(15_000);
    expect(r.current.expenseMinor).toBe(7_000);
  });
});

describe('incomeFlow: «Куда ушёл доход»', () => {
  const sum = (over: Partial<Parameters<typeof incomeFlow>[0]> = {}) => ({
    incomeMinor: 100_000,
    expenseMinor: 70_000,
    netMinor: 30_000,
    expenseByCategory: [
      { categoryId: 'a', totalMinor: 30_000 },
      { categoryId: 'b', totalMinor: 20_000 },
      { categoryId: null, totalMinor: 10_000 },
      { categoryId: null, totalMinor: 5_000, kind: 'fee' as const },
      { categoryId: 'c', totalMinor: 3_000 },
      { categoryId: 'd', totalMinor: 1_500 },
      { categoryId: 'e', totalMinor: 500 },
    ],
    ...over,
  });

  it('первые категории отдельно, остальное одним сегментом; доли — от дохода; остаток — отдельно', () => {
    expect(FLOW_TOP).toBe(5);
    const f = incomeFlow(sum())!;
    expect(f.totalMinor).toBe(100_000);
    expect(f.segments.map((s) => s.key)).toEqual(['a', 'b', 'none', 'fee', 'c', 'rest']);
    expect(f.segments.find((s) => s.key === 'rest')).toMatchObject({ minor: 2_000, kind: 'rest' });
    expect(f.segments[0]!.share).toBe(30);
    expect(f.savedMinor).toBe(30_000);
    expect(f.savedShare).toBe(30);
    expect(f.deficitMinor).toBe(0);
    // сегменты вместе дают все расходы
    expect(f.segments.reduce((a, s) => a + s.minor, 0)).toBe(70_000);
  });

  it('расходы больше дохода: полоса — это расходы, превышение показано отдельно', () => {
    const f = incomeFlow(sum({ incomeMinor: 50_000, expenseMinor: 70_000, netMinor: -20_000 }))!;
    expect(f.totalMinor).toBe(70_000);
    expect(f.savedMinor).toBe(0);
    expect(f.deficitMinor).toBe(20_000);
  });

  it('расходы без дохода: полоса есть; нет ни того ни другого — null', () => {
    expect(incomeFlow(sum({ incomeMinor: 0, expenseMinor: 70_000, netMinor: -70_000 }))!.deficitMinor).toBe(70_000);
    expect(incomeFlow(sum({ incomeMinor: 0, expenseMinor: 0, netMinor: 0, expenseByCategory: [] }))).toBeNull();
  });

  it('доход без расходов: одна «остаток»-полоса', () => {
    const f = incomeFlow(sum({ expenseMinor: 0, netMinor: 100_000, expenseByCategory: [] }))!;
    expect(f.segments).toEqual([]);
    expect(f.savedMinor).toBe(100_000);
  });
});

describe('highlights', () => {
  const months = [
    { month: '2026-01', incomeMinor: 100, expenseMinor: 40, netMinor: 60 },
    { month: '2026-02', incomeMinor: 300, expenseMinor: 90, netMinor: 210 },
    { month: '2026-03', incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
    { month: '2026-04', incomeMinor: 200, expenseMinor: 90, netMinor: 110 },
  ];

  it('самый затратный (при равенстве — первый) и самый доходный месяц, главная категория без комиссий, средний расход по месяцам с тратами', () => {
    const h = highlights({ months, expenseByCategory: [{ categoryId: null, totalMinor: 999, kind: 'fee' }, { categoryId: 'a', totalMinor: 120 }, { categoryId: 'b', totalMinor: 100 }] });
    expect(h.peakExpenseMonth?.month).toBe('2026-02');
    expect(h.peakIncomeMonth?.month).toBe('2026-02');
    expect(h.topExpense).toEqual({ categoryId: 'a', totalMinor: 120 });
    expect(h.avgMonthlyExpenseMinor).toBe(73); // (40+90+90)/3 = 73,3 → 73; пустой март не в счёт
  });

  it('ничего нет — пусто', () => {
    expect(highlights({ months: [{ month: '2026-01', incomeMinor: 0, expenseMinor: 0, netMinor: 0 }], expenseByCategory: [] })).toEqual({
      peakExpenseMonth: null,
      peakIncomeMonth: null,
      topExpense: null,
      avgMonthlyExpenseMinor: null,
    });
  });
});
