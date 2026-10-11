import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isOccurrence,
  isValidSchedule,
  nextOccurrence,
  occurrencesBetween,
  statusOf,
  upcomingOccurrences,
  type ScheduleRule,
} from '@/domain/schedule';

const rule = (over: Partial<ScheduleRule> = {}): ScheduleRule => ({
  frequency: 'monthly',
  intervalN: 1,
  startOn: '2026-01-31',
  endOn: null,
  ...over,
});

describe('occurrencesBetween: ежедневные и еженедельные', () => {
  it('каждый день, границы включительно', () => {
    expect(occurrencesBetween(rule({ frequency: 'daily', startOn: '2026-10-01' }), '2026-10-03', '2026-10-06')).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
  });
  it('каждые 3 дня считаются от начала, а не от начала отрезка', () => {
    const r = rule({ frequency: 'daily', intervalN: 3, startOn: '2026-10-01' });
    expect(occurrencesBetween(r, '2026-10-02', '2026-10-14')).toEqual(['2026-10-04', '2026-10-07', '2026-10-10', '2026-10-13']);
  });
  it('раз в 2 недели', () => {
    const r = rule({ frequency: 'weekly', intervalN: 2, startOn: '2026-10-05' });
    expect(occurrencesBetween(r, '2026-10-01', '2026-11-30')).toEqual(['2026-10-05', '2026-10-19', '2026-11-02', '2026-11-16', '2026-11-30']);
  });
  it('до начала расписания ничего нет; конец включительно', () => {
    const r = rule({ frequency: 'daily', startOn: '2026-10-05', endOn: '2026-10-07' });
    expect(occurrencesBetween(r, '2026-09-01', '2026-12-31')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
  it('переход через год', () => {
    const r = rule({ frequency: 'weekly', startOn: '2026-12-28' });
    expect(occurrencesBetween(r, '2026-12-27', '2027-01-12')).toEqual(['2026-12-28', '2027-01-04', '2027-01-11']);
  });
});

describe('occurrencesBetween: ежемесячные (зажим на последний день месяца)', () => {
  it('31 января → 28 февраля → 31 марта → 30 апреля (не дрейфует)', () => {
    expect(occurrencesBetween(rule(), '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });
  it('високосный год: 29 февраля', () => {
    expect(occurrencesBetween(rule({ startOn: '2028-01-31' }), '2028-01-01', '2028-03-31')).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });
  it('29 и 30 числа в феврале', () => {
    expect(occurrencesBetween(rule({ startOn: '2027-01-29' }), '2027-02-01', '2027-02-28')).toEqual(['2027-02-28']);
    expect(occurrencesBetween(rule({ startOn: '2027-01-30' }), '2027-02-01', '2027-03-31')).toEqual(['2027-02-28', '2027-03-30']);
  });
  it('каждые 3 месяца с переходом через год', () => {
    const r = rule({ intervalN: 3, startOn: '2026-11-30' });
    expect(occurrencesBetween(r, '2026-01-01', '2027-12-31')).toEqual(['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30', '2027-11-30']);
  });
  it('обычный день месяца и конец расписания', () => {
    const r = rule({ startOn: '2026-10-15', endOn: '2027-01-15' });
    expect(occurrencesBetween(r, '2026-01-01', '2030-01-01')).toEqual(['2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15']);
  });
  it('отрезок в середине длинного расписания не пропускает и не добавляет лишнего', () => {
    const r = rule({ startOn: '2020-03-31' });
    expect(occurrencesBetween(r, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('occurrencesBetween: ежегодные', () => {
  it('29 февраля: в обычные годы 28 февраля, в високосные 29', () => {
    const r = rule({ frequency: 'yearly', startOn: '2028-02-29' });
    expect(occurrencesBetween(r, '2028-01-01', '2032-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });
  it('каждые 2 года', () => {
    const r = rule({ frequency: 'yearly', intervalN: 2, startOn: '2026-10-05' });
    expect(occurrencesBetween(r, '2026-01-01', '2032-01-01')).toEqual(['2026-10-05', '2028-10-05', '2030-10-05']);
  });
});

describe('границы и некорректные данные', () => {
  it('пустой/перевёрнутый отрезок и мусор — пустой список, а не исключение', () => {
    const r = rule();
    expect(occurrencesBetween(r, '2026-05-01', '2026-04-01')).toEqual([]);
    expect(occurrencesBetween(r, 'вчера', '2026-04-01')).toEqual([]);
    expect(occurrencesBetween(r, '2026-02-30', '2026-04-01')).toEqual([]);
    expect(occurrencesBetween({ ...r, intervalN: 0 }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(occurrencesBetween({ ...r, intervalN: 1001 }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(occurrencesBetween({ ...r, intervalN: 1.5 }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(occurrencesBetween({ ...r, frequency: 'hourly' as never }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(occurrencesBetween({ ...r, endOn: '2025-01-01' }, '2026-01-01', '2026-12-31')).toEqual([]);
  });
  it('не дальше 2100-01-01 (граница сервера), как бы ни был велик шаг', () => {
    const r = rule({ frequency: 'yearly', startOn: '2099-06-01' });
    expect(occurrencesBetween(r, '2099-01-01', '2100-01-01')).toEqual(['2099-06-01']);
    expect(nextOccurrence(r, '2099-06-01')).toBeNull();
    expect(nextOccurrence(rule({ frequency: 'daily', startOn: '2100-01-01' }), '2100-01-01')).toBeNull();
    expect(occurrencesBetween(rule({ frequency: 'daily', startOn: '2099-12-30' }), '2099-12-01', '2100-01-01')).toEqual([
      '2099-12-30',
      '2099-12-31',
      '2100-01-01',
    ]);
  });
  it('очень большой шаг не зацикливается', () => {
    const r = rule({ frequency: 'yearly', intervalN: 1000, startOn: '2000-01-01' });
    expect(occurrencesBetween(r, '2000-01-01', '2100-01-01')).toEqual(['2000-01-01']);
  });
  it('isValidSchedule', () => {
    expect(isValidSchedule(rule())).toBe(true);
    expect(isValidSchedule(rule({ startOn: '1999-12-31' }))).toBe(false);
    expect(isValidSchedule(rule({ endOn: '2101-01-01' }))).toBe(false);
    expect(isValidSchedule(rule({ startOn: '2026-02-30' }))).toBe(false);
  });
});

describe('nextOccurrence', () => {
  it('строго после даты; до начала — само начало', () => {
    const r = rule({ startOn: '2026-10-15' });
    expect(nextOccurrence(r, '2020-01-01')).toBe('2026-10-15');
    expect(nextOccurrence(r, '2026-10-14')).toBe('2026-10-15');
    expect(nextOccurrence(r, '2026-10-15')).toBe('2026-11-15');
    expect(nextOccurrence(r, '2026-10-16')).toBe('2026-11-15');
  });
  it('зажим месяца и конец расписания', () => {
    expect(nextOccurrence(rule(), '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(rule(), '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(rule({ endOn: '2026-03-30' }), '2026-02-28')).toBeNull();
  });
  it('мусор — null', () => {
    expect(nextOccurrence(rule(), 'x')).toBeNull();
    expect(nextOccurrence(rule({ intervalN: 0 }), '2026-01-01')).toBeNull();
  });
});

describe('isOccurrence и statusOf', () => {
  it('входит ли дата в расписание', () => {
    const r = rule({ frequency: 'weekly', startOn: '2026-10-05' });
    expect(isOccurrence(r, '2026-10-12')).toBe(true);
    expect(isOccurrence(r, '2026-10-13')).toBe(false);
    expect(isOccurrence(r, '2026-09-28')).toBe(false);
    expect(isOccurrence(r, 'мусор')).toBe(false);
  });
  it('статус относительно сегодняшнего дня', () => {
    expect(statusOf('2026-10-10', '2026-10-11')).toBe('overdue');
    expect(statusOf('2026-10-11', '2026-10-11')).toBe('due');
    expect(statusOf('2026-10-12', '2026-10-11')).toBe('upcoming');
  });
});

describe('upcomingOccurrences', () => {
  const rules = [
    { id: 'a', ...rule({ frequency: 'weekly', startOn: '2026-10-05' }) },
    { id: 'b', ...rule({ frequency: 'monthly', startOn: '2026-01-15' }) },
  ];
  it('просроченные, сегодняшние и будущие в одном списке по возрастанию даты', () => {
    const got = upcomingOccurrences(rules, '2026-10-12', 10, 14).map((e) => [e.rule.id, e.date, e.status]);
    expect(got).toEqual([
      ['a', '2026-10-05', 'overdue'],
      ['a', '2026-10-12', 'due'],
      ['b', '2026-10-15', 'upcoming'],
      ['a', '2026-10-19', 'upcoming'],
    ]);
  });
  it('окно ограничено: дальше lookbackDays назад не смотрим, daysAhead = 0 даёт только прошлое и сегодня', () => {
    expect(upcomingOccurrences(rules.slice(0, 1), '2026-10-12', 0, 3).map((e) => e.date)).toEqual(['2026-10-12']);
    expect(upcomingOccurrences(rules.slice(0, 1), '2026-10-12', 0, 7).map((e) => e.date)).toEqual(['2026-10-05', '2026-10-12']);
  });
  it('дробные и отрицательные значения окна не ломают расчёт', () => {
    expect(upcomingOccurrences(rules.slice(0, 1), '2026-10-12', -5, -1).map((e) => e.date)).toEqual(['2026-10-12']);
    expect(upcomingOccurrences(rules.slice(0, 1), '2026-10-12', Number.NaN, Number.NaN).map((e) => e.date)).toEqual(['2026-10-12']);
    expect(upcomingOccurrences(rules, 'мусор', 5)).toEqual([]);
  });
});

// ───────────────────────── свойства ─────────────────────────

const freqArb = fc.constantFrom('daily', 'weekly', 'monthly', 'yearly' as const);
const dateArb = fc
  .integer({ min: Date.UTC(2000, 0, 1) / 86_400_000, max: Date.UTC(2100, 0, 1) / 86_400_000 })
  .map((d) => new Date(d * 86_400_000).toISOString().slice(0, 10));
const ruleArb = fc
  .record({
    frequency: freqArb,
    intervalN: fc.oneof(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 1000 })),
    startOn: dateArb,
    endOn: fc.option(dateArb, { nil: null }),
  })
  .filter((r) => isValidSchedule(r as ScheduleRule)) as fc.Arbitrary<ScheduleRule>;

describe('occurrencesBetween: свойства (fast-check)', () => {
  it('строго возрастает, без повторов, внутри отрезка, не раньше начала и не позже конца', () => {
    fc.assert(
      fc.property(ruleArb, dateArb, fc.integer({ min: 0, max: 800 }), (r, from, span) => {
        const to = new Date(Date.parse(from) + span * 86_400_000).toISOString().slice(0, 10);
        const out = occurrencesBetween(r, from, to > '2100-01-01' ? '2100-01-01' : to);
        for (let i = 0; i < out.length; i++) {
          const d = out[i]!;
          expect(d >= from && d >= r.startOn && d <= '2100-01-01').toBe(true);
          if (r.endOn !== null) expect(d <= r.endOn).toBe(true);
          if (i > 0) expect(d > out[i - 1]!).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('отрезок можно резать: результат на [a,c] = результат на [a,b] + результат на [b+1,c]', () => {
    fc.assert(
      fc.property(ruleArb, dateArb, fc.integer({ min: 1, max: 600 }), fc.integer({ min: 0, max: 600 }), (r, a, s1, s2) => {
        const day = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
        const b = day(a, s1);
        const c = day(b, s2 + 1);
        if (c > '2100-01-01') return;
        const whole = occurrencesBetween(r, a, c);
        const left = occurrencesBetween(r, a, b);
        const right = occurrencesBetween(r, day(b, 1), c);
        expect([...left, ...right]).toEqual(whole);
      }),
      { numRuns: 300 },
    );
  });

  it('nextOccurrence согласован с occurrencesBetween: это первая дата строго после заданной', () => {
    fc.assert(
      fc.property(ruleArb, dateArb, (r, after) => {
        const next = nextOccurrence(r, after);
        const from = new Date(Date.parse(after) + 86_400_000).toISOString().slice(0, 10);
        const hit = from > '2100-01-01' ? null : (occurrencesBetween(r, from, '2100-01-01')[0] ?? null);
        expect(next).toBe(hit);
      }),
      { numRuns: 300 },
    );
  });

  it('месячные правила: день месяца никогда не больше дня якоря и равен ему, если месяц достаточно длинный', () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.integer({ min: 1, max: 24 }),
        (startOn, n) => {
          const r: ScheduleRule = { frequency: 'monthly', intervalN: n, startOn, endOn: null };
          const anchor = Number(startOn.slice(8));
          const out = occurrencesBetween(r, startOn, startOn.slice(0, 4) >= '2090' ? '2100-01-01' : `${Number(startOn.slice(0, 4)) + 8}-12-31`);
          for (const d of out) {
            const dayOfMonth = Number(d.slice(8));
            const len = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
            expect(dayOfMonth).toBe(Math.min(anchor, len));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('число срабатываний ежедневного правила = длине отрезка / шаг', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 1, max: 30 }), fc.integer({ min: 0, max: 400 }), (startOn, n, span) => {
        const to = new Date(Date.parse(startOn) + span * 86_400_000).toISOString().slice(0, 10);
        if (to > '2100-01-01') return;
        const out = occurrencesBetween({ frequency: 'daily', intervalN: n, startOn, endOn: null }, startOn, to);
        expect(out).toHaveLength(Math.floor(span / n) + 1);
      }),
      { numRuns: 200 },
    );
  });
});
