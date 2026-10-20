import { describe, expect, it } from 'vitest';
import { limitHints, niceRound, spentInScope, type MonthSpend } from './budgetHints';

const month = (m: string, expense: number, rows: { categoryId: string | null; totalMinor: number; kind?: 'fee' }[] = []): MonthSpend => ({
  month: m,
  expenseMinor: expense,
  byCategory: rows,
});

const noParents = new Map<string, string | null>();

describe('niceRound: «красивая» сумма лимита по порядку величины', () => {
  it('до 20 — до целой единицы, до 100 — до 5, дальше — две значащие цифры; к ближайшему', () => {
    expect(niceRound(1, 'TJS')).toBe(100); // 0,01 → не меньше одной единицы
    expect(niceRound(1500, 'TJS')).toBe(1500); // 15 с.
    expect(niceRound(8700, 'TJS')).toBe(8500); // 87 → 85
    expect(niceRound(43_700, 'TJS')).toBe(44_000); // 437 → 440
    expect(niceRound(31_850, 'TJS')).toBe(32_000); // 318,5 → 320
    expect(niceRound(123_400, 'TJS')).toBe(120_000); // 1 234 → 1 200
    expect(niceRound(100_001, 'TJS')).toBe(100_000); // 1000,01 не прыгает на 1 100
    expect(niceRound(99_901, 'TJS')).toBe(100_000);
  });
  it('большие номиналы (сум, тенге) тоже округляются, а не остаются как есть', () => {
    expect(niceRound(437_812_00, 'KZT')).toBe(440_000_00);
    expect(niceRound(5_432_100_00, 'UZS')).toBe(5_400_000_00);
  });
  it('валюта без дробной части (иена): единицы — целые, а не сотые', () => {
    expect(niceRound(87, 'JPY')).toBe(85);
    expect(niceRound(1234, 'JPY')).toBe(1200);
  });
});

describe('spentInScope: те же правила, что у прогресса бюджета', () => {
  const m = month('2026-09', 1000, [
    { categoryId: 'food', totalMinor: 400 },
    { categoryId: 'fruit', totalMinor: 100 }, // подкатегория «Еды»
    { categoryId: 'taxi', totalMinor: 200 },
    { categoryId: null, totalMinor: 150 }, // без категории
    { categoryId: null, totalMinor: 150, kind: 'fee' }, // комиссии
  ]);
  const parents = new Map<string, string | null>([['fruit', 'food']]);

  it('общий лимит — все расходы месяца, с комиссиями и «без категории»', () => {
    expect(spentInScope(m, null, parents)).toBe(1000);
  });
  it('лимит на категорию — она и её подкатегории; комиссии и «без категории» не входят', () => {
    expect(spentInScope(m, 'food', parents)).toBe(500);
    expect(spentInScope(m, 'fruit', parents)).toBe(100);
    expect(spentInScope(m, 'taxi', parents)).toBe(200);
  });
  it('не помещающаяся в целое сумма — RangeError (вызывающий скажет «подсказки нет»)', () => {
    const big = month('2026-09', 0, [
      { categoryId: 'a', totalMinor: Number.MAX_SAFE_INTEGER },
      { categoryId: 'b', totalMinor: Number.MAX_SAFE_INTEGER },
    ]);
    expect(() => spentInScope(big, 'a', new Map())).not.toThrow(); // одна категория помещается
    const both = new Map<string, string | null>([['b', 'a']]);
    expect(() => spentInScope(big, 'a', both)).toThrow(RangeError);
  });
});

describe('limitHints', () => {
  it('нет трат — подсказок нет', () => {
    const h = limitHints([month('2026-09', 0), month('2026-08', 0), month('2026-07', 0)], null, noParents, 'TJS');
    expect(h).toEqual({ lastMonth: null, typical: null, lastMonthLimit: null, typicalLimit: null });
  });

  it('только прошлый месяц: подсказка «как в прошлом месяце», «обычно» нет (один месяц — не «обычно»)', () => {
    const h = limitHints([month('2026-09', 43_700), month('2026-08', 0), month('2026-07', 0)], null, noParents, 'TJS');
    expect(h.lastMonth).toBe(43_700);
    expect(h.lastMonthLimit).toBe(44_000);
    expect(h.typical).toBeNull();
    expect(h.typicalLimit).toBeNull();
  });

  it('«обычно» — середина месяцев, в которых были траты (нулевые не тянут вниз)', () => {
    const h = limitHints([month('2026-09', 43_700), month('2026-08', 20_000), month('2026-07', 0)], null, noParents, 'TJS');
    expect(h.typical).toBe(31_850); // (437 + 200) / 2
    expect(h.typicalLimit).toBe(32_000);
    const three = limitHints([month('2026-09', 90_000), month('2026-08', 10_000), month('2026-07', 50_000)], null, noParents, 'TJS');
    expect(three.typical).toBe(50_000); // медиана, а не среднее: одна дорогая покупка её не задирает
  });

  it('в прошлом месяце не тратили, а раньше тратили: «обычно» есть, «как в прошлом» нет', () => {
    const h = limitHints([month('2026-09', 0), month('2026-08', 20_000), month('2026-07', 40_000)], null, noParents, 'TJS');
    expect(h.lastMonth).toBeNull();
    expect(h.lastMonthLimit).toBeNull();
    expect(h.typical).toBe(30_000);
  });

  it('по категории считает её и подкатегории', () => {
    const rows = [
      { categoryId: 'food', totalMinor: 10_000 },
      { categoryId: 'fruit', totalMinor: 5000 },
      { categoryId: 'taxi', totalMinor: 99_000 },
    ];
    const h = limitHints([month('2026-09', 114_000, rows)], 'food', new Map([['fruit', 'food']]), 'TJS');
    expect(h.lastMonth).toBe(15_000);
  });

  it('суммы слишком велики — подсказок нет, а не падение', () => {
    const big = month('2026-09', 0, [
      { categoryId: 'a', totalMinor: Number.MAX_SAFE_INTEGER },
      { categoryId: 'b', totalMinor: Number.MAX_SAFE_INTEGER },
    ]);
    const h = limitHints([big], 'a', new Map([['b', 'a']]), 'TJS');
    expect(h.lastMonth).toBeNull();
  });
});
