import { describe, expect, it } from 'vitest';
import { formatMinor } from '@/domain/money';
import type { CategoryAdvice, DayPlan, GoalPlanItem } from '@/domain/savingsPlan';
import { NO_HISTORY_TEXT, adviceLine, goalMonthLine, horizonLabel, monthLeftLine, planStatusLine, withoutGoalLine } from './goalsText';

const CUR = 'TJS';
const money = (n: number) => formatMinor(n, CUR);

const item = (over: Partial<GoalPlanItem> = {}): GoalPlanItem => ({
  id: 'g',
  state: 'active',
  progress: null,
  monthNeedMinor: 150_000,
  savedThisMonthMinor: 0,
  leftThisMonthMinor: 150_000,
  ...over,
});

const day = (over: Partial<DayPlan> = {}): DayPlan => ({
  status: 'cut',
  horizonDays: 17,
  reserveMinor: 150_000,
  perDayMinor: 40_000,
  perDayWithGoalMinor: 31_176,
  cutPerDayMinor: 8_824,
  cutTotalMinor: 182_902,
  uncoveredMinor: 0,
  categories: [],
  ...over,
});

const advice = (over: Partial<CategoryAdvice>): CategoryAdvice => ({
  categoryId: 'c',
  essential: false,
  usualRestMinor: 100_000,
  cutMinor: 0,
  allowedMinor: 100_000,
  advice: 'keep',
  ...over,
});

describe('horizonLabel', () => {
  it('до конца месяца, если горизонт доходит до него, иначе — до даты', () => {
    expect(horizonLabel('2026-10-31', '2026-10-31')).toBe('до конца месяца');
    expect(horizonLabel('2026-11-04', '2026-10-31')).toBe('до конца месяца');
    expect(horizonLabel('2026-10-20', '2026-10-31')).toMatch(/^до .*20/);
  });
});

describe('monthLeftLine', () => {
  it('говорит, сколько ещё отложить, или что уже достаточно', () => {
    expect(monthLeftLine(150_000, CUR)).toBe(`В этом месяце нужно отложить ещё ${money(150_000)}`);
    expect(monthLeftLine(0, CUR)).toBe('В этом месяце уже отложено сколько нужно');
  });
});

describe('goalMonthLine', () => {
  it('активная цель: сколько нужно за месяц и сколько уже отложено', () => {
    expect(goalMonthLine(item(), CUR)).toBe(`За месяц нужно отложить ${money(150_000)}`);
    expect(goalMonthLine(item({ savedThisMonthMinor: 50_000, leftThisMonthMinor: 100_000 }), CUR)).toBe(
      `За месяц нужно ${money(150_000)} · уже отложено ${money(50_000)}`,
    );
    expect(goalMonthLine(item({ savedThisMonthMinor: 150_000, leftThisMonthMinor: 0 }), CUR)).toContain('отложено сколько нужно');
  });

  it('достигнутая, просроченная и «в другой валюте» цели описаны словами', () => {
    expect(goalMonthLine(item({ state: 'reached' }), CUR)).toBe('Цель достигнута');
    expect(goalMonthLine(item({ state: 'overdue' }), CUR)).toContain('Срок прошёл');
    expect(goalMonthLine(item({ state: 'other-currency' }), CUR)).toContain('другой валюте');
  });
});

describe('adviceLine', () => {
  it('обязательная — без изменений; урезаемая — «не больше»; «лучше не тратить»; «как обычно»', () => {
    expect(adviceLine(advice({ essential: true }), CUR)).toContain('без изменений');
    expect(adviceLine(advice({ advice: 'trim', cutMinor: 30_000, allowedMinor: 70_000 }), CUR)).toBe(`Не больше ${money(70_000)} (обычно ~${money(100_000)})`);
    expect(adviceLine(advice({ advice: 'skip', cutMinor: 100_000, allowedMinor: 0 }), CUR)).toBe(`Лучше не тратить (обычно ~${money(100_000)})`);
    expect(adviceLine(advice({}), CUR)).toBe(`Как обычно (~${money(100_000)})`);
  });
});

describe('planStatusLine', () => {
  it('ok: тратьте как обычно', () => {
    expect(planStatusLine(day({ status: 'ok', cutTotalMinor: 0 }), CUR, 'до конца месяца')).toContain('тратьте как обычно');
  });

  it('cut с разбором: сколько сократить; без разбора — лимит в день', () => {
    expect(planStatusLine(day(), CUR, 'до конца месяца')).toBe(`Чтобы успеть, до конца месяца сократите привычные траты на ${money(182_902)}.`);
    expect(planStatusLine(day({ cutTotalMinor: null }), CUR, 'до конца месяца')).toBe(
      `Чтобы успеть, до конца месяца тратьте не больше ${money(31_176)} в день.`,
    );
  });

  it('tight: сколько не хватает и что делать', () => {
    const text = planStatusLine(day({ status: 'tight', uncoveredMinor: 84_193 }), CUR, 'до конца месяца');
    expect(text).toContain(money(84_193));
    expect(text).toContain('Сдвиньте срок или уменьшите сумму');
    expect(planStatusLine(day({ status: 'tight', cutTotalMinor: null, uncoveredMinor: 65_000 }), CUR, 'до 20 октября')).toContain('до 20 октября');
  });
});

describe('прочее', () => {
  it('«без цели» и подсказка про историю', () => {
    expect(withoutGoalLine(40_000, CUR)).toBe(`Без цели — ${money(40_000)} в день`);
    expect(NO_HISTORY_TEXT).toContain('история трат');
  });
});
