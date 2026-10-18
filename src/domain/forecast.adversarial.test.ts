import { describe, expect, it } from 'vitest';
import {
  computeDailyForecast,
  occurrenceKey,
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

  it('расход с копилки и доход в копилку вместе: деньги на руках и горизонт не меняются', () => {
    const f = calc({
      ...twoWallets,
      rules: [
        rule('from-box', { kind: 'expense', walletId: 'box', amountMinor: 40_000, startOn: '2026-10-24' }),
        rule('interest', { kind: 'income', walletId: 'box', amountMinor: 5_000, startOn: '2026-10-23' }),
      ],
    });
    expect(f).toMatchObject({ incomeDate: null, daysLeft: 10, paymentsMinor: 0, paymentsCount: 0, perDayMinor: 10_000, approximate: false });
  });
});

describe('атака: регулярный перевод из тратимых денег в копилку — деньги на руках уменьшатся', () => {
  const wallets = [wallet('cash'), wallet('card', { kind: 'card' }), wallet('box', { kind: 'savings' }), wallet('usd', { currency: 'USD' })];
  const balances = new Map([['cash', 100_000], ['card', 0], ['box', 900_000], ['usd', 0]]);
  const transfer = (id: string, over: Partial<ForecastRule> = {}) =>
    rule(id, { kind: 'transfer', walletId: 'cash', toWalletId: 'box', amountMinor: 40_000, startOn: '2026-10-25', ...over });

  it('вычитается как платёж: (1 000 − 400) ÷ 10 дней = 60 в день', () => {
    const f = calc({ wallets, balances, rules: [transfer('save')] });
    expect(f.paymentsMinor).toBe(40_000);
    expect(f.paymentsCount).toBe(1);
    expect(f.perDayMinor).toBe(6_000);
    expect(f.approximate).toBe(false);
  });

  it('повторяющийся перевод: каждая дата внутри горизонта', () => {
    const f = calc({ wallets, balances, rules: [transfer('weekly', { frequency: 'weekly', startOn: '2026-10-22', amountMinor: 10_000 })] });
    // 22 и 29 октября
    expect(f.paymentsCount).toBe(2);
    expect(f.paymentsMinor).toBe(20_000);
  });

  it('уже проведённый или пропущенный перевод второй раз не вычитается', () => {
    const f = calc({ wallets, balances, rules: [transfer('save')], doneOccurrences: new Set([occurrenceKey('save', '2026-10-25')]) });
    expect(f.paymentsMinor).toBe(0);
    expect(f.paymentsCount).toBe(0);
  });

  it('перевод между обычными кошельками (наличные → карта) деньги на руках не уменьшает', () => {
    const f = calc({ wallets, balances, rules: [transfer('move', { toWalletId: 'card' })] });
    expect(f.paymentsMinor).toBe(0);
    expect(f.perDayMinor).toBe(10_000);
  });

  it('перевод ИЗ копилки на руки в расчёт не входит (ни как платёж, ни как доход)', () => {
    const f = calc({ wallets, balances, rules: [transfer('take', { walletId: 'box', toWalletId: 'cash' })] });
    expect(f.paymentsMinor).toBe(0);
    expect(f.incomeDate).toBeNull();
    expect(f.perDayMinor).toBe(10_000);
  });

  it('перевод с долларового кошелька в копилку: сумма в долларах, пересчёт по курсу, число приблизительное', () => {
    const f = calc({
      wallets,
      balances,
      rules: [transfer('usd-save', { walletId: 'usd', amountMinor: 1_000 })],
      getRate: (from, to) => (from === to ? 1 : from === 'USD' && to === 'TJS' ? 10.9 : null),
    });
    expect(f.paymentsMinor).toBe(10_900);
    expect(f.approximate).toBe(true);
  });

  it('перевод после конца горизонта (раньше придёт крупный доход) не вычитается', () => {
    const f = calc({
      wallets,
      balances,
      rules: [transfer('late', { startOn: '2026-10-28' }), rule('salary', { kind: 'income', amountMinor: 1_000_000, startOn: '2026-10-25' })],
    });
    expect(f.horizonEnd).toBe('2026-10-24');
    expect(f.paymentsMinor).toBe(0);
  });

  it('архивный и удалённый перевод не вычитаются', () => {
    const f = calc({
      wallets,
      balances,
      rules: [transfer('a', { archivedAt: '2026-10-01T00:00:00.000Z' }), transfer('d', { deletedAt: '2026-10-01T00:00:00.000Z' })],
    });
    expect(f.paymentsMinor).toBe(0);
  });

  it('получатель не найден: платёж не вычитается, но об этом сказано; перевод без получателя ничего не вычитает', () => {
    const lost = calc({ wallets, balances, rules: [transfer('ghost', { toWalletId: 'нет-такого' })] });
    expect(lost.unknownWalletPayments).toBe(1);
    expect(lost.paymentsMinor).toBe(0);
    expect(lost.approximate).toBe(true);
    const none = calc({ wallets, balances, rules: [transfer('none', { toWalletId: null })] });
    expect(none.unknownWalletPayments).toBe(0);
    expect(none.paymentsMinor).toBe(0);
  });

  it('перевод в копилку больше денег на руках: нехватка названа точно', () => {
    const f = calc({ wallets, balances, rules: [transfer('big', { amountMinor: 130_000 })] });
    expect(f.notEnough).toBe(true);
    expect(f.shortfallMinor).toBe(30_000);
    expect(f.perDayMinor).toBe(0);
  });

  it('перевод на копилку в последний день месяца: сегодня 31-е, платёж сегодня же — остаток делим на неделю', () => {
    const f = calc({ today: '2026-10-31', wallets, balances, rules: [transfer('last', { startOn: '2026-10-31' })] });
    expect(f.daysLeft).toBe(7);
    expect(f.paymentsMinor).toBe(40_000); // следующий — 30 ноября, за горизонтом
    expect(f.perDayMinor).toBe(8_571);
  });
});

describe('держится: границы календаря', () => {
  it('конец февраля: неделя считается через 29-е в високосный год и без него в обычный', () => {
    expect(calc({ today: '2028-02-28' })).toMatchObject({ horizonEnd: '2028-03-05', daysLeft: 7 });
    expect(calc({ today: '2028-02-29' })).toMatchObject({ horizonEnd: '2028-03-06', daysLeft: 7 });
    expect(calc({ today: '2027-02-28' })).toMatchObject({ horizonEnd: '2027-03-06', daysLeft: 7 });
  });

  it('31 декабря и конец года: неделя уходит в январь, платёж 1 января вычитается', () => {
    const f = calc({ today: '2026-12-31', rules: [rule('r', { startOn: '2027-01-01' })] });
    expect(f.daysLeft).toBe(7);
    expect(f.horizonEnd).toBe('2027-01-06');
    expect(f.paymentsMinor).toBe(10_000);
    expect(f.perDayMinor).toBe(12_857); // (1 000 − 100) ÷ 7
  });

  it('ежемесячное правило с 31-м числом в 30-дневном месяце срабатывает 30-го (вычитается)', () => {
    const f = calc({ today: '2026-11-20', rules: [rule('r', { startOn: '2026-01-31', amountMinor: 20_000 })] });
    expect(f.paymentsMinor).toBe(20_000);
    expect(f.paymentsCount).toBe(1);
  });

  it('сегодня — последний день месяца, а платёж в тот же день: вычитается, остаток делим на неделю', () => {
    const f = calc({ today: '2026-10-31', rules: [rule('r', { startOn: '2026-10-31', amountMinor: 30_000 })] });
    expect(f.perDayMinor).toBe(10_000);
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
