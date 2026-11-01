import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SEASON_MAX_MONTHS,
  SEASON_MIN_ACTIVE_MONTHS,
  SEASON_RATIO_PERCENT,
  averageOfActive,
  monthPrepositional,
  seasonalHeadsUp,
  shiftMonthKey,
  upcomingMonths,
  yearWindow,
} from './seasonality';

const TODAY = '2026-10-15'; // «год» — с 2025-10 по 2026-09 включительно

/** Расходы по всем 12 месяцам «года» по 1 000 с. (100 000 дирам); overrides — отдельные месяцы. */
function year(overrides: Record<string, number> = {}, base = 100_000): Map<string, number> {
  const m = new Map<string, number>(yearWindow(TODAY).map((k) => [k, base] as const));
  for (const [k, v] of Object.entries(overrides)) m.set(k, v);
  return m;
}

describe('shiftMonthKey', () => {
  it('сдвигает через границу года в обе стороны', () => {
    expect(shiftMonthKey('2026-10', 1)).toBe('2026-11');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-10', -12)).toBe('2025-10');
    expect(shiftMonthKey('2026-10', 0)).toBe('2026-10');
    expect(shiftMonthKey('2026-03', 24)).toBe('2028-03');
  });

  it('мусор вместо месяца — RangeError', () => {
    expect(() => shiftMonthKey('2026-13', 1)).toThrow(RangeError);
    expect(() => shiftMonthKey('2026-1', 1)).toThrow(RangeError);
    expect(() => shiftMonthKey('', 1)).toThrow(RangeError);
  });
});

describe('yearWindow', () => {
  it('двенадцать полных месяцев перед текущим, от раннего к позднему', () => {
    const w = yearWindow(TODAY);
    expect(w).toHaveLength(12);
    expect(w[0]).toBe('2025-10');
    expect(w[11]).toBe('2026-09');
    expect(w).not.toContain('2026-10');
  });

  it('в январе окно целиком в прошлом году', () => {
    const w = yearWindow('2027-01-05');
    expect(w[0]).toBe('2026-01');
    expect(w[11]).toBe('2026-12');
  });
});

describe('upcomingMonths', () => {
  it('месяцы после текущего до месяца срока включительно', () => {
    expect(upcomingMonths(TODAY, '2026-12-20')).toEqual(['2026-11', '2026-12']);
    expect(upcomingMonths(TODAY, '2026-11-01')).toEqual(['2026-11']);
  });

  it(`не больше ${SEASON_MAX_MONTHS} месяцев от текущего, через границу года`, () => {
    expect(upcomingMonths(TODAY, '2028-01-01')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(upcomingMonths(TODAY, '2027-01-31')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(upcomingMonths('2026-12-10', '2027-02-05')).toEqual(['2027-01', '2027-02']);
  });

  it('нет срока, срок в текущем месяце, прошёл или нечитаем — пусто', () => {
    expect(upcomingMonths(TODAY, null)).toEqual([]);
    expect(upcomingMonths(TODAY, '2026-10-31')).toEqual([]);
    expect(upcomingMonths(TODAY, '2026-10-16')).toEqual([]);
    expect(upcomingMonths(TODAY, '2026-09-30')).toEqual([]);
    expect(upcomingMonths(TODAY, 'потом')).toEqual([]);
    expect(upcomingMonths('сегодня', '2026-12-01')).toEqual([]);
    expect(upcomingMonths(TODAY, '2026-13-01')).toEqual([]);
  });
});

describe('averageOfActive', () => {
  it('среднее вниз по положительным; нули, минусы и мусор не считаются', () => {
    expect(averageOfActive([100, 200, 301])).toBe(200);
    expect(averageOfActive([0, 0, 300, 100])).toBe(200);
    expect(averageOfActive([-5, 0, 10, Number.NaN, 1.5])).toBe(10);
  });

  it('нет положительных — null', () => {
    expect(averageOfActive([])).toBeNull();
    expect(averageOfActive([0, 0, -3])).toBeNull();
  });

  it('большие суммы не теряют точность', () => {
    expect(averageOfActive([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('monthPrepositional', () => {
  it('все двенадцать месяцев в предложном падеже', () => {
    const names = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
    names.forEach((name, i) => expect(monthPrepositional(`2026-${String(i + 1).padStart(2, '0')}`)).toBe(name));
  });

  it('нечитаемый месяц — пустая строка', () => {
    expect(monthPrepositional('2026-13')).toBe('');
    expect(monthPrepositional('декабрь')).toBe('');
  });
});

describe('seasonalHeadsUp', () => {
  it('декабрь год назад заметно дороже обычного — предупреждение с цифрами', () => {
    // 11 месяцев по 100 000 и декабрь 160 000: обычно 1 260 000 ÷ 12 = 105 000, декабрь выше на 55 000 (52 %)
    const hints = seasonalHeadsUp(year({ '2025-12': 160_000 }), TODAY, '2027-01-20', 'TJS');
    expect(hints).toEqual([{ month: '2026-12', yearAgoMinor: 160_000, averageMinor: 105_000, extraMinor: 55_000, percent: 52 }]);
  });

  it('несколько сезонных месяцев — по возрастанию', () => {
    const hints = seasonalHeadsUp(year({ '2025-11': 150_000, '2025-12': 160_000 }), TODAY, '2027-01-20', 'TJS');
    expect(hints.map((h) => h.month)).toEqual(['2026-11', '2026-12']);
    expect(hints[0]).toMatchObject({ yearAgoMinor: 150_000, averageMinor: 109_166, extraMinor: 40_834, percent: 37 });
    expect(hints[1]).toMatchObject({ yearAgoMinor: 160_000, averageMinor: 109_166, extraMinor: 50_834, percent: 46 });
  });

  it('месяц за пределами срока не предупреждает', () => {
    // декабрь сезонный, но срок 3 ноября — до декабря цель уже должна быть достигнута
    expect(seasonalHeadsUp(year({ '2025-12': 160_000 }), TODAY, '2026-11-03', 'TJS')).toEqual([]);
    expect(seasonalHeadsUp(year({ '2025-11': 160_000 }), TODAY, '2026-11-03', 'TJS').map((h) => h.month)).toEqual(['2026-11']);
  });

  it('смотрим не дальше трёх месяцев от текущего', () => {
    // февраль 2027 — четвёртый месяц: даже при сезонном феврале год назад предупреждения нет
    expect(seasonalHeadsUp(year({ '2026-02': 200_000 }), TODAY, '2027-06-30', 'TJS')).toEqual([]);
  });

  it('нет срока или срок в текущем месяце — подсказок нет', () => {
    const totals = year({ '2025-12': 160_000 });
    expect(seasonalHeadsUp(totals, TODAY, null, 'TJS')).toEqual([]);
    expect(seasonalHeadsUp(totals, TODAY, '2026-10-31', 'TJS')).toEqual([]);
  });

  it('истории мало: меньше девяти месяцев с расходами — подсказок нет, ровно девять — есть', () => {
    // последние `recent` месяцев окна по 100 000 и сезонный декабрь 2025 (он в окне, но раньше последних семи-восьми месяцев)
    const sparse = (recent: number): Map<string, number> => {
      const m = new Map<string, number>();
      yearWindow(TODAY).slice(12 - recent).forEach((k) => m.set(k, 100_000));
      m.set('2025-12', 400_000);
      return m;
    };
    expect(SEASON_MIN_ACTIVE_MONTHS).toBe(9);
    expect(seasonalHeadsUp(sparse(7), TODAY, '2027-01-20', 'TJS')).toEqual([]); // 7 + декабрь = 8 активных
    expect(seasonalHeadsUp(sparse(8), TODAY, '2027-01-20', 'TJS').map((h) => h.month)).toEqual(['2026-12']); // 8 + декабрь = 9
  });

  it('месяцы без расходов не занижают обычное', () => {
    // три пустых месяца окна: обычное — среднее по девяти активным (100 000), а не по двенадцати
    const totals = year({ '2025-12': 160_000, '2026-02': 0, '2026-03': 0, '2026-04': 0 });
    const [hint] = seasonalHeadsUp(totals, TODAY, '2027-01-20', 'TJS');
    expect(hint?.averageMinor).toBe(Math.floor((8 * 100_000 + 160_000) / 9));
  });

  it('в месяце год назад расходов не было — предупреждения нет', () => {
    expect(seasonalHeadsUp(year({ '2025-12': 0 }), TODAY, '2027-01-20', 'TJS')).toEqual([]);
  });

  it(`порог ${SEASON_RATIO_PERCENT} %: выше — да, чуть ниже — нет, ровно на пороге — да`, () => {
    // 11 месяцев по 100 000 и «особый» X: обычное = ⌊(1 100 000 + X) ÷ 12⌋
    const above = seasonalHeadsUp(year({ '2025-12': 130_000 }), TODAY, '2027-01-20', 'TJS'); // обычное 102 500, порог 128 125
    expect(above.map((h) => h.month)).toEqual(['2026-12']);
    const justUnder = seasonalHeadsUp(year({ '2025-12': 125_000 }), TODAY, '2027-01-20', 'TJS'); // обычное 102 083, порог 127 604
    expect(justUnder).toEqual([]);
    // 11 месяцев по 43 000 и 55 000: обычное ровно 44 000, а 55 000 = 125 % от него
    const exact = seasonalHeadsUp(year({ '2025-12': 55_000 }, 43_000), TODAY, '2027-01-20', 'TJS');
    expect(exact).toEqual([{ month: '2026-12', yearAgoMinor: 55_000, averageMinor: 44_000, extraMinor: 11_000, percent: 25 }]);
  });

  it('копеечное превышение не считается: порог — не меньше одной основной единицы валюты', () => {
    // все месяцы по 100 дирам (1 с.), декабрь 130: ≥ 125 %, но превышение 30 дирам меньше одной единицы (100)
    expect(seasonalHeadsUp(year({ '2025-12': 130 }, 100), TODAY, '2027-01-20', 'TJS')).toEqual([]);
    // в валюте без дробной части единица — 1: то же превышение уже заметно
    const jpy = seasonalHeadsUp(year({ '2025-12': 130 }, 100), TODAY, '2027-01-20', 'JPY');
    expect(jpy.map((h) => h.month)).toEqual(['2026-12']);
  });

  it('суммы около нуля и мусор в данных не ломают расчёт', () => {
    expect(seasonalHeadsUp(new Map(), TODAY, '2027-01-20', 'TJS')).toEqual([]);
    expect(seasonalHeadsUp(year({}, 0), TODAY, '2027-01-20', 'TJS')).toEqual([]);
    expect(seasonalHeadsUp(year({ '2025-12': Number.NaN }), TODAY, '2027-01-20', 'TJS')).toEqual([]);
    expect(seasonalHeadsUp(year({ '2025-12': -5 }), TODAY, '2027-01-20', 'TJS')).toEqual([]);
  });

  it('переход через год: январь-февраль после декабря', () => {
    const today = '2026-12-10';
    const totals = new Map<string, number>(yearWindow(today).map((k) => [k, 100_000] as const)); // 2025-12 … 2026-11
    totals.set('2026-02', 180_000);
    const hints = seasonalHeadsUp(totals, today, '2027-02-05', 'TJS');
    expect(hints.map((h) => h.month)).toEqual(['2027-02']);
    expect(hints[0]?.yearAgoMinor).toBe(180_000);
  });

  it('свойство: подсказки удовлетворяют определению и идут по возрастанию, не больше трёх', () => {
    const dateArb = fc.date({ min: new Date('2024-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
    fc.assert(
      fc.property(
        dateArb,
        fc.option(fc.integer({ min: 0, max: 180 }), { nil: null }),
        fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 12, maxLength: 12 }),
        fc.constantFrom('TJS', 'USD', 'JPY'),
        (today, ahead, values, currency) => {
          const window = yearWindow(today);
          const totals = new Map(window.map((m, i) => [m, values[i] ?? 0] as const));
          const due = ahead === null ? null : new Date(new Date(`${today}T00:00:00Z`).getTime() + ahead * 86_400_000).toISOString().slice(0, 10);
          const hints = seasonalHeadsUp(totals, today, due, currency);
          const targets = upcomingMonths(today, due);
          expect(hints.length).toBeLessThanOrEqual(SEASON_MAX_MONTHS);
          expect(hints.map((h) => h.month)).toEqual([...hints.map((h) => h.month)].sort());
          const active = values.filter((v) => v > 0);
          if (active.length < SEASON_MIN_ACTIVE_MONTHS) expect(hints).toEqual([]);
          for (const h of hints) {
            expect(targets).toContain(h.month);
            expect(h.averageMinor).toBe(averageOfActive(values));
            expect(h.extraMinor).toBe(h.yearAgoMinor - h.averageMinor);
            expect(h.yearAgoMinor * 100).toBeGreaterThanOrEqual(h.averageMinor * SEASON_RATIO_PERCENT);
            expect(h.percent).toBe(Math.floor((h.extraMinor * 100) / h.averageMinor));
            expect(h.percent).toBeGreaterThanOrEqual(SEASON_RATIO_PERCENT - 100);
          }
        },
      ),
    );
  });
});
