import { describe, expect, it } from 'vitest';
import {
  computeDailyForecast,
  daysBetween,
  endOfMonth,
  floorDiv,
  occurrenceKey,
  type DailyForecast,
  type DailyForecastOk,
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

describe('floorDiv, daysBetween, endOfMonth', () => {
  it('округление вниз, в том числе для отрицательных', () => {
    expect(floorDiv(10, 3)).toBe(3);
    expect(floorDiv(9, 3)).toBe(3);
    expect(floorDiv(0, 5)).toBe(0);
    expect(floorDiv(1, 31)).toBe(0);
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(floorDiv(-8, 2)).toBe(-4);
  });

  it('точно на границе безопасных целых (без потери точности)', () => {
    const max = Number.MAX_SAFE_INTEGER;
    for (const b of [1, 2, 3, 7, 28, 29, 30, 31]) {
      expect(BigInt(floorDiv(max, b))).toBe(BigInt(max) / BigInt(b));
    }
    expect(floorDiv(max, 1)).toBe(max);
  });

  it('некорректные входы — RangeError, а не NaN', () => {
    expect(() => floorDiv(10, 0)).toThrow(RangeError);
    expect(() => floorDiv(10, -1)).toThrow(RangeError);
    expect(() => floorDiv(1.5, 2)).toThrow(RangeError);
    expect(() => floorDiv(10, 2.5)).toThrow(RangeError);
  });

  it('daysBetween: через конец месяца, года и високосный день', () => {
    expect(daysBetween('2026-10-22', '2026-10-31')).toBe(9);
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // 29 февраля есть
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2026-10-22', '2026-10-22')).toBe(0);
    expect(daysBetween('2026-10-22', '2026-10-20')).toBe(-2);
  });

  it('endOfMonth: 28/29/30/31 дней', () => {
    expect(endOfMonth('2026-10-05')).toBe('2026-10-31');
    expect(endOfMonth('2026-11-30')).toBe('2026-11-30');
    expect(endOfMonth('2027-02-01')).toBe('2027-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-12-15')).toBe('2026-12-31');
    expect(endOfMonth('2000-02-01')).toBe('2000-02-29'); // 2000 — високосный (делится на 400)
  });
});

describe('computeDailyForecast: основа', () => {
  it('нет кошельков → признак no-wallets (не бросает и не считает нули)', () => {
    expect(computeDailyForecast(input({ wallets: [], balances: new Map() }))).toEqual({ status: 'no-wallets' });
  });

  it('все кошельки в архиве — тоже «нет кошельков»', () => {
    expect(computeDailyForecast(input({ wallets: [wallet('cash', { archivedAt: '2026-01-01T00:00:00.000Z' })] }))).toEqual({
      status: 'no-wallets',
    });
  });

  it('только накопления → only-savings: тратить нечего, это не «0 в день»', () => {
    const r = computeDailyForecast(input({ wallets: [wallet('s', { kind: 'savings' })], balances: new Map([['s', 500_000]]) }));
    expect(r).toEqual({ status: 'only-savings' });
  });

  it('некорректная «сегодня» → bad-date', () => {
    for (const today of ['2026-02-30', '', '1999-12-31', '2026-10-22T10:00', 'сегодня']) {
      expect(computeDailyForecast(input({ today })).status).toBe('bad-date');
    }
  });

  it('обычный случай: 1000 с. на 10 дней = 100 с. в день', () => {
    const r = calc();
    expect(r).toMatchObject({
      today: TODAY,
      monthEnd: '2026-10-31',
      horizonEnd: '2026-10-31',
      incomeDate: null,
      daysLeft: 10,
      moneyMinor: 100_000,
      obligationsMinor: 0,
      availableMinor: 100_000,
      perDayMinor: 10_000,
      notEnough: false,
      shortfallMinor: 0,
      approximate: false,
      skipped: [],
    });
  });

  it('накопления, архивные кошельки и чужие кошельки без остатка в «деньги на руках» не входят', () => {
    const r = calc({
      wallets: [
        wallet('cash'),
        wallet('card', { kind: 'card' }),
        wallet('bank', { kind: 'bank' }),
        wallet('other', { kind: 'other' }),
        wallet('save', { kind: 'savings' }),
        wallet('old', { archivedAt: '2026-01-01T00:00:00.000Z' }),
      ],
      balances: new Map([
        ['cash', 1_000],
        ['card', 2_000],
        ['bank', 3_000],
        ['other', 4_000],
        ['save', 1_000_000],
        ['old', 500_000],
      ]),
    });
    expect(r.moneyMinor).toBe(10_000);
  });

  it('округление вниз: 10,00 с. на 3 дня = 3,33 с., а не 3,34 (никогда не обещаем больше, чем есть)', () => {
    const r = calc({ today: '2026-10-29', balances: new Map([['cash', 1_000]]) });
    expect(r.daysLeft).toBe(3);
    expect(r.perDayMinor).toBe(333);
    expect(r.perDayMinor * r.daysLeft).toBeLessThanOrEqual(r.availableMinor);
  });

  it('денег меньше, чем дней: 0 в день, но денег не «не хватает»', () => {
    const r = calc({ balances: new Map([['cash', 9]]) });
    expect(r.perDayMinor).toBe(0);
    expect(r.notEnough).toBe(false);
    expect(r.shortfallMinor).toBe(0);
  });

  it('ровно ноль денег: 0 в день, нехватки нет', () => {
    const r = calc({ balances: new Map([['cash', 0]]) });
    expect(r).toMatchObject({ perDayMinor: 0, notEnough: false, shortfallMinor: 0, todayLimitMinor: 0 });
  });
});

describe('computeDailyForecast: сколько дней осталось', () => {
  it('последний день месяца: один день — можно потратить всё', () => {
    const r = calc({ today: '2026-10-31' });
    expect(r.daysLeft).toBe(1);
    expect(r.horizonEnd).toBe('2026-10-31');
    expect(r.perDayMinor).toBe(100_000);
  });

  it('конец года: 31 декабря — 1 день, 30 декабря — 2 дня', () => {
    expect(calc({ today: '2026-12-31' }).daysLeft).toBe(1);
    expect(calc({ today: '2026-12-30' }).daysLeft).toBe(2);
  });

  it('високосный февраль: 29 дней в месяце', () => {
    const leap = calc({ today: '2028-02-20' });
    expect(leap.monthEnd).toBe('2028-02-29');
    expect(leap.daysLeft).toBe(10);
    expect(calc({ today: '2028-02-29' }).daysLeft).toBe(1);
    expect(calc({ today: '2028-02-01' }).daysLeft).toBe(29);
  });

  it('обычный февраль: 28 дней', () => {
    const r = calc({ today: '2027-02-20' });
    expect(r.monthEnd).toBe('2027-02-28');
    expect(r.daysLeft).toBe(9);
    expect(calc({ today: '2027-02-28' }).daysLeft).toBe(1);
  });

  it('31-е число и 30-дневный месяц', () => {
    expect(calc({ today: '2026-10-01' }).daysLeft).toBe(31);
    expect(calc({ today: '2026-11-01' }).daysLeft).toBe(30);
    expect(calc({ today: '2026-11-30' }).daysLeft).toBe(1);
  });
});

describe('computeDailyForecast: ожидаемый доход обрывает горизонт', () => {
  const income = (id: string, over: Partial<ForecastRule> = {}) => rule(id, { kind: 'income', ...over });

  it('доход завтра: горизонт — только сегодня, весь остаток на один день', () => {
    const r = calc({ rules: [income('salary', { startOn: '2026-10-23' })] });
    expect(r.incomeDate).toBe('2026-10-23');
    expect(r.horizonEnd).toBe('2026-10-22');
    expect(r.daysLeft).toBe(1);
    expect(r.perDayMinor).toBe(100_000);
  });

  it('доход 25-го: считаем до 24-го включительно (3 дня)', () => {
    const r = calc({ rules: [income('salary', { startOn: '2026-09-25' })] });
    expect(r.incomeDate).toBe('2026-10-25');
    expect(r.horizonEnd).toBe('2026-10-24');
    expect(r.daysLeft).toBe(3);
    expect(r.perDayMinor).toBe(33_333);
  });

  it('доход сегодня горизонт не обрывает (его ещё не провели — деньги в остатке не лежат)', () => {
    const r = calc({ rules: [income('salary', { startOn: '2026-10-22' })] });
    expect(r.incomeDate).toBeNull();
    expect(r.daysLeft).toBe(10);
  });

  it('доход уже проведён или пропущен — не считается; следующий уже в другом месяце', () => {
    const done = new Set([occurrenceKey('salary', '2026-10-25')]);
    const r = calc({ rules: [income('salary', { startOn: '2026-09-25' })], doneOccurrences: done });
    expect(r.incomeDate).toBeNull();
    expect(r.daysLeft).toBe(10);
  });

  it('еженедельный доход: сегодня (22-е) не считается, берётся 29-е → горизонт до 28-го (7 дней)', () => {
    const r = calc({ rules: [income('w', { frequency: 'weekly', startOn: '2026-10-01' })] });
    expect(r.incomeDate).toBe('2026-10-29');
    expect(r.daysLeft).toBe(7);
  });

  it('несколько доходов: берётся ближайший', () => {
    const r = calc({ rules: [income('a', { startOn: '2026-10-29' }), income('b', { startOn: '2026-10-24' }), income('c', { startOn: '2026-10-27' })] });
    expect(r.incomeDate).toBe('2026-10-24');
    expect(r.daysLeft).toBe(2);
  });

  it('доход в следующем месяце горизонт не трогает', () => {
    const r = calc({ rules: [income('a', { startOn: '2026-11-01' })] });
    expect(r.incomeDate).toBeNull();
    expect(r.daysLeft).toBe(10);
  });

  it('архивный, удалённый доход и не-доходы горизонт не трогают', () => {
    const r = calc({
      rules: [
        income('arch', { startOn: '2026-10-23', archivedAt: '2026-10-01T00:00:00.000Z' }),
        income('del', { startOn: '2026-10-23', deletedAt: '2026-10-01T00:00:00.000Z' }),
        rule('exp', { kind: 'expense', startOn: '2026-10-23' }),
        rule('tr', { kind: 'transfer', startOn: '2026-10-23' }),
      ],
    });
    expect(r.incomeDate).toBeNull();
    expect(r.daysLeft).toBe(10);
  });

  it('правило, закончившееся до сегодня, и правило, которое ещё не началось к концу месяца, не мешают', () => {
    const r = calc({ rules: [income('ended', { startOn: '2026-01-01', endOn: '2026-09-30' }), income('later', { startOn: '2026-12-01' })] });
    expect(r.incomeDate).toBeNull();
  });

  it('доход завтра в последний день месяца: горизонт — последний день', () => {
    // 30 октября; доход 31-го
    const r = calc({ today: '2026-10-30', rules: [income('a', { startOn: '2026-10-31' })] });
    expect(r.daysLeft).toBe(1);
    expect(r.horizonEnd).toBe('2026-10-30');
  });
});

describe('computeDailyForecast: обязательные платежи', () => {
  it('расходное правило до конца месяца вычитается', () => {
    const r = calc({ rules: [rule('rent', { amountMinor: 30_000, startOn: '2026-10-25' })] });
    expect(r).toMatchObject({ paymentsMinor: 30_000, paymentsCount: 1, obligationsMinor: 30_000, availableMinor: 70_000, perDayMinor: 7_000 });
  });

  it('платёж сегодня включён (день включительно), платёж вчера — нет', () => {
    expect(calc({ rules: [rule('a', { startOn: '2026-10-22' })] }).paymentsCount).toBe(1);
    expect(calc({ rules: [rule('a', { startOn: '2026-10-21' })] }).paymentsCount).toBe(0);
  });

  it('уже проведённый или пропущенный за дату платёж не вычитается (деньги уже списаны / платежа не будет)', () => {
    const done = new Set([occurrenceKey('rent', '2026-10-25')]);
    const r = calc({ rules: [rule('rent', { amountMinor: 30_000 })], doneOccurrences: done });
    expect(r.paymentsMinor).toBe(0);
    expect(r.perDayMinor).toBe(10_000);
  });

  it('проведён один платёж из серии: остальные считаются', () => {
    const r = calc({
      rules: [rule('daily', { frequency: 'daily', startOn: '2026-10-01', amountMinor: 1_000 })],
      doneOccurrences: new Set([occurrenceKey('daily', '2026-10-22'), occurrenceKey('daily', '2026-10-23')]),
    });
    expect(r.paymentsCount).toBe(8); // 24…31
    expect(r.paymentsMinor).toBe(8_000);
  });

  it('ежедневное правило: каждый день горизонта', () => {
    const r = calc({ rules: [rule('daily', { frequency: 'daily', startOn: '2026-10-01', amountMinor: 1_000 })] });
    expect(r.paymentsCount).toBe(10); // 22…31
    expect(r.paymentsMinor).toBe(10_000);
    expect(r.perDayMinor).toBe(9_000);
  });

  it('платёж после конца горизонта (доход раньше) не вычитается', () => {
    const r = calc({
      rules: [rule('rent', { startOn: '2026-10-28', amountMinor: 30_000 }), rule('salary', { kind: 'income', startOn: '2026-10-25' })],
    });
    expect(r.horizonEnd).toBe('2026-10-24');
    expect(r.paymentsMinor).toBe(0);
  });

  it('архивные, удалённые правила, доходы и переводы не вычитаются', () => {
    const r = calc({
      rules: [
        rule('arch', { archivedAt: '2026-10-01T00:00:00.000Z' }),
        rule('del', { deletedAt: '2026-10-01T00:00:00.000Z' }),
        rule('inc', { kind: 'income', startOn: '2026-11-01' }),
        rule('tr', { kind: 'transfer' }),
      ],
    });
    expect(r.paymentsMinor).toBe(0);
    expect(r.paymentsCount).toBe(0);
  });

  it('конец расписания и шаг учитываются (каждые 2 недели)', () => {
    const r = calc({ rules: [rule('biweekly', { frequency: 'weekly', intervalN: 2, startOn: '2026-10-01', amountMinor: 5_000 })] });
    // 1, 15, 29 октября → в окне 22…31 только 29-е
    expect(r.paymentsCount).toBe(1);
    const ended = calc({ rules: [rule('x', { startOn: '2026-10-25', endOn: '2026-10-24' })] });
    expect(ended.paymentsCount).toBe(0);
  });

  it('платёж в долларах пересчитывается по курсу и делает число приблизительным', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 100_000], ['usd', 0]]),
      rules: [rule('sub', { walletId: 'usd', amountMinor: 1_000, startOn: '2026-10-25' })], // 10 $
      getRate: rates({ 'USD>TJS': 10.9 }),
    });
    expect(r.paymentsMinor).toBe(10_900);
    expect(r.approximate).toBe(true);
    expect(r.skipped).toEqual([]);
  });

  it('платёж в валюте без курса не вычитается, и об этом сказано (skipped), число приблизительное', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 100_000], ['usd', 0]]),
      rules: [rule('sub', { walletId: 'usd', amountMinor: 1_000, startOn: '2026-10-25' })],
    });
    expect(r.paymentsMinor).toBe(0);
    expect(r.paymentsCount).toBe(0);
    expect(r.skipped).toEqual([{ source: 'payment', currency: 'USD', amountMinor: 1_000 }]);
    expect(r.approximate).toBe(true);
  });

  it('кошелёк правила не найден: платёж не вычитается, но число помечено приблизительным', () => {
    const r = calc({ rules: [rule('ghost', { walletId: 'нет-такого', startOn: '2026-10-25' })] });
    expect(r.unknownWalletPayments).toBe(1);
    expect(r.paymentsMinor).toBe(0);
    expect(r.approximate).toBe(true);
  });

  it('кошелёк правила в архиве: платёж всё равно ждёт (валюта известна)', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('old', { archivedAt: '2026-01-01T00:00:00.000Z' })],
      rules: [rule('r', { walletId: 'old', amountMinor: 4_000, startOn: '2026-10-25' })],
    });
    expect(r.paymentsMinor).toBe(4_000);
  });
});
