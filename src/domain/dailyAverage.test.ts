import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dailyFromMonthly,
  daysInMonth,
  historyStart,
  isDailyCategory,
  monthlyFromDaily,
  periodAverage,
  periodOf,
  planFact,
  tripDaysOf,
  type DailyRules,
  type DailyTx,
  type Scope,
} from './dailyAverage';

const FOOD = 'cat-food';
const CAFE = 'cat-cafe'; // подкатегория еды
const TAXI = 'cat-taxi';
const TECH = 'cat-tech'; // крупная: без флажка

const parentOf = new Map<string, string | null>([
  [FOOD, null],
  [CAFE, FOOD],
  [TAXI, null],
  [TECH, null],
]);

const rules = (over: Partial<DailyRules> = {}): DailyRules => ({
  base: 'TJS',
  dailyCategoryIds: new Set([FOOD, TAXI]),
  parentOf,
  ...over,
});

const tx = (occurredOn: string, minor: number, over: Partial<DailyTx> = {}): DailyTx => ({
  kind: 'expense',
  categoryId: FOOD,
  baseCurrency: 'TJS',
  baseAmountMinor: minor,
  occurredOn,
  deletedAt: null,
  debtId: null,
  recurringRuleId: null,
  ...over,
});
/** Сомони → дирамы. */
const som = (n: number): number => n * 100;

const ALL: Scope = { kind: 'all' };
const DAILY: Scope = { kind: 'daily' };
const cat = (categoryId: string): Scope => ({ kind: 'category', categoryId });

describe('periodOf: границы периодов', () => {
  it('сегодня, 7 и 30 дней с сегодняшним, месяц с первого числа', () => {
    expect(periodOf('today', '2026-11-02')).toEqual({ kind: 'today', from: '2026-11-02', to: '2026-11-02' });
    expect(periodOf('week', '2026-11-02')).toEqual({ kind: 'week', from: '2026-10-27', to: '2026-11-02' });
    expect(periodOf('last30', '2026-11-02')).toEqual({ kind: 'last30', from: '2026-10-04', to: '2026-11-02' });
    expect(periodOf('month', '2026-11-02')).toEqual({ kind: 'month', from: '2026-11-01', to: '2026-11-02' });
  });
  it('високосный год: 7 дней через 29 февраля', () => {
    expect(periodOf('week', '2028-03-02').from).toBe('2028-02-25');
  });
  it('некорректная дата — RangeError', () => {
    expect(() => periodOf('week', '2026-02-30')).toThrow(RangeError);
    expect(() => periodOf('month', 'вчера')).toThrow(RangeError);
  });
});

describe('isDailyCategory: флажок действует на подкатегории', () => {
  it('сама категория, подкатегория, чужая и «без категории»', () => {
    expect(isDailyCategory(FOOD, rules())).toBe(true);
    expect(isDailyCategory(CAFE, rules())).toBe(true);
    expect(isDailyCategory(TECH, rules())).toBe(false);
    expect(isDailyCategory(null, rules())).toBe(false);
  });
  it('флажок у подкатегории не делает ежедневным родителя', () => {
    expect(isDailyCategory(FOOD, rules({ dailyCategoryIds: new Set([CAFE]) }))).toBe(false);
  });
  it('петля A → B → A в данных не зацикливает', () => {
    const loop = new Map<string, string | null>([['a', 'b'], ['b', 'a']]);
    expect(isDailyCategory('a', { dailyCategoryIds: new Set(), parentOf: loop })).toBe(false);
    expect(isDailyCategory('a', { dailyCategoryIds: new Set(['b']), parentOf: loop })).toBe(true);
  });
});

describe('periodAverage: что считается тратой', () => {
  const today = '2026-11-10';
  const month = periodOf('month', today); // 10 дней
  const avg = (txs: DailyTx[], scope: Scope, r = rules()) => periodAverage({ txs, period: month, scope, rules: r });

  it('делим на все календарные дни, день без записей — ноль', () => {
    // история с 1-го; 300 сомони в один день на 10 дней = 30 в день
    const a = avg([tx('2026-11-01', som(0.01)), tx('2026-11-03', som(300))], DAILY);
    expect(a.days).toBe(10);
    expect(a.totalMinor).toBe(som(300) + 1);
    expect(a.perDayMinor).toBe(3000); // floor(30001 / 10) = 3000
  });

  it('ежедневное и общее: крупная покупка без флажка попадает только в «все»', () => {
    const txs = [tx('2026-11-01', som(40)), tx('2026-11-05', som(2000), { categoryId: TECH })];
    expect(avg(txs, DAILY).totalMinor).toBe(som(40));
    expect(avg(txs, ALL).totalMinor).toBe(som(2040));
  });

  it('траты «без категории» идут во «все», но не в ежедневные', () => {
    const txs = [tx('2026-11-02', som(10), { categoryId: null }), tx('2026-11-02', som(5))];
    expect(avg(txs, ALL).totalMinor).toBe(som(15));
    expect(avg(txs, DAILY).totalMinor).toBe(som(5));
  });

  it('регулярные платежи: во «все» входят, в ежедневные и в категорию — нет', () => {
    const txs = [tx('2026-11-01', som(500), { recurringRuleId: 'rule-1' }), tx('2026-11-02', som(20))];
    expect(avg(txs, ALL).totalMinor).toBe(som(520));
    expect(avg(txs, DAILY).totalMinor).toBe(som(20));
    expect(avg(txs, cat(FOOD)).totalMinor).toBe(som(20));
  });

  it('комиссия перевода — только во «все»', () => {
    const fee = tx('2026-11-02', som(2), { kind: 'transfer', categoryId: null });
    expect(avg([fee], ALL).totalMinor).toBe(som(2));
    expect(avg([fee], DAILY).totalMinor).toBe(0);
    expect(avg([tx('2026-11-02', 0, { kind: 'transfer', categoryId: null })], ALL).totalMinor).toBe(0); // перевод без комиссии
  });

  it('не тратой считаются: доход, долг, корректировка остатка, удалённая, другая базовая валюта', () => {
    const txs = [
      tx('2026-11-02', som(100), { kind: 'income' }),
      tx('2026-11-02', som(100), { debtId: 'debt-1' }),
      tx('2026-11-02', som(100), { fxSource: 'adjust' }),
      tx('2026-11-02', som(100), { deletedAt: '2026-11-03T10:00:00.000Z' }),
      tx('2026-11-02', som(100), { baseCurrency: 'USD' }),
      tx('2026-11-02', som(7)),
    ];
    expect(avg(txs, ALL).totalMinor).toBe(som(7));
    expect(avg(txs, DAILY).totalMinor).toBe(som(7));
  });

  it('категория охватывает подкатегории, но не соседей', () => {
    const txs = [tx('2026-11-02', som(10)), tx('2026-11-02', som(5), { categoryId: CAFE }), tx('2026-11-02', som(3), { categoryId: TAXI })];
    expect(avg(txs, cat(FOOD)).totalMinor).toBe(som(15));
    expect(avg(txs, cat(CAFE)).totalMinor).toBe(som(5));
    expect(avg(txs, cat(TAXI)).totalMinor).toBe(som(3));
  });

  it('операции вне периода не считаются (и завтрашние тоже)', () => {
    const txs = [tx('2026-10-31', som(50)), tx('2026-11-01', som(10)), tx('2026-11-11', som(99))];
    expect(avg(txs, ALL).totalMinor).toBe(som(10));
  });
});

describe('periodAverage: дни поездок и начало истории', () => {
  const today = '2026-11-10';

  it('дни поездки не идут ни в траты, ни в знаменатель', () => {
    // 10 дней, из них 4 (03–06) поездка: траты поездки не считаем, делим на 6
    const trip = tripDaysOf([{ firstOn: '2026-11-03', lastOn: '2026-11-06' }]);
    const txs = [tx('2026-11-01', som(60)), tx('2026-11-04', som(1000)), tx('2026-11-08', som(60))];
    const a = periodAverage({ txs, period: periodOf('month', today), scope: ALL, rules: rules({ skipDays: trip }) });
    expect(a.days).toBe(6);
    expect(a.skippedDays).toBe(4);
    expect(a.totalMinor).toBe(som(120));
    expect(a.perDayMinor).toBe(som(20));
  });

  it('tripDaysOf: перевёрнутый и кривой диапазон пропускаются', () => {
    expect(tripDaysOf([{ firstOn: '2026-11-06', lastOn: '2026-11-03' }]).size).toBe(0);
    expect(tripDaysOf([{ firstOn: '2026-02-30', lastOn: '2026-03-03' }]).size).toBe(0);
    expect([...tripDaysOf([{ firstOn: '2026-11-03', lastOn: '2026-11-03' }])]).toEqual(['2026-11-03']);
  });

  it('новый пользователь: дни до первой операции не считаются', () => {
    // первая запись 8-го: за 7 дней с 4-го по 10-е считаем только 8, 9, 10
    const a = periodAverage({ txs: [tx('2026-11-08', som(90))], period: periodOf('week', today), scope: ALL, rules: rules() });
    expect(a.from).toBe('2026-11-08');
    expect(a.days).toBe(3);
    expect(a.perDayMinor).toBe(som(30));
  });

  it('история началась позже периода или операций нет — считать нечего, а не деление на ноль', () => {
    const none = periodAverage({ txs: [], period: periodOf('week', today), scope: ALL, rules: rules() });
    expect(none).toMatchObject({ days: 0, totalMinor: 0, perDayMinor: null, medianDayMinor: null });
    const future = periodAverage({ txs: [tx('2026-12-01', som(5))], period: periodOf('week', today), scope: ALL, rules: rules() });
    expect(future.days).toBe(0);
    expect(future.perDayMinor).toBeNull();
  });

  it('вся неделя в поездке — считать нечего', () => {
    const trip = tripDaysOf([{ firstOn: '2026-11-01', lastOn: '2026-11-10' }]);
    const a = periodAverage({ txs: [tx('2026-11-02', som(5))], period: periodOf('week', today), scope: ALL, rules: rules({ skipDays: trip }) });
    expect(a.days).toBe(0);
    expect(a.perDayMinor).toBeNull();
  });

  it('historyStart: самая ранняя живая операция любого вида', () => {
    expect(historyStart([])).toBeNull();
    expect(historyStart([tx('2026-05-01', 1, { deletedAt: 'x' }), tx('2026-06-01', 1, { kind: 'income' }), tx('2026-07-01', 1)])).toBe('2026-06-01');
  });
});

describe('periodAverage: обычный день и дни в лимите', () => {
  const today = '2026-11-05';
  const run = (spend: number[], limit?: number) => {
    const txs = spend.map((s, i) => tx(`2026-11-0${i + 1}`, s));
    return periodAverage({ txs, period: periodOf('month', today), scope: DAILY, rules: rules(), limitPerDayMinor: limit });
  };

  it('среднее ползёт от одного большого дня, медиана — нет', () => {
    const a = run([som(30), som(30), som(30), som(30), som(300)]);
    expect(a.perDayMinor).toBe(som(84));
    expect(a.medianDayMinor).toBe(som(30));
  });
  it('нижняя медиана при чётном числе дней, нули считаются днями', () => {
    const a = run([0, som(10), som(20), som(40)]); // 5 дней: 4 с записями + пятый пустой
    expect(a.days).toBe(5);
    expect(a.medianDayMinor).toBe(som(10)); // [0, 0, 10, 20, 40] → середина
  });
  it('в скольких днях уложились в лимит (ровно в лимит — уложились)', () => {
    const a = run([som(40), som(41), som(10), som(40), 0], som(40));
    expect(a.daysWithinLimit).toBe(4);
  });
  it('без лимита — null', () => {
    expect(run([som(1)]).daysWithinLimit).toBeNull();
  });
});

describe('periodAverage: свойства', () => {
  it('perDay × дни ≤ итог < (perDay + 1) × дни — округление всегда вниз', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ day: fc.integer({ min: 1, max: 10 }), minor: fc.integer({ min: 1, max: 5_000_000 }) }), { maxLength: 30 }),
        (items) => {
          const txs = items.map((i) => tx(`2026-11-${String(i.day).padStart(2, '0')}`, i.minor));
          const a = periodAverage({ txs: [tx('2026-11-01', 1), ...txs], period: periodOf('month', '2026-11-10'), scope: ALL, rules: rules() });
          const per = a.perDayMinor as number;
          expect(per * a.days).toBeLessThanOrEqual(a.totalMinor);
          expect(a.totalMinor).toBeLessThan((per + 1) * a.days);
        },
      ),
    );
  });
  it('«все» не зависят от флажков категорий, а ежедневные никогда не больше «всех»', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ day: fc.integer({ min: 1, max: 10 }), minor: fc.integer({ min: 1, max: 1_000_000 }), c: fc.constantFrom(FOOD, CAFE, TAXI, TECH, null) }), { maxLength: 30 }),
        (items) => {
          const txs = [tx('2026-11-01', 1), ...items.map((i) => tx(`2026-11-${String(i.day).padStart(2, '0')}`, i.minor, { categoryId: i.c }))];
          const period = periodOf('month', '2026-11-10');
          const all = periodAverage({ txs, period, scope: ALL, rules: rules() }).totalMinor;
          const daily = periodAverage({ txs, period, scope: DAILY, rules: rules() }).totalMinor;
          const rest = periodAverage({ txs, period, scope: ALL, rules: rules({ dailyCategoryIds: new Set() }) }).totalMinor;
          expect(daily).toBeLessThanOrEqual(all);
          expect(rest).toBe(all); // «все» не зависят от флажков
        },
      ),
    );
  });
  it('суммы, не помещающиеся в безопасное целое, — RangeError', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const txs = [tx('2026-11-01', big), tx('2026-11-02', big)];
    expect(() => periodAverage({ txs, period: periodOf('month', '2026-11-10'), scope: ALL, rules: rules() })).toThrow(RangeError);
  });
});

describe('planFact: план / факт и накопленный запас', () => {
  const run = (txs: DailyTx[], limit: number, today: string, r = rules(), scope: Scope = cat(FOOD)) =>
    planFact({ txs, scope, limitPerDayMinor: limit, today, rules: r });

  it('пример из разговора: лимит 40, прошло 10 дней, потрачено 330 — запас +70', () => {
    // 9 дней по 30 = 270, сегодня (10-е) 60 — выше дневного плана, но накопленный запас держит
    const txs = Array.from({ length: 9 }, (_, i) => tx(`2026-11-0${i + 1}`, som(30)));
    txs.push(tx('2026-11-10', som(60)));
    const r = run(txs, som(40), '2026-11-10');
    expect(r).toEqual({
      kind: 'plan',
      limitPerDayMinor: som(40),
      todaySpentMinor: som(60),
      todayLeftMinor: -som(20),
      monthDays: 10,
      planToDateMinor: som(400),
      spentToDateMinor: som(330),
      reserveMinor: som(70),
      status: 'above-plan',
    });
  });

  it('экономия копится: вчера 25 вместо 40, сегодня можно больше', () => {
    const r = run([tx('2026-11-01', som(40)), tx('2026-11-02', som(25))], som(40), '2026-11-03');
    // 3 дня × 40 = 120 плана, потрачено 65, сегодня ничего → запас 55
    expect(r).toMatchObject({ kind: 'plan', monthDays: 3, reserveMinor: som(55), todaySpentMinor: 0, todayLeftMinor: som(40), status: 'ok' });
  });

  it('накопленный перерасход — статус over, даже если сегодня ничего не потрачено', () => {
    const r = run([tx('2026-11-01', som(200))], som(40), '2026-11-02');
    expect(r).toMatchObject({ kind: 'plan', reserveMinor: -som(120), todaySpentMinor: 0, status: 'over' });
  });

  it('ровно в лимит — ещё ок', () => {
    expect(run([tx('2026-11-01', som(40))], som(40), '2026-11-01')).toMatchObject({ reserveMinor: 0, status: 'ok' });
  });

  it('одна область не мешает другой: такси не попадает в еду', () => {
    const txs = [tx('2026-11-01', som(40)), tx('2026-11-01', som(500), { categoryId: TAXI })];
    expect(run(txs, som(40), '2026-11-01', rules(), cat(FOOD))).toMatchObject({ spentToDateMinor: som(40) });
    expect(run(txs, som(100), '2026-11-01', rules(), cat(TAXI))).toMatchObject({ spentToDateMinor: som(500), status: 'over' });
    expect(run(txs, som(140), '2026-11-01', rules(), DAILY)).toMatchObject({ spentToDateMinor: som(540) });
  });

  it('прошлый месяц не влияет на этот', () => {
    const r = run([tx('2026-10-31', som(9999)), tx('2026-11-01', som(10))], som(40), '2026-11-01');
    expect(r).toMatchObject({ spentToDateMinor: som(10), reserveMinor: som(30) });
  });

  it('дни поездки не копят план и не тратят: сегодня — поездка, значит не считаем', () => {
    const trip = tripDaysOf([{ firstOn: '2026-11-03', lastOn: '2026-11-05' }]);
    const r = run([tx('2026-11-01', som(10))], som(40), '2026-11-04', rules({ skipDays: trip }));
    expect(r).toEqual({ kind: 'unavailable', reason: 'trip' });
  });

  it('дни поездки внутри месяца не копят план', () => {
    const trip = tripDaysOf([{ firstOn: '2026-11-02', lastOn: '2026-11-03' }]);
    const r = run([tx('2026-11-01', som(10)), tx('2026-11-02', som(500))], som(40), '2026-11-04', rules({ skipDays: trip }));
    // считаем 1-е и 4-е: план 80, потрачено 10 (500 в поездке не в счёт)
    expect(r).toMatchObject({ kind: 'plan', monthDays: 2, planToDateMinor: som(80), spentToDateMinor: som(10), reserveMinor: som(70) });
  });

  it('нет операций вообще или первая — в будущем: запас не растёт «из воздуха»', () => {
    expect(run([], som(40), '2026-11-10')).toEqual({ kind: 'unavailable', reason: 'no-history' });
    expect(run([tx('2026-12-01', 1)], som(40), '2026-11-10')).toEqual({ kind: 'unavailable', reason: 'no-history' });
  });

  it('новый пользователь: месяц считается с его первой операции', () => {
    const r = run([tx('2026-11-08', som(10))], som(40), '2026-11-10');
    expect(r).toMatchObject({ kind: 'plan', monthDays: 3, planToDateMinor: som(120), reserveMinor: som(110) });
  });

  it('некорректный лимит — RangeError', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => run([tx('2026-11-01', 1)], bad, '2026-11-01')).toThrow(RangeError);
  });

  it('переполнение плана — RangeError', () => {
    expect(() => run([tx('2026-11-01', 1)], Number.MAX_SAFE_INTEGER, '2026-11-10')).toThrow(RangeError);
  });
});

describe('две формы одного лимита', () => {
  it('дней в месяце', () => {
    expect(daysInMonth('2026-11')).toBe(30);
    expect(daysInMonth('2026-12')).toBe(31);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(() => daysInMonth('2026-13')).toThrow(RangeError);
  });
  it('из дневного — месячный: 40 × 30 = 1200, 40 × 31 = 1240', () => {
    expect(monthlyFromDaily(som(40), '2026-11')).toBe(som(1200));
    expect(monthlyFromDaily(som(40), '2026-12')).toBe(som(1240));
  });
  it('из месячного — дневной вниз: лимит никогда не больше заданного', () => {
    expect(dailyFromMonthly(som(1200), '2026-11')).toBe(som(40));
    expect(dailyFromMonthly(som(1200), '2026-12')).toBe(3870); // 1200 ÷ 31 = 38,70…
    expect(monthlyFromDaily(dailyFromMonthly(som(1200), '2026-12'), '2026-12')).toBeLessThanOrEqual(som(1200));
  });
  it('переполнение — RangeError', () => {
    expect(() => monthlyFromDaily(Number.MAX_SAFE_INTEGER, '2026-12')).toThrow(RangeError);
    expect(() => monthlyFromDaily(-1, '2026-12')).toThrow(RangeError);
  });
});
