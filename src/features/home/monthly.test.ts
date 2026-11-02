import { describe, expect, it } from 'vitest';
import { lastMonthRange, monthRecap, type MonthTx } from './monthly';
import { inMonthlyWindow, MONTHLY_SHOW_DAYS } from './monthlyWindow';

const BASE = 'TJS';
/** Вторник 3 ноября 2026: прошедший месяц — октябрь, до него — сентябрь. */
const TODAY = '2026-11-03';
let seq = 0;
const tx = (over: Partial<MonthTx> & { occurredOn: string; amountMinor: number }): MonthTx => ({
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

describe('месяц', () => {
  it('карточку показываем с 1-го по 5-е число', () => {
    expect(MONTHLY_SHOW_DAYS).toBe(5);
    expect(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map(inMonthlyWindow)).toEqual([true, true, true, true, true]);
    expect(['2026-11-06', '2026-11-15', '2026-11-30'].map(inMonthlyWindow)).toEqual([false, false, false]);
  });

  it('lastMonthRange: прошедший месяц целиком, через границу года и в високосном феврале', () => {
    expect(lastMonthRange('2026-11-03')).toEqual({ month: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    expect(lastMonthRange('2026-11-01')).toEqual({ month: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    expect(lastMonthRange('2026-01-02')).toEqual({ month: '2025-12', from: '2025-12-01', to: '2025-12-31' });
    expect(lastMonthRange('2024-03-01')).toEqual({ month: '2024-02', from: '2024-02-01', to: '2024-02-29' });
    expect(lastMonthRange('2026-12-04')).toEqual({ month: '2026-11', from: '2026-11-01', to: '2026-11-30' });
  });
});

describe('monthRecap', () => {
  const rows = (): MonthTx[] => [
    tx({ occurredOn: '2026-10-05', amountMinor: 10_000, categoryId: 'food', note: 'обед' }),
    tx({ occurredOn: '2026-10-17', amountMinor: 30_000, categoryId: 'food', note: 'ужин в кафе' }),
    tx({ occurredOn: '2026-10-31', amountMinor: 20_000, categoryId: 'taxi' }), // последний день месяца
    tx({ occurredOn: '2026-10-09', amountMinor: 500_000, kind: 'income', categoryId: 'salary' }),
    tx({ occurredOn: '2026-09-30', amountMinor: 40_000 }), // месяцем раньше
    tx({ occurredOn: '2026-11-01', amountMinor: 99_000 }), // нынешний месяц — не входит
  ];

  it('расходы, доходы, остаток, сравнение с месяцем раньше, главная категория и самая крупная трата', () => {
    const r = monthRecap(rows(), TODAY, BASE)!;
    expect(r).toMatchObject({ month: '2026-10', expenseMinor: 60_000, previousExpenseMinor: 40_000, incomeMinor: 500_000, netMinor: 440_000 });
    expect(r.top).toEqual({ categoryId: 'food', totalMinor: 40_000, sharePercent: 66 }); // 40 из 60
    expect(r.biggest).toMatchObject({ note: 'ужин в кафе', amountMinor: 30_000, occurredOn: '2026-10-17' });
  });

  it('в среднем в день: расходы ÷ дней месяца, вниз (в октябре 31 день, в високосном феврале 29)', () => {
    expect(monthRecap(rows(), TODAY, BASE)!.perDayMinor).toBe(1_935); // 60 000 / 31 = 1935,48…
    const feb = monthRecap([tx({ occurredOn: '2024-02-10', amountMinor: 29_000 })], '2024-03-02', BASE)!;
    expect(feb.month).toBe('2024-02');
    expect(feb.perDayMinor).toBe(1_000);
  });

  it('первое и последнее число месяца входят в него, соседние месяцы — нет', () => {
    const r = monthRecap(
      [tx({ occurredOn: '2026-10-01', amountMinor: 1 }), tx({ occurredOn: '2026-10-31', amountMinor: 2 }), tx({ occurredOn: '2026-09-30', amountMinor: 4 }), tx({ occurredOn: '2026-11-01', amountMinor: 8 })],
      TODAY,
      BASE,
    )!;
    expect(r.expenseMinor).toBe(3);
    expect(r.previousExpenseMinor).toBe(4);
  });

  it('вне первых дней месяца — null', () => {
    expect(monthRecap(rows(), '2026-11-05', BASE)).not.toBeNull();
    expect(monthRecap(rows(), '2026-11-06', BASE)).toBeNull();
    expect(monthRecap(rows(), '2026-11-20', BASE)).toBeNull();
  });

  it('за месяц ни расходов, ни доходов — null; один доход — карточка есть', () => {
    expect(monthRecap([tx({ occurredOn: '2026-09-20', amountMinor: 100 })], TODAY, BASE)).toBeNull();
    expect(monthRecap([], TODAY, BASE)).toBeNull();
    const r = monthRecap([tx({ occurredOn: '2026-10-08', amountMinor: 5_000, kind: 'income', categoryId: 'salary' })], TODAY, BASE)!;
    expect(r).toMatchObject({ expenseMinor: 0, incomeMinor: 5_000, netMinor: 5_000, perDayMinor: 0, top: null, biggest: null });
  });

  it('самая крупная трата — только этого месяца, даже если в соседнем была больше', () => {
    const r = monthRecap([tx({ occurredOn: '2026-10-08', amountMinor: 1_000, note: 'кофе' }), tx({ occurredOn: '2026-09-08', amountMinor: 90_000, note: 'ремонт' })], TODAY, BASE)!;
    expect(r.biggest?.note).toBe('кофе');
  });

  it('не считаются: удалённые, переводы, долги, корректировки, другая основная валюта', () => {
    const noise: MonthTx[] = [
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, deletedAt: '2026-10-07T00:00:00.000Z' }),
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, baseAmountMinor: 0, kind: 'transfer', toWalletId: 'w2', categoryId: null }),
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, debtId: 'd1' }),
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, fxSource: 'adjust' }),
      tx({ occurredOn: '2026-10-06', amountMinor: 70_000, baseCurrency: 'USD' }),
    ];
    const r = monthRecap([...noise, tx({ occurredOn: '2026-10-08', amountMinor: 1_000, note: 'кофе' })], TODAY, BASE)!;
    expect(r.expenseMinor).toBe(1_000);
    expect(r.biggest?.note).toBe('кофе');
  });

  it('при равных суммах самая крупная — с меньшим id (одинаково на всех устройствах)', () => {
    const r = monthRecap([tx({ id: 'b', occurredOn: '2026-10-06', amountMinor: 500, note: 'б' }), tx({ id: 'a', occurredOn: '2026-10-07', amountMinor: 500, note: 'а' })], TODAY, BASE)!;
    expect(r.biggest?.id).toBe('a');
  });

  it('«Без категории» может быть главной статьёй; комиссия перевода — нет, хотя входит в расходы', () => {
    const r = monthRecap(
      [tx({ occurredOn: '2026-10-06', amountMinor: 9_000, categoryId: null }), tx({ occurredOn: '2026-10-07', amountMinor: 100, categoryId: 'food' }), tx({ occurredOn: '2026-10-08', amountMinor: 12_000, kind: 'transfer', toWalletId: 'w2', categoryId: null, baseAmountMinor: 12_000 })],
      TODAY,
      BASE,
    )!;
    expect(r.expenseMinor).toBe(21_100); // 90 + 1 + комиссия перевода 120
    expect(r.top).toEqual({ categoryId: null, totalMinor: 9_000, sharePercent: 42 });
  });

  it('доходы меньше расходов — остаток отрицательный', () => {
    const r = monthRecap([tx({ occurredOn: '2026-10-06', amountMinor: 9_000 }), tx({ occurredOn: '2026-10-07', amountMinor: 4_000, kind: 'income', categoryId: 'salary' })], TODAY, BASE)!;
    expect(r.netMinor).toBe(-5_000);
  });
});
