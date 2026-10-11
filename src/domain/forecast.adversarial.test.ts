import { describe, expect, it } from 'vitest';
import {
  computeDailyForecast,
  type DailyForecast,
  type DailyForecastOk,
  type ForecastInput,
  type ForecastRule,
  type ForecastWallet,
} from './forecast';

/** Атаки «ломателя» на чистый расчёт прогноза. «Сегодня» — четверг 22 октября 2026: до конца месяца 10 дней (22…31). */
const TODAY = '2026-10-22';

const wallet = (id: string, over: Partial<ForecastWallet> = {}): ForecastWallet => ({ id, currency: 'TJS', kind: 'cash', archivedAt: null, ...over });

const rule = (id: string, over: Partial<ForecastRule> = {}): ForecastRule => ({
  id,
  kind: 'expense',
  walletId: 'cash',
  amountMinor: 10_000,
  debtId: null,
  frequency: 'monthly',
  intervalN: 1,
  startOn: '2026-10-25',
  endOn: null,
  archivedAt: null,
  deletedAt: null,
  ...over,
});

const input = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  today: TODAY,
  base: 'TJS',
  wallets: [wallet('cash')],
  balances: new Map([['cash', 100_000]]),
  rules: [],
  doneOccurrences: new Set(),
  debts: [],
  getRate: (from, to) => (from === to ? 1 : null),
  spentTodayMinor: 0,
  usualPerDayMinor: null,
  totalBudget: null,
  ...over,
});

const ok = (r: DailyForecast): DailyForecastOk => {
  if (r.status !== 'ok') throw new Error(`ожидался status ok, получен ${r.status}`);
  return r;
};
const calc = (over: Partial<ForecastInput> = {}) => ok(computeDailyForecast(input(over)));

describe('атака: правила на кошельке-накоплении (его деньги прогноз не считает)', () => {
  const twoWallets = { wallets: [wallet('cash'), wallet('box', { kind: 'savings' })], balances: new Map([['cash', 100_000], ['box', 900_000]]) };

  it('регулярный доход В копилку не пополняет деньги на руках: горизонт до конца месяца, а не до «дня перед доходом»', () => {
    const f = calc({ ...twoWallets, rules: [rule('interest', { kind: 'income', walletId: 'box', amountMinor: 5_000, startOn: '2026-10-25' })] });
    expect(f.incomeDate).toBeNull();
    expect(f.horizonEnd).toBe('2026-10-31');
    expect(f.perDayMinor).toBe(10_000); // 100 000 ÷ 10 дней, а не ÷ 3
  });

  it('регулярный расход С копилки не уменьшает деньги на руках: вычитать его из них нельзя', () => {
    const f = calc({ ...twoWallets, rules: [rule('from-box', { kind: 'expense', walletId: 'box', amountMinor: 40_000, startOn: '2026-10-25' })] });
    expect(f.paymentsMinor).toBe(0);
    expect(f.perDayMinor).toBe(10_000);
  });
});

describe('держится: границы календаря', () => {
  it('29 февраля високосного года: 28 февраля — 2 дня, а 29-го — 1', () => {
    expect(calc({ today: '2028-02-28' }).daysLeft).toBe(2);
    expect(calc({ today: '2028-02-29' }).daysLeft).toBe(1);
    expect(calc({ today: '2027-02-28' }).daysLeft).toBe(1);
  });

  it('31 декабря и конец года: день считается один, следующий год не подмешивается', () => {
    const f = calc({ today: '2026-12-31', rules: [rule('r', { startOn: '2027-01-01' })] });
    expect(f.daysLeft).toBe(1);
    expect(f.horizonEnd).toBe('2026-12-31');
    expect(f.paymentsMinor).toBe(0);
  });

  it('ежемесячное правило с 31-м числом в 30-дневном месяце срабатывает 30-го (вычитается)', () => {
    const f = calc({ today: '2026-11-20', rules: [rule('r', { startOn: '2026-01-31', amountMinor: 20_000 })] });
    expect(f.paymentsMinor).toBe(20_000);
    expect(f.paymentsCount).toBe(1);
  });

  it('сегодня — последний день месяца, а платёж в тот же день: вычитается, делить не на что — на 1 день', () => {
    const f = calc({ today: '2026-10-31', rules: [rule('r', { startOn: '2026-10-31', amountMinor: 30_000 })] });
    expect(f.perDayMinor).toBe(70_000);
  });
});

describe('держится: курсы и суммы', () => {
  it('курс 0, NaN, Infinity, отрицательный — это «курса нет», а не нулевые деньги', () => {
    for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const f = calc({
        wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
        balances: new Map([['cash', 100_000], ['usd', 5_000]]),
        getRate: (from, to) => (from === to ? 1 : bad),
      });
      expect(f.skipped).toEqual([{ source: 'money', currency: 'USD', amountMinor: 5_000 }]);
      expect(f.approximate).toBe(true);
      expect(f.moneyMinor).toBe(100_000);
    }
  });

  it('огромный курс даёт признак переполнения, а не бесконечность и не исключение', () => {
    const r = computeDailyForecast(
      input({
        wallets: [wallet('usd', { currency: 'USD' })],
        balances: new Map([['usd', 900_000_000_000_000]]),
        getRate: (from, to) => (from === to ? 1 : 1e6),
      }),
    );
    expect(r.status).toBe('overflow');
  });

  it('деньги не округляются вверх: 1 дирам на 10 дней — 0 в день, а не 1', () => {
    const f = calc({ balances: new Map([['cash', 9]]) });
    expect(f.perDayMinor).toBe(0);
    expect(f.notEnough).toBe(false);
  });

  it('отрицательные деньги: 0 в день, нехватка названа точно', () => {
    const f = calc({ balances: new Map([['cash', -12_345]]) });
    expect(f.perDayMinor).toBe(0);
    expect(f.shortfallMinor).toBe(12_345);
    expect(f.notEnough).toBe(true);
  });
});
