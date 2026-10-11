import { afterEach, describe, expect, it } from 'vitest';
import {
  computeDailyForecast,
  usualSpendWindow,
  type DailyForecast,
  type DailyForecastOk,
  type ForecastDebt,
  type ForecastInput,
  type ForecastRule,
  type ForecastWallet,
} from './forecast';

/** Все примеры — четверг 22 октября 2026: до конца месяца 10 дней (22…31). */
const TODAY = '2026-10-22';

const wallet = (id: string, over: Partial<ForecastWallet> = {}): ForecastWallet => ({
  id,
  currency: 'TJS',
  kind: 'cash',
  archivedAt: null,
  ...over,
});

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

const debt = (id: string, over: Partial<ForecastDebt> = {}): ForecastDebt => ({
  id,
  direction: 'borrowed',
  currency: 'TJS',
  dueOn: '2026-10-28',
  remainingMinor: 20_000,
  closedAt: null,
  archivedAt: null,
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

const rates = (table: Record<string, number>) => (from: string, to: string) => (from === to ? 1 : (table[`${from}>${to}`] ?? null));

describe('computeDailyForecast: долги', () => {
  it('«я должен» со сроком внутри горизонта: остаток вычитается', () => {
    const r = calc({ debts: [debt('d1', { dueOn: '2026-10-28', remainingMinor: 20_000 })] });
    expect(r).toMatchObject({ debtsMinor: 20_000, debtsCount: 1, availableMinor: 80_000, perDayMinor: 8_000 });
  });

  it('срок ровно в последний день горизонта и сегодня — включён; на день позже — нет', () => {
    expect(calc({ debts: [debt('d', { dueOn: '2026-10-31' })] }).debtsCount).toBe(1);
    expect(calc({ debts: [debt('d', { dueOn: '2026-10-22' })] }).debtsCount).toBe(1);
    expect(calc({ debts: [debt('d', { dueOn: '2026-11-01' })] }).debtsCount).toBe(0);
  });

  it('просроченный долг (срок в прошлом, не закрыт) тоже вычитается: он уже должен быть отдан', () => {
    const r = calc({ debts: [debt('d', { dueOn: '2026-09-01', remainingMinor: 5_000 })] });
    expect(r.debtsMinor).toBe(5_000);
  });

  it('долг без срока, «мне должны», закрытый, в архиве и с нулевым остатком не вычитаются', () => {
    const r = calc({
      debts: [
        debt('nodue', { dueOn: null }),
        debt('lent', { direction: 'lent' }),
        debt('closed', { closedAt: '2026-10-01T00:00:00.000Z' }),
        debt('arch', { archivedAt: '2026-10-01T00:00:00.000Z' }),
        debt('zero', { remainingMinor: 0 }),
      ],
    });
    expect(r.debtsMinor).toBe(0);
    expect(r.debtsCount).toBe(0);
  });

  it('срок долга после дохода (горизонт короче) — не вычитается', () => {
    const r = calc({
      rules: [rule('salary', { kind: 'income', startOn: '2026-10-25' })],
      debts: [debt('d', { dueOn: '2026-10-28' })],
    });
    expect(r.debtsMinor).toBe(0);
  });

  it('долг в валюте без курса: не вычитается, сказано (skipped), число приблизительное', () => {
    const r = calc({ debts: [debt('d', { currency: 'USD', remainingMinor: 3_000 })] });
    expect(r.debtsMinor).toBe(0);
    expect(r.debtsCount).toBe(0);
    expect(r.skipped).toEqual([{ source: 'debt', currency: 'USD', amountMinor: 3_000 }]);
    expect(r.approximate).toBe(true);
  });

  it('регулярный платёж по долгу, который уже учтён остатком, второй раз не вычитается', () => {
    const r = calc({
      debts: [debt('d', { dueOn: '2026-10-30', remainingMinor: 20_000 })],
      rules: [rule('pay', { debtId: 'd', amountMinor: 10_000, startOn: '2026-10-25' })],
    });
    expect(r.debtsMinor).toBe(20_000);
    expect(r.paymentsMinor).toBe(0);
    expect(r.obligationsMinor).toBe(20_000);
  });

  it('платёж по долгу, срок которого не в горизонте, — обычный платёж и вычитается', () => {
    const r = calc({
      debts: [debt('d', { dueOn: '2026-12-30' })],
      rules: [rule('pay', { debtId: 'd', amountMinor: 10_000, startOn: '2026-10-25' })],
    });
    expect(r.debtsMinor).toBe(0);
    expect(r.paymentsMinor).toBe(10_000);
  });

  it('платёж и долг вместе: нехватка денег', () => {
    const r = calc({
      balances: new Map([['cash', 25_000]]),
      debts: [debt('d', { remainingMinor: 20_000 })],
      rules: [rule('rent', { amountMinor: 30_000, startOn: '2026-10-25' })],
    });
    expect(r).toMatchObject({ obligationsMinor: 50_000, availableMinor: -25_000, notEnough: true, shortfallMinor: 25_000, perDayMinor: 0 });
  });
});

describe('computeDailyForecast: остатки и валюты', () => {
  it('отрицательный остаток уменьшает деньги на руках; общий минус — нехватка и 0 в день', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('card', { kind: 'card' })],
      balances: new Map([['cash', 10_000], ['card', -30_000]]),
    });
    expect(r).toMatchObject({ moneyMinor: -20_000, availableMinor: -20_000, perDayMinor: 0, notEnough: true, shortfallMinor: 20_000, todayLimitMinor: 0 });
  });

  it('доллары пересчитываются по курсу; число приблизительное', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 100_000], ['usd', 10_000]]), // 100 $
      getRate: rates({ 'USD>TJS': 10.9 }),
    });
    expect(r.moneyMinor).toBe(100_000 + 109_000);
    expect(r.approximate).toBe(true);
    expect(r.skipped).toEqual([]);
  });

  it('валюта без курса: кошелёк в расчёт НЕ входит, это указано, число приблизительное', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 100_000], ['usd', 10_000]]),
    });
    expect(r.moneyMinor).toBe(100_000);
    expect(r.skipped).toEqual([{ source: 'money', currency: 'USD', amountMinor: 10_000 }]);
    expect(r.approximate).toBe(true);
    expect(r.perDayMinor).toBe(10_000);
  });

  it('пустой кошелёк в валюте без курса ничего не добавляет и не тревожит', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 100_000], ['usd', 0]]),
    });
    expect(r.skipped).toEqual([]);
    expect(r.approximate).toBe(false);
  });

  it('курс 0, отрицательный, NaN, Infinity — это «курса нет»', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = calc({
        wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
        balances: new Map([['cash', 100_000], ['usd', 10_000]]),
        getRate: (from, to) => (from === to ? 1 : bad),
      });
      expect(r.skipped).toHaveLength(1);
      expect(r.moneyMinor).toBe(100_000);
    }
  });

  it('две валюты: каждая сумма пересчитывается один раз', () => {
    const r = calc({
      wallets: [wallet('u1', { currency: 'USD' }), wallet('u2', { currency: 'USD' }), wallet('e', { currency: 'EUR' })],
      balances: new Map([['u1', 333], ['u2', 333], ['e', 1_000]]),
      getRate: rates({ 'USD>TJS': 10.9, 'EUR>TJS': 12 }),
    });
    // 666 центов = 6,66 $ → 72,594 → 7259 дирам; 10 € → 120 с.
    expect(r.moneyMinor).toBe(7_259 + 12_000);
  });
});

describe('computeDailyForecast: сегодня и «обычно»', () => {
  it('«на сегодня можно» считается с утра: потраченное сегодня возвращается в расчёт', () => {
    // утром было 100 000 на 10 дней (10 000 в день); потратили 9 000 → осталось 91 000
    const r = calc({ balances: new Map([['cash', 91_000]]), spentTodayMinor: 9_000 });
    expect(r.perDayMinor).toBe(9_100);
    expect(r.todayLimitMinor).toBe(10_000);
    expect(r.spentTodayMinor).toBeLessThanOrEqual(r.todayLimitMinor);
  });

  it('потратили больше, чем можно на день: потрачено > todayLimit', () => {
    const r = calc({ balances: new Map([['cash', 80_000]]), spentTodayMinor: 12_000 }); // с утра было 92 000 → 9 200 в день
    expect(r.todayLimitMinor).toBe(9_200);
    expect(r.spentTodayMinor).toBeGreaterThan(r.todayLimitMinor);
  });

  it('«обычно вы тратите» передаётся как есть (в том числе null — истории нет)', () => {
    expect(calc({ usualPerDayMinor: 4_321 }).usualPerDayMinor).toBe(4_321);
    expect(calc({ usualPerDayMinor: null }).usualPerDayMinor).toBeNull();
  });
});

describe('computeDailyForecast: «по бюджету»', () => {
  const budget = (over: Partial<NonNullable<ForecastInput['totalBudget']>> = {}) => ({
    limitMinor: 200_000,
    currency: 'TJS',
    spentMonthMinor: 50_000,
    excludedCount: 0,
    ...over,
  });

  it('(лимит − потрачено) / дней до конца МЕСЯЦА, вниз', () => {
    const r = calc({ totalBudget: budget() });
    expect(r.budget).toEqual({
      limitMinor: 200_000,
      spentMinor: 50_000,
      leftMinor: 150_000,
      overMinor: 0,
      daysLeft: 10,
      perDayMinor: 15_000,
      partial: false,
    });
  });

  it('горизонт по доходу бюджет не сокращает: он всегда до конца месяца', () => {
    const r = calc({ totalBudget: budget(), rules: [rule('salary', { kind: 'income', startOn: '2026-10-23' })] });
    expect(r.daysLeft).toBe(1);
    expect(r.budget?.daysLeft).toBe(10);
  });

  it('лимит превышен: 0 в день, превышение показано', () => {
    const r = calc({ totalBudget: budget({ spentMonthMinor: 250_000 }) });
    expect(r.budget).toMatchObject({ leftMinor: 0, overMinor: 50_000, perDayMinor: 0 });
  });

  it('ровно лимит потрачен: остаток 0, превышения нет', () => {
    const r = calc({ totalBudget: budget({ spentMonthMinor: 200_000 }) });
    expect(r.budget).toMatchObject({ leftMinor: 0, overMinor: 0, perDayMinor: 0 });
  });

  it('округление вниз: 100,00 на 3 дня = 33,33', () => {
    const r = calc({ today: '2026-10-29', totalBudget: budget({ limitMinor: 10_000, spentMonthMinor: 0 }) });
    expect(r.budget?.perDayMinor).toBe(3_333);
  });

  it('часть операций не учтена (другая прежняя валюта): цифра помечена partial', () => {
    expect(calc({ totalBudget: budget({ excludedCount: 2 }) }).budget?.partial).toBe(true);
  });

  it('лимит в прежней валюте или без лимита — части «по бюджету» нет', () => {
    expect(calc({ totalBudget: budget({ currency: 'USD' }) }).budget).toBeNull();
    expect(calc({ totalBudget: null }).budget).toBeNull();
  });
});

describe('computeDailyForecast: переполнение и устойчивость', () => {
  it('сумма остатков не помещается в безопасное целое → status overflow (не исключение)', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const r = computeDailyForecast(
      input({ wallets: [wallet('a'), wallet('b')], balances: new Map([['a', max], ['b', max]]) }),
    );
    expect(r).toEqual({ status: 'overflow' });
  });

  it('пересчёт валюты вышел за предел → overflow', () => {
    const r = computeDailyForecast(
      input({
        wallets: [wallet('usd', { currency: 'USD' })],
        balances: new Map([['usd', Number.MAX_SAFE_INTEGER]]),
        getRate: rates({ 'USD>TJS': 1e6 }),
      }),
    );
    expect(r).toEqual({ status: 'overflow' });
  });

  it('обязательные платежи не помещаются → overflow', () => {
    const r = computeDailyForecast(
      input({
        rules: [
          rule('a', { amountMinor: Number.MAX_SAFE_INTEGER, startOn: '2026-10-25' }),
          rule('b', { amountMinor: Number.MAX_SAFE_INTEGER, startOn: '2026-10-26' }),
        ],
      }),
    );
    expect(r).toEqual({ status: 'overflow' });
  });

  it('деньги минус обязательное выходит за предел → overflow', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const r = computeDailyForecast(
      input({
        balances: new Map([['cash', -max]]),
        debts: [debt('d', { remainingMinor: max })],
      }),
    );
    expect(r).toEqual({ status: 'overflow' });
  });

  it('большие, но допустимые суммы считаются точно', () => {
    const big = 9_000_000_000_000_000; // < MAX_SAFE_INTEGER
    const r = calc({ today: '2026-10-29', balances: new Map([['cash', big]]) }); // 3 дня
    expect(BigInt(r.perDayMinor)).toBe(BigInt(big) / 3n);
  });

  it('входные данные не меняются', () => {
    const wallets = [wallet('cash')];
    const balances = new Map([['cash', 100_000]]);
    const rules = [rule('r')];
    const done = new Set<string>();
    computeDailyForecast(input({ wallets, balances, rules, doneOccurrences: done }));
    expect(wallets).toEqual([wallet('cash')]);
    expect([...balances]).toEqual([['cash', 100_000]]);
    expect(rules).toEqual([rule('r')]);
    expect(done.size).toBe(0);
  });
});

describe('часовой пояс не влияет на расчёт', () => {
  const original = process.env['TZ'];
  afterEach(() => {
    if (original === undefined) delete process.env['TZ'];
    else process.env['TZ'] = original;
  });

  it('одинаковый результат в UTC−11, UTC и UTC+14 на стыке месяцев и в високосный день', () => {
    const cases = ['2026-10-31', '2028-02-29', '2028-02-28', '2026-12-31', '2026-03-29'];
    const run = () =>
      cases.map((today) =>
        computeDailyForecast(
          input({
            today,
            rules: [rule('daily', { frequency: 'daily', startOn: '2026-01-01', amountMinor: 100 }), rule('pay', { kind: 'income', startOn: '2026-01-31' })],
          }),
        ),
      );
    const results = ['Pacific/Pago_Pago', 'UTC', 'Pacific/Kiritimati', 'Europe/Moscow'].map((tz) => {
      process.env['TZ'] = tz;
      return JSON.stringify(run());
    });
    expect(new Set(results).size).toBe(1);
  });
});

describe('usualSpendWindow', () => {
  it('нет истории (нет операций или первая — сегодня или в будущем) → null', () => {
    expect(usualSpendWindow(null, TODAY)).toBeNull();
    expect(usualSpendWindow(TODAY, TODAY)).toBeNull();
    expect(usualSpendWindow('2026-10-25', TODAY)).toBeNull();
    expect(usualSpendWindow('2026-02-30', TODAY)).toBeNull();
  });

  it('первая операция вчера → окно из одного дня', () => {
    expect(usualSpendWindow('2026-10-21', TODAY)).toEqual({ from: '2026-10-21', to: '2026-10-21', days: 1 });
  });

  it('новый пользователь: делим на дни с первой операции, а не на 30', () => {
    expect(usualSpendWindow('2026-10-17', TODAY)).toEqual({ from: '2026-10-17', to: '2026-10-21', days: 5 });
  });

  it('старая история: ровно последние 30 дней до вчера', () => {
    expect(usualSpendWindow('2020-01-01', TODAY)).toEqual({ from: '2026-09-22', to: '2026-10-21', days: 30 });
    expect(usualSpendWindow('2026-09-22', TODAY)).toEqual({ from: '2026-09-22', to: '2026-10-21', days: 30 });
    expect(usualSpendWindow('2026-09-21', TODAY)).toEqual({ from: '2026-09-22', to: '2026-10-21', days: 30 });
  });

  it('через високосный день', () => {
    expect(usualSpendWindow('2020-01-01', '2028-03-01')).toEqual({ from: '2028-01-31', to: '2028-02-29', days: 30 });
  });

  it('другое окно', () => {
    expect(usualSpendWindow('2020-01-01', TODAY, 7)).toEqual({ from: '2026-10-15', to: '2026-10-21', days: 7 });
  });
});
