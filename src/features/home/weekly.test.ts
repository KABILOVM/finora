import { describe, expect, it } from 'vitest';
import { inShowWindow, WEEKLY_SHOW_DAYS, weekRangeText, weeklySummary, weekStart, type WeekTx } from './weekly';

const BASE = 'TJS';
/** Четверг 15 октября 2026: прошедшая неделя — 5–11 октября, до неё — 28 сентября – 4 октября. */
const TODAY = '2026-10-15';
let seq = 0;
const tx = (over: Partial<WeekTx> & { occurredOn: string; amountMinor: number }): WeekTx => ({
  id: over.id ?? `t${String(++seq).padStart(4, '0')}`,
  kind: 'expense',
  walletId: 'w1',
  toWalletId: null,
  categoryId: 'food',
  baseAmountMinor: over.amountMinor,
  baseCurrency: BASE,
  note: '',
  createdAt: '2026-10-01T00:00:00.000Z',
  debtId: null,
  recurringRuleId: null,
  deletedAt: null,
  ...over,
});

describe('неделя', () => {
  it('weekStart: понедельник той же недели', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-12'); // четверг
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // понедельник
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // воскресенье
    expect(weekStart('2026-01-01')).toBe('2025-12-29'); // через границу года
  });

  it('карточку показываем с понедельника по четверг', () => {
    expect(WEEKLY_SHOW_DAYS).toBe(4);
    expect(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map(inShowWindow)).toEqual([true, true, true, true]);
    expect(['2026-10-16', '2026-10-17', '2026-10-18'].map(inShowWindow)).toEqual([false, false, false]);
  });

  it('weekRangeText: в одном месяце — «5–11 октября», в разных — «28 сентября – 4 октября»', () => {
    expect(weekRangeText('2026-10-05', '2026-10-11')).toBe('5–11 октября');
    expect(weekRangeText('2026-09-28', '2026-10-04')).toBe('28 сентября – 4 октября');
    expect(weekRangeText('2025-12-29', '2026-01-04')).toBe('29 декабря – 4 января');
  });
});

describe('weeklySummary', () => {
  const rows = (): WeekTx[] => [
    tx({ occurredOn: '2026-10-05', amountMinor: 10_000, categoryId: 'food', note: 'обед' }), // понедельник
    tx({ occurredOn: '2026-10-07', amountMinor: 30_000, categoryId: 'food', note: 'ужин в кафе' }),
    tx({ occurredOn: '2026-10-11', amountMinor: 20_000, categoryId: 'taxi' }), // воскресенье
    tx({ occurredOn: '2026-10-09', amountMinor: 500_000, kind: 'income', categoryId: 'salary' }),
    tx({ occurredOn: '2026-10-02', amountMinor: 40_000 }), // неделей раньше
    tx({ occurredOn: '2026-10-12', amountMinor: 99_000 }), // нынешняя неделя — не входит
  ];

  it('расходы, доходы, сравнение с неделей раньше, главная категория и самая крупная трата', () => {
    const s = weeklySummary(rows(), TODAY, BASE)!;
    expect(s).toMatchObject({ from: '2026-10-05', to: '2026-10-11', expenseMinor: 60_000, previousExpenseMinor: 40_000, incomeMinor: 500_000 });
    expect(s.top).toEqual({ categoryId: 'food', totalMinor: 40_000, sharePercent: 66 }); // 40 из 60
    expect(s.biggest).toMatchObject({ note: 'ужин в кафе', amountMinor: 30_000, occurredOn: '2026-10-07' });
  });

  it('понедельник и воскресенье — границы: в неделю входят оба дня', () => {
    const s = weeklySummary([tx({ occurredOn: '2026-10-05', amountMinor: 1 }), tx({ occurredOn: '2026-10-11', amountMinor: 2 }), tx({ occurredOn: '2026-10-04', amountMinor: 4 })], TODAY, BASE)!;
    expect(s.expenseMinor).toBe(3);
    expect(s.previousExpenseMinor).toBe(4);
  });

  it('вне первых дней недели — null', () => {
    expect(weeklySummary(rows(), '2026-10-16', BASE)).toBeNull();
    expect(weeklySummary(rows(), '2026-10-18', BASE)).toBeNull();
  });

  it('за неделю ни расходов, ни доходов — null; один доход — карточка есть', () => {
    expect(weeklySummary([tx({ occurredOn: '2026-10-02', amountMinor: 100 })], TODAY, BASE)).toBeNull();
    const s = weeklySummary([tx({ occurredOn: '2026-10-08', amountMinor: 5_000, kind: 'income', categoryId: 'salary' })], TODAY, BASE)!;
    expect(s).toMatchObject({ expenseMinor: 0, incomeMinor: 5_000, top: null, biggest: null });
  });

  it('не считаются: удалённые, переводы, долги, корректировки, другая основная валюта; по расписанию в расходы входят, но не «самая крупная»', () => {
    const noise: WeekTx[] = [
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, deletedAt: '2026-10-07T00:00:00.000Z' }),
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, baseAmountMinor: 0, kind: 'transfer', toWalletId: 'w2', categoryId: null }),
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, debtId: 'd1' }),
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, fxSource: 'adjust' }),
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, baseCurrency: 'USD' }),
    ];
    const s = weeklySummary([...noise, tx({ occurredOn: '2026-10-08', amountMinor: 1_000, note: 'кофе' })], TODAY, BASE)!;
    expect(s.expenseMinor).toBe(1_000);
    expect(s.biggest?.note).toBe('кофе');
  });

  it('при равных суммах самая крупная — с меньшим id (одинаково на всех устройствах)', () => {
    const s = weeklySummary([tx({ id: 'b', occurredOn: '2026-10-06', amountMinor: 500, note: 'б' }), tx({ id: 'a', occurredOn: '2026-10-07', amountMinor: 500, note: 'а' })], TODAY, BASE)!;
    expect(s.biggest?.id).toBe('a');
  });

  it('«Без категории» может быть главной статьёй; комиссии перевода — нет', () => {
    const s = weeklySummary(
      [tx({ occurredOn: '2026-10-06', amountMinor: 9_000, categoryId: null }), tx({ occurredOn: '2026-10-07', amountMinor: 100, categoryId: 'food' }), tx({ occurredOn: '2026-10-08', amountMinor: 12_000, kind: 'transfer', toWalletId: 'w2', categoryId: null, baseAmountMinor: 12_000 })],
      TODAY,
      BASE,
    )!;
    expect(s.expenseMinor).toBe(21_100); // 90 + 1 + комиссия перевода 120 (комиссия — расход месяца)
    expect(s.top).toEqual({ categoryId: null, totalMinor: 9_000, sharePercent: 42 }); // комиссия больше, но она не «категория»
  });
});
