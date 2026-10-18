import fc from 'fast-check';
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
const addDaysIso = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
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

  it('округление вниз: 10,00 с. на 7 дней = 1,42 с., а не 1,43 (никогда не обещаем больше, чем есть)', () => {
    const r = calc({ today: '2026-10-29', balances: new Map([['cash', 1_000]]) });
    expect(r.daysLeft).toBe(7);
    expect(r.perDayMinor).toBe(142);
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
  it('последний день месяца: не «тратьте всё сегодня», а не меньше недели', () => {
    const r = calc({ today: '2026-10-31' });
    expect(r.daysLeft).toBe(7);
    expect(r.horizonEnd).toBe('2026-11-06');
    expect(r.monthEnd).toBe('2026-10-31');
    expect(r.perDayMinor).toBe(14_285);
  });

  it('неделя — минимум: 24-го до 31-го (8 дней), 25-го — 7, 26-го — уже до 1 ноября', () => {
    expect(calc({ today: '2026-10-24' })).toMatchObject({ horizonEnd: '2026-10-31', daysLeft: 8 });
    expect(calc({ today: '2026-10-25' })).toMatchObject({ horizonEnd: '2026-10-31', daysLeft: 7 });
    expect(calc({ today: '2026-10-26' })).toMatchObject({ horizonEnd: '2026-11-01', daysLeft: 7 });
  });

  it('конец года: 31 декабря — до 6 января, 30 декабря — до 5-го', () => {
    expect(calc({ today: '2026-12-31' })).toMatchObject({ horizonEnd: '2027-01-06', daysLeft: 7 });
    expect(calc({ today: '2026-12-30' })).toMatchObject({ horizonEnd: '2027-01-05', daysLeft: 7 });
  });

  it('високосный февраль: 29 дней в месяце', () => {
    const leap = calc({ today: '2028-02-20' });
    expect(leap.monthEnd).toBe('2028-02-29');
    expect(leap.daysLeft).toBe(10);
    expect(calc({ today: '2028-02-29' })).toMatchObject({ horizonEnd: '2028-03-06', daysLeft: 7 });
    expect(calc({ today: '2028-02-24' })).toMatchObject({ horizonEnd: '2028-03-01', daysLeft: 7 }); // через 29-е
    expect(calc({ today: '2028-02-01' }).daysLeft).toBe(29);
  });

  it('обычный февраль: 28 дней', () => {
    const r = calc({ today: '2027-02-20' });
    expect(r.monthEnd).toBe('2027-02-28');
    expect(r.daysLeft).toBe(9);
    expect(calc({ today: '2027-02-28' })).toMatchObject({ horizonEnd: '2027-03-06', daysLeft: 7 });
  });

  it('31-е число и 30-дневный месяц', () => {
    expect(calc({ today: '2026-10-01' }).daysLeft).toBe(31);
    expect(calc({ today: '2026-11-01' }).daysLeft).toBe(30);
    expect(calc({ today: '2026-11-30' })).toMatchObject({ horizonEnd: '2026-12-06', daysLeft: 7 });
  });

  it('аренда 1-го, сегодня 31-е, дохода нет: вычитается (раньше горизонт обрывался концом месяца)', () => {
    const r = calc({ today: '2026-10-31', rules: [rule('rent', { amountMinor: 30_000, startOn: '2026-11-01' })] });
    expect(r).toMatchObject({ paymentsMinor: 30_000, paymentsCount: 1, availableMinor: 70_000, perDayMinor: 10_000 });
  });
});

describe('computeDailyForecast: ожидаемый доход обрывает горизонт', () => {
  /** Крупная зарплата: с ней денег на день после дохода точно больше, горизонт — день перед ней. */
  const income = (id: string, over: Partial<ForecastRule> = {}) => rule(id, { kind: 'income', amountMinor: 1_000_000, ...over });

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

  it('доход сегодня горизонт не обрывает (его ещё не провели — деньги в остатке не лежат): ждём следующий', () => {
    const r = calc({ rules: [income('salary', { startOn: '2026-10-22' })] });
    expect(r.incomeDate).toBe('2026-11-22');
    expect(r.horizonEnd).toBe('2026-11-21');
    expect(r.daysLeft).toBe(31);
    expect(r.incomeMinor).toBe(0);
  });

  it('доход уже проведён или пропущен — не считается; следующий — в другом месяце, до дня перед ним', () => {
    const done = new Set([occurrenceKey('salary', '2026-10-25')]);
    const r = calc({ rules: [income('salary', { startOn: '2026-09-25' })], doneOccurrences: done });
    expect(r.incomeDate).toBe('2026-11-25');
    expect(r.horizonEnd).toBe('2026-11-24');
    expect(r.daysLeft).toBe(34);
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

  it('доход 1-го числа: горизонт — до конца месяца, доход сразу после него', () => {
    const r = calc({ rules: [income('a', { startOn: '2026-11-01' })] });
    expect(r.incomeDate).toBe('2026-11-01');
    expect(r.horizonEnd).toBe('2026-10-31');
    expect(r.daysLeft).toBe(10);
  });

  it('доход в следующем месяце: считаем до дня перед ним, и аренда 1-го вычитается', () => {
    const r = calc({ rules: [income('a', { startOn: '2026-11-05' }), rule('rent', { amountMinor: 30_000, startOn: '2026-11-01' })] });
    expect(r).toMatchObject({ incomeDate: '2026-11-05', horizonEnd: '2026-11-04', daysLeft: 14, paymentsMinor: 30_000 });
    expect(r.perDayMinor).toBe(5_000); // (1000 − 300) / 14
  });

  it('доход дальше окна поиска (45 дней) не виден: считаем без дохода', () => {
    const r = calc({ rules: [income('far', { startOn: '2026-12-07' })] }); // 22.10 + 46
    expect(r.incomeDate).toBeNull();
    expect(r.horizonEnd).toBe('2026-10-31');
    const edge = calc({ rules: [income('edge', { startOn: '2026-12-06' })] }); // ровно 45 дней
    expect(edge.incomeDate).toBe('2026-12-06');
    expect(edge.horizonEnd).toBe('2026-12-05');
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

  it('правило, закончившееся до сегодня, и правило, которое начнётся позже окна поиска, не мешают', () => {
    const r = calc({ rules: [income('ended', { startOn: '2026-01-01', endOn: '2026-09-30' }), income('later', { startOn: '2027-01-01' })] });
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

  it('платёж после конца горизонта (крупный доход раньше) не вычитается', () => {
    const r = calc({
      rules: [rule('rent', { startOn: '2026-10-28', amountMinor: 30_000 }), rule('salary', { kind: 'income', amountMinor: 1_000_000, startOn: '2026-10-25' })],
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

describe('computeDailyForecast: мелкий доход не обрывает горизонт (контрольные дни)', () => {
  const income = (id: string, over: Partial<ForecastRule> = {}) => rule(id, { kind: 'income', ...over });

  it('еженедельный доход 100 с. при 1000 с.: не «всё на сегодня», а до конца месяца вместе с доходами', () => {
    const r = calc({ rules: [income('w', { frequency: 'weekly', startOn: '2026-10-23', amountMinor: 10_000 })] });
    // доходы 23-го и 30-го: (1000 + 200) / 10 дней
    expect(r).toMatchObject({ horizonEnd: '2026-10-31', daysLeft: 10, incomeMinor: 20_000, perDayMinor: 12_000, incomeDate: null });
    expect(r.perDayMinor).toBeLessThanOrEqual(Math.floor((100_000 + 20_000) / 10));
  });

  it('аренда после мелкого дохода вычитается', () => {
    const r = calc({ rules: [income('small', { startOn: '2026-10-23', amountMinor: 10_000 }), rule('rent', { amountMinor: 30_000, startOn: '2026-10-25' })] });
    expect(r).toMatchObject({ horizonEnd: '2026-10-31', incomeMinor: 10_000, paymentsMinor: 30_000, availableMinor: 80_000, perDayMinor: 8_000 });
  });

  it('крупная зарплата ведёт себя как раньше: до дня перед ней', () => {
    const r = calc({ rules: [income('salary', { startOn: '2026-10-25', amountMinor: 1_000_000 })] });
    expect(r).toMatchObject({ horizonEnd: '2026-10-24', incomeDate: '2026-10-25', daysLeft: 3, incomeMinor: 0, perDayMinor: 33_333 });
  });

  it('денег не хватит до зарплаты: нехватка — в худший день, горизонт — до него', () => {
    const r = calc({
      balances: new Map([['cash', 10_000]]),
      rules: [rule('rent', { amountMinor: 30_000, startOn: '2026-10-24' }), income('salary', { startOn: '2026-10-26', amountMinor: 1_000_000 })],
    });
    expect(r).toMatchObject({ notEnough: true, shortfallMinor: 20_000, horizonEnd: '2026-10-25', incomeDate: '2026-10-26', perDayMinor: 0, todayLimitMinor: 0 });
  });

  it('платёж по долгу до зарплаты вычитается, хотя сам долг со сроком позже неё (проверка на каждом контрольном дне)', () => {
    const r = calc({
      debts: [{ id: 'd', direction: 'borrowed', currency: 'TJS', dueOn: '2026-10-30', remainingMinor: 50_000, closedAt: null, archivedAt: null }],
      rules: [rule('pay', { debtId: 'd', amountMinor: 10_000, startOn: '2026-10-25' }), income('salary', { startOn: '2026-10-27', amountMinor: 1_000_000 })],
    });
    expect(r).toMatchObject({ horizonEnd: '2026-10-26', paymentsMinor: 10_000, debtsMinor: 0, perDayMinor: 18_000 });
  });

  it('доход на архивный кошелёк, на накопления и возврат «мне должны» по расписанию — не ждём', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('old', { archivedAt: '2026-01-01T00:00:00.000Z' }), wallet('box', { kind: 'savings' })],
      debts: [{ id: 'lent', direction: 'lent', currency: 'TJS', dueOn: null, remainingMinor: 50_000, closedAt: null, archivedAt: null }],
      rules: [
        income('arch', { walletId: 'old', startOn: '2026-10-23', amountMinor: 1_000_000 }),
        income('box', { walletId: 'box', startOn: '2026-10-23', amountMinor: 1_000_000 }),
        income('back', { debtId: 'lent', startOn: '2026-10-23', amountMinor: 1_000_000 }),
        income('gone', { debtId: 'нет-такого', startOn: '2026-10-23', amountMinor: 1_000_000 }),
      ],
    });
    expect(r).toMatchObject({ horizonEnd: '2026-10-31', incomeMinor: 0, incomeDate: null, perDayMinor: 10_000 });
  });

  it('доход по долгу «я должен» (деньги в долг приходят частями) — ждём, это настоящие деньги', () => {
    const r = calc({
      debts: [{ id: 'loan', direction: 'borrowed', currency: 'TJS', dueOn: null, remainingMinor: 0, closedAt: null, archivedAt: null }],
      rules: [income('in', { debtId: 'loan', startOn: '2026-10-25', amountMinor: 10_000 })],
    });
    expect(r.incomeMinor).toBe(10_000);
  });

  it('доход в валюте без курса: в запас не входит, сказано (skipped), число приблизительное', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 100_000], ['usd', 0]]),
      rules: [income('usd', { walletId: 'usd', startOn: '2026-10-25', amountMinor: 50_000 })],
    });
    expect(r.incomeMinor).toBe(0);
    expect(r.skipped).toEqual([{ source: 'income', currency: 'USD', amountMinor: 50_000 }]);
    expect(r.approximate).toBe(true);
  });

  it('«на сегодня можно» не меньше «в день» и считается по тому же самому тесному дню', () => {
    const r = calc({ spentTodayMinor: 5_000, balances: new Map([['cash', 95_000]]), rules: [income('w', { frequency: 'weekly', startOn: '2026-10-23', amountMinor: 10_000 })] });
    expect(r.todayLimitMinor).toBeGreaterThanOrEqual(r.perDayMinor);
    expect(r.todayLimitMinor).toBe(12_000); // (950 + 50 + 200) / 10
  });
});

describe('computeDailyForecast: просроченные платежи', () => {
  it('без overdueFrom вчерашний платёж не считается (как раньше)', () => {
    expect(calc({ rules: [rule('a', { startOn: '2026-10-21' })] }).paymentsCount).toBe(0);
  });

  it('вчерашний, не проведённый и не пропущенный — вычитается сегодня, и об этом сказано отдельно', () => {
    const r = calc({ rules: [rule('rent', { startOn: '2026-10-21', amountMinor: 30_000, overdueFrom: '2026-09-21' })] });
    expect(r).toMatchObject({ paymentsMinor: 30_000, paymentsCount: 1, overduePaymentsMinor: 30_000, overdueCount: 1, perDayMinor: 7_000 });
  });

  it('проведённая или пропущенная прошлая дата не вычитается', () => {
    const r = calc({
      rules: [rule('rent', { startOn: '2026-10-21', amountMinor: 30_000, overdueFrom: '2026-09-21' })],
      doneOccurrences: new Set([occurrenceKey('rent', '2026-10-21')]),
    });
    expect(r).toMatchObject({ paymentsMinor: 0, overdueCount: 0 });
  });

  it('дата раньше overdueFrom (до создания или правки правила, старше месяца) — нет', () => {
    const r = calc({ rules: [rule('rent', { startOn: '2026-10-21', overdueFrom: '2026-10-22' })] });
    expect(r).toMatchObject({ paymentsCount: 0, overdueCount: 0 });
  });

  it('несколько просроченных дат одного правила считаются каждая', () => {
    const r = calc({ rules: [rule('d', { frequency: 'daily', startOn: '2026-10-01', amountMinor: 1_000, overdueFrom: '2026-10-19' })] });
    // 19, 20, 21 — просрочены; 22…31 — впереди
    expect(r).toMatchObject({ overdueCount: 3, overduePaymentsMinor: 3_000, paymentsCount: 13, paymentsMinor: 13_000 });
  });

  it('просроченный платёж по долгу, который уже учтён остатком, второй раз не берётся', () => {
    const r = calc({
      debts: [{ id: 'd', direction: 'borrowed', currency: 'TJS', dueOn: '2026-10-28', remainingMinor: 20_000, closedAt: null, archivedAt: null }],
      rules: [rule('pay', { debtId: 'd', startOn: '2026-10-20', amountMinor: 10_000, overdueFrom: '2026-10-01' })],
    });
    expect(r).toMatchObject({ debtsMinor: 20_000, paymentsMinor: 0, overdueCount: 0 });
  });

  it('просроченный доход ничего не добавляет и горизонт не трогает', () => {
    const r = calc({ rules: [rule('inc', { kind: 'income', startOn: '2026-10-20', endOn: '2026-10-20', amountMinor: 50_000, overdueFrom: '2026-10-01' })] });
    expect(r).toMatchObject({ incomeMinor: 0, paymentsMinor: 0, perDayMinor: 10_000, horizonEnd: '2026-10-31' });
  });

  it('просроченный перевод в накопления вычитается, а архивное правило и расход с накоплений — нет', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('box', { kind: 'savings' })],
      rules: [
        rule('save', { kind: 'transfer', toWalletId: 'box', startOn: '2026-10-20', amountMinor: 5_000, overdueFrom: '2026-10-01' }),
        rule('arch', { startOn: '2026-10-20', overdueFrom: '2026-10-01', archivedAt: '2026-10-21T00:00:00.000Z' }),
        rule('box', { walletId: 'box', startOn: '2026-10-20', overdueFrom: '2026-10-01' }),
      ],
    });
    expect(r).toMatchObject({ overdueCount: 1, overduePaymentsMinor: 5_000, paymentsMinor: 5_000 });
  });

  it('просроченный платёж с неизвестного кошелька — не вычитается, но число приблизительное', () => {
    const r = calc({ rules: [rule('ghost', { walletId: 'нет-такого', startOn: '2026-10-20', overdueFrom: '2026-10-01' })] });
    expect(r).toMatchObject({ unknownWalletPayments: 1, overdueCount: 0, approximate: true });
  });
});

describe('computeDailyForecast: свойства (fast-check)', () => {
  const day = fc.integer({ min: 0, max: 50 });
  const arbRule = fc.record({
    kind: fc.constantFrom<'expense' | 'income'>('expense', 'income'),
    frequency: fc.constantFrom<'daily' | 'weekly' | 'monthly'>('daily', 'weekly', 'monthly'),
    offset: fc.integer({ min: -40, max: 50 }),
    amountMinor: fc.integer({ min: 1, max: 5_000_000 }),
  });
  const arbCase = fc.record({
    todayOffset: fc.integer({ min: 0, max: 400 }),
    money: fc.integer({ min: -1_000_000, max: 50_000_000 }),
    spent: fc.integer({ min: 0, max: 1_000_000 }),
    rules: fc.array(arbRule, { maxLength: 6 }),
  });
  const build = (c: typeof arbCase extends fc.Arbitrary<infer T> ? T : never) => {
    const today = addDaysIso('2026-01-01', c.todayOffset);
    return input({
      today,
      balances: new Map([['cash', c.money]]),
      spentTodayMinor: c.spent,
      rules: c.rules.map((r, i) =>
        rule(`r${i}`, { kind: r.kind, frequency: r.frequency, startOn: addDaysIso(today, r.offset), amountMinor: r.amountMinor, overdueFrom: addDaysIso(today, -31) }),
      ),
    });
  };

  it('никогда не обещаем больше, чем есть к концу горизонта; «сегодня можно» не меньше «в день»', () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const r = ok(computeDailyForecast(build(c)));
        expect(r.perDayMinor).toBeGreaterThanOrEqual(0);
        expect(r.todayLimitMinor).toBeGreaterThanOrEqual(r.perDayMinor);
        if (!r.notEnough) expect(r.perDayMinor * r.daysLeft).toBeLessThanOrEqual(r.availableMinor);
        else expect(r.perDayMinor).toBe(0);
        expect(r.availableMinor).toBe(r.moneyMinor + r.incomeMinor - r.obligationsMinor);
        expect(r.daysLeft).toBeGreaterThanOrEqual(1);
        expect(r.horizonEnd >= r.today).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('лишний обязательный платёж никогда не увеличивает «в день», лишние деньги — не уменьшают', () => {
    fc.assert(
      fc.property(arbCase, day, fc.integer({ min: 1, max: 5_000_000 }), (c, at, amount) => {
        const base = ok(computeDailyForecast(build(c)));
        const inp = build(c);
        const withPayment = ok(computeDailyForecast({ ...inp, rules: [...inp.rules, rule('extra', { frequency: 'daily', startOn: addDaysIso(inp.today, at), endOn: addDaysIso(inp.today, at), amountMinor: amount })] }));
        expect(withPayment.perDayMinor).toBeLessThanOrEqual(base.perDayMinor);
        const richer = ok(computeDailyForecast({ ...inp, balances: new Map([['cash', c.money + amount]]) }));
        expect(richer.perDayMinor).toBeGreaterThanOrEqual(base.perDayMinor);
      }),
      { numRuns: 300 },
    );
  });
});
