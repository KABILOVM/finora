import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeSavingsPlan,
  distributeByWeight,
  monthSpan,
  planGoal,
  usualSpendFromHistory,
  type PlanForecast,
  type PlanGoal,
  type SavingsPlanInput,
  type UsualSpend,
} from './savingsPlan';

const TODAY = '2026-10-15'; // в октябре 31 день; до конца месяца с сегодняшним — 17

const goal = (over: Partial<PlanGoal> = {}): PlanGoal => ({
  id: 'g1',
  targetMinor: 300_000,
  currency: 'TJS',
  dueOn: '2026-12-15', // два полных месяца до срока
  savedMinor: 0,
  savedThisMonthMinor: 0,
  ...over,
});

const forecast = (over: Partial<PlanForecast> = {}): PlanForecast => ({ perDayMinor: 40_000, daysLeft: 17, obligationsMinor: 0, ...over });

const usual: UsualSpend = {
  categories: [
    { categoryId: 'food', usualMonthlyMinor: 600_000, essential: false },
    { categoryId: 'fun', usualMonthlyMinor: 200_000, essential: false },
    { categoryId: 'rent', usualMonthlyMinor: 500_000, essential: true },
  ],
  uncategorizedMonthlyMinor: 0,
};

const plan = (over: Partial<SavingsPlanInput> = {}) => {
  const r = computeSavingsPlan({ today: TODAY, base: 'TJS', goals: [goal()], forecast: forecast(), usual: null, ...over });
  if (!r.ok) throw new Error('ожидали план');
  return r;
};

describe('monthSpan', () => {
  it('считает дни месяца и дни до его конца включительно', () => {
    expect(monthSpan('2026-10-15')).toEqual({ totalDays: 31, daysToEnd: 17 });
    expect(monthSpan('2026-10-31')).toEqual({ totalDays: 31, daysToEnd: 1 });
    expect(monthSpan('2028-02-01')).toEqual({ totalDays: 29, daysToEnd: 29 });
  });
});

describe('distributeByWeight', () => {
  it('сумма частей ровно равна total, остаток — тем, у кого дробная часть больше', () => {
    expect(distributeByWeight(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(distributeByWeight(0, [5, 5])).toEqual([0, 0]);
    expect(distributeByWeight(7, [0, 0])).toEqual([0, 0]);
  });

  it('свойство: сумма = total, ни одна часть не больше своего веса (total ≤ суммы весов)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 12 }), fc.double({ min: 0, max: 1, noNaN: true }), (weights, k) => {
        const sum = weights.reduce((a, b) => a + b, 0);
        fc.pre(sum > 0);
        const total = Math.floor(sum * k);
        const parts = distributeByWeight(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        parts.forEach((p, i) => expect(p).toBeLessThanOrEqual(weights[i]!));
      }),
    );
  });
});

describe('planGoal', () => {
  it('нужно отложить за месяц: остаток ÷ месяцев до срока, вверх', () => {
    const it = planGoal(goal(), 'TJS', TODAY);
    expect(it.state).toBe('active');
    expect(it.monthNeedMinor).toBe(150_000);
    expect(it.leftThisMonthMinor).toBe(150_000);
  });

  it('уже отложенное в этом месяце не просит откладывать второй раз', () => {
    // накоплено 100 000 (всё отложено в этом месяце): остаток 200 000, нужно (200 000 + 100 000) ÷ 2 = 150 000, ещё 50 000
    const it = planGoal(goal({ savedMinor: 100_000, savedThisMonthMinor: 100_000 }), 'TJS', TODAY);
    expect(it.monthNeedMinor).toBe(150_000);
    expect(it.leftThisMonthMinor).toBe(50_000);
    // отложено больше нужного — ещё откладывать нечего
    expect(planGoal(goal({ savedMinor: 200_000, savedThisMonthMinor: 200_000 }), 'TJS', TODAY).leftThisMonthMinor).toBe(0);
  });

  it('отрицательный приток за месяц (сняли с накоплений) считается нулём', () => {
    expect(planGoal(goal({ savedThisMonthMinor: -50_000 }), 'TJS', TODAY).leftThisMonthMinor).toBe(150_000);
  });

  it('достигнутая, просроченная и «в другой валюте» цели ничего не просят', () => {
    expect(planGoal(goal({ savedMinor: 300_000 }), 'TJS', TODAY)).toMatchObject({ state: 'reached', leftThisMonthMinor: 0 });
    expect(planGoal(goal({ dueOn: '2026-10-01' }), 'TJS', TODAY)).toMatchObject({ state: 'overdue', leftThisMonthMinor: 0 });
    expect(planGoal(goal({ currency: 'USD' }), 'TJS', TODAY)).toMatchObject({ state: 'other-currency', progress: null, leftThisMonthMinor: 0 });
  });

  it('срок в этом месяце — весь остаток нужно отложить сейчас', () => {
    expect(planGoal(goal({ dueOn: '2026-10-31' }), 'TJS', TODAY).leftThisMonthMinor).toBe(300_000);
  });
});

describe('computeSavingsPlan: лимит в день', () => {
  it('без привычных трат: лимит в день уменьшается на резерв в день, разбора по категориям нет', () => {
    const p = plan();
    expect(p.leftThisMonthMinor).toBe(150_000);
    expect(p.day).toMatchObject({
      status: 'cut',
      reserveMinor: 150_000,
      perDayMinor: 40_000,
      cutPerDayMinor: 8_824, // ceil(150 000 ÷ 17)
      perDayWithGoalMinor: 31_176,
      cutTotalMinor: null,
      uncoveredMinor: 0,
      categories: [],
    });
  });

  it('денег не хватает даже на цель — «впритык» и сколько не хватает', () => {
    const p = plan({ forecast: forecast({ perDayMinor: 5_000 }) }); // за 17 дней можно потратить 85 000 < 150 000
    expect(p.day).toMatchObject({ status: 'tight', uncoveredMinor: 65_000, perDayWithGoalMinor: 0 });
  });

  it('горизонт короче месяца: резерв — доля пропорционально дням', () => {
    const p = plan({ forecast: forecast({ daysLeft: 7 }) });
    expect(p.day?.reserveMinor).toBe(61_765); // ceil(150 000 × 7 ÷ 17)
    expect(p.day?.cutPerDayMinor).toBe(8_824); // ceil(61 765 ÷ 7)
  });

  it('горизонт длиннее месяца: резерв — весь месяц', () => {
    expect(plan({ forecast: forecast({ daysLeft: 25 }) }).day?.reserveMinor).toBe(150_000);
  });

  it('несколько целей складываются; другая валюта и достигнутые не входят', () => {
    const p = plan({
      goals: [goal(), goal({ id: 'g2', targetMinor: 90_000, dueOn: '2026-10-31' }), goal({ id: 'g3', currency: 'USD' }), goal({ id: 'g4', savedMinor: 300_000 })],
    });
    expect(p.leftThisMonthMinor).toBe(150_000 + 90_000);
    expect(p.items.map((i) => i.state)).toEqual(['active', 'active', 'other-currency', 'reached']);
  });

  it('откладывать нечего или прогноза нет — плана на день нет', () => {
    expect(plan({ goals: [goal({ savedMinor: 300_000 })] }).day).toBeNull();
    expect(plan({ forecast: null }).day).toBeNull();
    expect(plan({ forecast: null }).leftThisMonthMinor).toBe(150_000);
    expect(plan({ goals: [] }).day).toBeNull();
  });

  it('суммы не помещаются — признак ошибки, а не исключение', () => {
    const r = computeSavingsPlan({ today: TODAY, base: 'TJS', goals: [goal()], forecast: forecast({ perDayMinor: Number.MAX_SAFE_INTEGER }), usual: null });
    expect(r).toEqual({ ok: false, error: 'overflow' });
  });
});

describe('computeSavingsPlan: разбор по категориям', () => {
  // за 17 дней при привычном темпе (÷31): еда 329 032, развлечения 109 677, аренда 274 193
  const REST = { food: 329_032, fun: 109_677, rent: 274_193 };

  it('привычные траты укладываются — сокращать нечего, всё «как обычно»', () => {
    const p = plan({ usual, forecast: forecast({ perDayMinor: 60_000 }) });
    expect(p.day?.status).toBe('ok');
    expect(p.day?.cutTotalMinor).toBe(0);
    expect(p.day?.categories.every((c) => c.advice === 'keep' && c.cutMinor === 0)).toBe(true);
  });

  it('нужно сократить: сумма сокращений ровно нужная, обязательные не тронуты, лишнего не режем', () => {
    const p = plan({ usual, forecast: forecast({ perDayMinor: 40_000 }) });
    const day = p.day!;
    // 150 000 + (438 709 + 274 193) − 680 000 = 182 902
    expect(day.status).toBe('cut');
    expect(day.cutTotalMinor).toBe(182_902);
    const by = new Map(day.categories.map((c) => [c.categoryId, c] as const));
    expect(by.get('rent')).toMatchObject({ cutMinor: 0, advice: 'keep', allowedMinor: REST.rent, essential: true });
    expect(by.get('food')!.cutMinor + by.get('fun')!.cutMinor).toBe(182_902);
    for (const id of ['food', 'fun'] as const) {
      const c = by.get(id)!;
      expect(c.usualRestMinor).toBe(REST[id]);
      expect(c.allowedMinor).toBe(c.usualRestMinor - c.cutMinor);
      expect(c.advice).toBe('trim');
    }
    // больше привычная категория — больше сокращение; порядок: где сокращают больше, выше
    expect(by.get('food')!.cutMinor).toBeGreaterThan(by.get('fun')!.cutMinor);
    expect(day.categories[0]!.categoryId).toBe('food');
  });

  it('платежи по расписанию уже вычтены из прогноза — аренда не считается второй раз', () => {
    // если вся привычная аренда — это запланированный платёж, то в привычных тратах остаётся только необязательное
    const p = plan({ usual, forecast: forecast({ perDayMinor: 40_000, obligationsMinor: REST.rent }) });
    expect(p.day?.status).toBe('ok'); // 150 000 + 438 709 − 680 000 < 0
  });

  it('необязательных трат не хватает — «впритык» и сколько ещё не хватает; необязательные режутся целиком', () => {
    const p = plan({ usual, forecast: forecast({ perDayMinor: 20_000 }) });
    const day = p.day!;
    // 150 000 + 712 902 − 340 000 = 522 902; необязательных всего 438 709
    expect(day.status).toBe('tight');
    expect(day.cutTotalMinor).toBe(522_902);
    expect(day.uncoveredMinor).toBe(522_902 - 438_709);
    const flex = day.categories.filter((c) => !c.essential);
    expect(flex.every((c) => c.advice === 'skip' && c.allowedMinor === 0)).toBe(true);
  });

  it('траты без категории и комиссии не урезаются, но входят в привычные', () => {
    const withLoose: UsualSpend = { categories: usual.categories, uncategorizedMonthlyMinor: 310_000 }; // за 17 дней 170 000
    const p = plan({ usual: withLoose, forecast: forecast({ perDayMinor: 40_000 }) });
    // привычные = 438 709 + 274 193 + 170 000 = 882 902 → резать нужно 150 000 + 882 902 − 680 000 = 352 902
    expect(p.day?.cutTotalMinor).toBe(352_902);
    expect(p.day?.categories.some((c) => c.categoryId === 'uncategorized')).toBe(false);
  });

  it('категорий с нулевыми привычными тратами в разборе нет', () => {
    const p = plan({ usual: { categories: [...usual.categories, { categoryId: 'zero', usualMonthlyMinor: 0, essential: false }], uncategorizedMonthlyMinor: 0 } });
    expect(p.day?.categories.some((c) => c.categoryId === 'zero')).toBe(false);
  });
});

describe('usualSpendFromHistory', () => {
  const months = [
    { byCategory: [{ categoryId: 'food', totalMinor: 300_000 }, { categoryId: 'rent', totalMinor: 500_000 }], expenseMinor: 850_000 },
    { byCategory: [], expenseMinor: 0 }, // пустой месяц среднее не занижает
    { byCategory: [{ categoryId: 'food', totalMinor: 500_000 }, { categoryId: 'rent', totalMinor: 500_000 }, { categoryId: null, totalMinor: 20_000 }], expenseMinor: 1_050_000 },
  ];

  it('среднее по месяцам с тратами; обязательность — по правилу вызывающего; остальное — «без категории»', () => {
    const u = usualSpendFromHistory(months, (id) => id === 'rent')!;
    expect(u.categories).toEqual([
      { categoryId: 'rent', usualMonthlyMinor: 500_000, essential: true },
      { categoryId: 'food', usualMonthlyMinor: 400_000, essential: false },
    ]);
    // всего (850 000 + 1 050 000) − по категориям (800 000 + 1 000 000) = 100 000, среднее за 2 месяца — 50 000
    expect(u.uncategorizedMonthlyMinor).toBe(50_000);
  });

  it('комиссии (kind: fee) не относятся к категории', () => {
    const u = usualSpendFromHistory([{ byCategory: [{ categoryId: null, totalMinor: 5_000, kind: 'fee' }, { categoryId: 'a', totalMinor: 100_000 }], expenseMinor: 105_000 }], () => false)!;
    expect(u.categories).toEqual([{ categoryId: 'a', usualMonthlyMinor: 100_000, essential: false }]);
    expect(u.uncategorizedMonthlyMinor).toBe(5_000);
  });

  it('трат не было вовсе — null', () => {
    expect(usualSpendFromHistory([], () => false)).toBeNull();
    expect(usualSpendFromHistory([{ byCategory: [], expenseMinor: 0 }], () => false)).toBeNull();
  });
});
