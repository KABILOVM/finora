import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextOccurrence, occurrencesBetween, type ScheduleRule } from '@/domain/schedule';
import { autoPostDates } from './plan';

/**
 * Атака «календарь»: расписание сравнивается с независимым перебором «k-я дата считается от начала» (по дню месяца, 29 февраля,
 * 31-му числу, шагу до 40, концу правила). Код выдержал — тест остаётся регрессионным.
 */

const DAY = 86_400_000;
const MIN = '2000-01-01';
const MAX = '2100-01-01';
const num = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY);
const fmt = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const p4 = (n: number) => String(n).padStart(4, '0');
const p2 = (n: number) => String(n).padStart(2, '0');

/** Образец: k-я дата правила по определению, все даты в [from, to]. */
function oracle(rule: ScheduleRule, from: string, to: string): string[] {
  const [sy, sm, sd] = rule.startOn.split('-').map(Number) as [number, number, number];
  const out: string[] = [];
  for (let k = 0; k < 50_000; k++) {
    let d: string;
    if (rule.frequency === 'daily') d = fmt(num(rule.startOn) + k * rule.intervalN);
    else if (rule.frequency === 'weekly') d = fmt(num(rule.startOn) + 7 * k * rule.intervalN);
    else if (rule.frequency === 'monthly') {
      const idx = sy * 12 + (sm - 1) + k * rule.intervalN;
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      d = `${p4(y)}-${p2(m)}-${p2(Math.min(sd, dim(y, m)))}`;
    } else {
      const y = sy + k * rule.intervalN;
      d = `${p4(y)}-${p2(sm)}-${p2(Math.min(sd, dim(y, sm)))}`;
    }
    if (d > to || d > MAX || (rule.endOn !== null && d > rule.endOn)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

const startArb = fc.integer({ min: num(MIN), max: num('2030-12-31') }).map(fmt);
const freqArb = fc.constantFrom('daily', 'weekly', 'monthly', 'yearly' as const);

describe('расписание против независимого перебора', () => {
  it('occurrencesBetween совпадает с образцом (в том числе 29 февраля, 31-е число, шаг до 40, конец правила)', () => {
    fc.assert(
      fc.property(freqArb, fc.integer({ min: 1, max: 40 }), startArb, fc.option(fc.integer({ min: 0, max: 4000 }), { nil: null }), fc.integer({ min: -200, max: 800 }), fc.integer({ min: 0, max: 800 }), (frequency, intervalN, startOn, endOff, a, b) => {
        const rule: ScheduleRule = { frequency, intervalN, startOn, endOn: endOff === null ? null : fmt(num(startOn) + endOff) };
        const from = fmt(Math.max(num(MIN), num(startOn) + a));
        const to = fmt(num(from) + b);
        expect(occurrencesBetween(rule, from, to)).toEqual(oracle(rule, from, to));
      }),
      { numRuns: 800 },
    );
  });

  it('nextOccurrence — это первая дата образца строго после заданной', () => {
    fc.assert(
      fc.property(freqArb, fc.integer({ min: 1, max: 30 }), startArb, fc.integer({ min: -100, max: 3000 }), (frequency, intervalN, startOn, a) => {
        const rule: ScheduleRule = { frequency, intervalN, startOn, endOn: null };
        const after = fmt(Math.max(num(MIN), num(startOn) + a));
        const first = oracle(rule, fmt(num(after) + 1), MAX)[0] ?? null;
        expect(nextOccurrence(rule, after)).toBe(first);
      }),
      { numRuns: 500 },
    );
  });

  it('окно автопроведения: все даты внутри [сегодня − 60, сегодня], не раньше начала и дня создания, без повторов', () => {
    fc.assert(
      fc.property(freqArb, fc.integer({ min: 1, max: 10 }), startArb, fc.integer({ min: 0, max: 400 }), (frequency, intervalN, startOn, off) => {
        const today = fmt(num(startOn) + off);
        const rule = { frequency, intervalN, startOn, endOn: null, createdAt: `${startOn}T00:00:00.000Z`, clientUpdatedAt: `${startOn}T00:00:00.000Z` };
        const dates = autoPostDates(rule, today, (iso) => iso.slice(0, 10));
        expect(new Set(dates).size).toBe(dates.length);
        for (const d of dates) {
          expect(d <= today).toBe(true);
          expect(d >= fmt(num(today) - 60)).toBe(true);
          expect(d >= startOn).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
