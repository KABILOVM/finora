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
import { occurrencesBetween } from './schedule';

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

  it('доход сегодня горизонт не обрывает, но в запас входит (его проведут сегодня): ждём следующий', () => {
    const r = calc({ rules: [income('salary', { startOn: '2026-10-22' })] });
    expect(r.incomeDate).toBe('2026-11-22');
    expect(r.horizonEnd).toBe('2026-11-21');
    expect(r.daysLeft).toBe(31);
    expect(r.incomeMinor).toBe(1_000_000);
    expect(r.perDayMinor).toBe(35_483); // (1 000 + 10 000) ÷ 31
  });

  it('утро дня зарплаты: пока она не проведена, «нет денег» не пишем, но и на сегодня — не больше того, что на руках', () => {
    // 900 на руках, зарплата 10 000 сегодня (ещё не проведена), аренда 3 000 1-го, следующая зарплата 22 ноября
    const morning = calc({
      balances: new Map([['cash', 90_000]]),
      rules: [income('salary', { startOn: '2026-10-22' }), rule('rent', { amountMinor: 300_000, startOn: '2026-11-01' })],
    });
    expect(morning).toMatchObject({ notEnough: false, horizonEnd: '2026-11-21', perDayMinor: 25_483 }); // (900 + 10 000 − 3 000) ÷ 31
    // денег на руках совсем мало: до проведения зарплаты можно только то, что есть
    const broke = calc({ balances: new Map([['cash', 10_000]]), rules: [income('salary', { startOn: '2026-10-22' })] });
    expect(broke).toMatchObject({ perDayMinor: 10_000, horizonEnd: '2026-10-22', daysLeft: 1, incomeDate: '2026-10-22', notEnough: false });
    // после проведения (деньги в остатке, дата — проведена) цифра та же, что утром при 900
    const posted = calc({
      balances: new Map([['cash', 1_090_000]]),
      rules: [income('salary', { startOn: '2026-10-22' }), rule('rent', { amountMinor: 300_000, startOn: '2026-11-01' })],
      doneOccurrences: new Set([occurrenceKey('salary', '2026-10-22')]),
    });
    expect(posted.perDayMinor).toBe(morning.perDayMinor);
  });

  it('доход уже проведён или пропущен — не считается; следующий — в другом месяце, до дня перед ним', () => {
    const done = new Set([occurrenceKey('salary', '2026-10-25')]);
    const r = calc({ rules: [income('salary', { startOn: '2026-09-25' })], doneOccurrences: done });
    expect(r.incomeDate).toBe('2026-11-25');
    expect(r.horizonEnd).toBe('2026-11-24');
    expect(r.daysLeft).toBe(34);
  });

  it('еженедельный доход: сегодняшний (22-е) уже проведён, берётся 29-е → горизонт до 28-го (7 дней)', () => {
    const r = calc({ rules: [income('w', { frequency: 'weekly', startOn: '2026-10-01' })], doneOccurrences: new Set([occurrenceKey('w', '2026-10-22')]) });
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

  it('кошелёк правила в архиве: платёж не вычитается — с архивным кошельком операцию не провести (и денег его на руках нет)', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('old', { archivedAt: '2026-01-01T00:00:00.000Z' })],
      rules: [rule('r', { walletId: 'old', amountMinor: 4_000, startOn: '2026-10-25' })],
    });
    expect(r.paymentsMinor).toBe(0);
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

  it('«на сегодня можно» — каким «в день» было утром: минимум по всем контрольным дням (запас + потрачено сегодня) / дней', () => {
    const r = calc({ spentTodayMinor: 5_000, balances: new Map([['cash', 95_000]]), rules: [income('w', { frequency: 'weekly', startOn: '2026-10-23', amountMinor: 10_000 })] });
    expect(r.todayLimitMinor).toBeGreaterThanOrEqual(r.perDayMinor);
    expect(r.todayLimitMinor).toBe(12_000); // (950 + 50 + 200) / 10
    // утром самым тесным был другой день, чем сейчас: 100 на руках, 100 потрачено, разовый доход 500 24-го
    const shifted = calc({
      balances: new Map([['cash', 10_000]]),
      spentTodayMinor: 10_000,
      rules: [income('once', { startOn: '2026-10-24', endOn: '2026-10-24', amountMinor: 50_000 })],
    });
    expect(shifted).toMatchObject({ perDayMinor: 5_000, horizonEnd: '2026-10-23', todayLimitMinor: 7_000 }); // утром: (100 + 100 + 500) ÷ 10
  });
});

describe('computeDailyForecast: мелкий доход не прячет аренду перед зарплатой после конца месяца', () => {
  const income = (id: string, over: Partial<ForecastRule> = {}) => rule(id, { kind: 'income', ...over });
  const salaryAndRent = [income('salary', { startOn: '2026-11-05', amountMinor: 1_000_000 }), rule('rent', { amountMinor: 30_000, startOn: '2026-11-01' })];

  it('разовый мелкий доход 25-го: горизонт всё равно до 4 ноября, аренда 1-го вычтена', () => {
    const r = calc({ rules: [...salaryAndRent, income('tip', { startOn: '2026-10-25', endOn: '2026-10-25', amountMinor: 1_000 })] });
    expect(r).toMatchObject({ horizonEnd: '2026-11-04', incomeDate: '2026-11-05', paymentsMinor: 30_000, perDayMinor: 5_071 }); // (1000 + 10 − 300) ÷ 14
  });

  it('еженедельная подработка: тоже до 4 ноября, с арендой', () => {
    const r = calc({ rules: [...salaryAndRent, income('side', { frequency: 'weekly', startOn: '2026-10-23', amountMinor: 5_000 })] });
    expect(r).toMatchObject({ horizonEnd: '2026-11-04', paymentsMinor: 30_000, perDayMinor: 5_714 }); // (1000 + 50 + 50 − 300) ÷ 14
  });

  it('мелкий доход сразу после конца месяца (1 ноября) зарплату 5-го не заслоняет', () => {
    const r = calc({ rules: [...salaryAndRent, income('tip', { startOn: '2026-11-01', endOn: '2026-11-01', amountMinor: 1_000 })] });
    expect(r).toMatchObject({ horizonEnd: '2026-11-04', paymentsMinor: 30_000, perDayMinor: 5_071 });
  });

  it('разовая премия больше зарплаты до конца месяца: новая зарплата 5-го всё равно видна, огромная аренда 1-го — тоже', () => {
    const r = calc({
      balances: new Map([['cash', 500_000]]),
      rules: [
        income('bonus', { startOn: '2026-10-28', endOn: '2026-10-28', amountMinor: 6_000_000 }),
        income('salary', { startOn: '2026-11-05', amountMinor: 5_000_000 }),
        rule('rent', { amountMinor: 10_000_000, startOn: '2026-11-01' }),
      ],
    });
    expect(r).toMatchObject({ notEnough: true, horizonEnd: '2026-11-04', shortfallMinor: 3_500_000, perDayMinor: 0 });
  });

  it('крупная зарплата внутри месяца по-прежнему обрывает горизонт: дальше её следующей копии не смотрим', () => {
    const r = calc({ rules: [income('salary', { startOn: '2026-09-25', amountMinor: 1_000_000 }), rule('rent', { amountMinor: 30_000, startOn: '2026-11-01' })] });
    expect(r).toMatchObject({ horizonEnd: '2026-10-24', incomeDate: '2026-10-25', paymentsMinor: 0, perDayMinor: 33_333 });
  });
});

describe('computeDailyForecast: «зарплата» — самый крупный регулярный доход', () => {
  const income = (id: string, over: Partial<ForecastRule> = {}) => rule(id, { kind: 'income', ...over });

  it('крохотный новый доход после конца месяца и разовая премия больше зарплаты горизонт до зарплаты не обрезают', () => {
    const base = [
      income('bonus', { startOn: '2026-10-28', endOn: '2026-10-28', amountMinor: 6_000_000 }),
      income('salary', { startOn: '2026-11-05', amountMinor: 5_000_000 }),
      rule('rent', { amountMinor: 10_000_000, startOn: '2026-11-01' }),
    ];
    for (const extra of [income('tip', { startOn: '2026-11-01', endOn: '2026-11-01', amountMinor: 1_000 }), income('cashback', { startOn: '2026-11-02', amountMinor: 500 })]) {
      const r = calc({ balances: new Map([['cash', 500_000]]), rules: [...base, extra] });
      expect(r).toMatchObject({ notEnough: true, perDayMinor: 0, paymentsMinor: 10_000_000 }); // аренда 1-го учтена
    }
  });

  it('разовая премия после конца месяца, но до зарплаты, аренду перед зарплатой не прячет', () => {
    const r = calc({
      balances: new Map([['cash', 500_000]]),
      rules: [
        income('bonus', { startOn: '2026-11-02', endOn: '2026-11-02', amountMinor: 6_000_000 }),
        income('salary', { startOn: '2026-11-05', amountMinor: 5_000_000 }),
        rule('rent', { amountMinor: 10_000_000, startOn: '2026-11-03' }),
      ],
    });
    expect(r).toMatchObject({ notEnough: true, horizonEnd: '2026-11-04', shortfallMinor: 3_500_000 });
  });

  it('редкий мелкий доход (дивиденды раз в квартал) не тянет горизонт через зарплату внутри месяца', () => {
    const r = calc({
      today: '2026-10-18',
      balances: new Map([['cash', 1_000_000]]),
      rules: [
        income('salary', { startOn: '2026-09-25', amountMinor: 1_000_000 }),
        rule('rent', { amountMinor: 300_000, startOn: '2026-11-01' }),
        income('dividend', { frequency: 'monthly', intervalN: 3, startOn: '2026-12-01', amountMinor: 5_000 }),
      ],
    });
    expect(r).toMatchObject({ horizonEnd: '2026-10-24', incomeDate: '2026-10-25', perDayMinor: 142_857 });
  });

  it('провели сегодняшний аванс — горизонт и цифра те же, что утром', () => {
    const rules = [
      income('advance', { startOn: '2026-09-10', amountMinor: 600_000 }),
      income('salary', { startOn: '2026-09-25', amountMinor: 1_000_000 }),
      rule('rent', { amountMinor: 300_000, startOn: '2026-11-01' }),
    ];
    const morning = calc({ today: '2026-10-10', balances: new Map([['cash', 300_000]]), rules });
    const posted = calc({ today: '2026-10-10', balances: new Map([['cash', 900_000]]), rules, doneOccurrences: new Set([occurrenceKey('advance', '2026-10-10')]) });
    expect(morning).toMatchObject({ horizonEnd: '2026-10-24', perDayMinor: 60_000 });
    expect(posted).toMatchObject({ horizonEnd: morning.horizonEnd, perDayMinor: morning.perDayMinor });
  });

  it('утро дня зарплаты, когда сегодня же аренда (или срок долга): не «Денег не хватает», а не больше того, что на руках', () => {
    const rules = [income('salary', { startOn: '2026-10-22', amountMinor: 1_000_000 }), rule('rent', { amountMinor: 50_000, startOn: '2026-10-22' })];
    const r = calc({ balances: new Map([['cash', 10_000]]), rules });
    expect(r).toMatchObject({ notEnough: false, perDayMinor: 10_000, horizonEnd: '2026-10-22', incomeDate: '2026-10-22', todayLimitMinor: 10_000 });
    const spent = calc({ balances: new Map([['cash', 10_000]]), spentTodayMinor: 5_000, rules });
    expect(spent.todayLimitMinor).toBe(15_000); // с утра на руках было 150
    const debt = calc({
      balances: new Map([['cash', 50_000]]),
      rules: [income('salary', { startOn: '2026-10-22', amountMinor: 1_000_000 })],
      debts: [{ id: 'd', direction: 'borrowed', currency: 'TJS', dueOn: '2026-10-22', remainingMinor: 200_000, closedAt: null, archivedAt: null }],
    });
    expect(debt.notEnough).toBe(false);
    // просроченное больше, чем на руках: до проведения дохода на сегодня — 0, но тревоги нет: сегодняшний доход всё покроет
    const overdue = calc({ balances: new Map([['cash', 10_000]]), rules: [...rules, rule('old', { amountMinor: 30_000, startOn: '2026-10-20', endOn: '2026-10-20', overdueFrom: '2026-10-01' })] });
    expect(overdue).toMatchObject({ notEnough: false, perDayMinor: 0, untilTodayIncome: true, horizonEnd: '2026-10-22' });
    // аренду сегодня уже провели (денег стало −400), а зарплату ещё нет — то же самое: 0 на сегодня, без «Денег не хватает»
    const rentPosted = calc({ balances: new Map([['cash', -40_000]]), rules, doneOccurrences: new Set([occurrenceKey('rent', '2026-10-22')]) });
    expect(rentPosted).toMatchObject({ notEnough: false, perDayMinor: 0, untilTodayIncome: true });
  });

  it('зарплата в другой валюте сравнивается по курсу, а не по «сырым» цифрам', () => {
    const r = calc({
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 100_000], ['usd', 0]]),
      getRate: rates({ 'USD>TJS': 10.9 }),
      rules: [
        income('side', { startOn: '2026-11-02', amountMinor: 150_000 }), // 1 500 с.
        income('salary', { walletId: 'usd', startOn: '2026-11-10', amountMinor: 100_000 }), // 1 000 $ ≈ 10 900 с.
        rule('rent', { amountMinor: 500_000, startOn: '2026-11-05' }),
      ],
    });
    expect(r).toMatchObject({ horizonEnd: '2026-11-09', notEnough: true, shortfallMinor: 250_000 });
  });
});

describe('computeDailyForecast: «зарплатой» не считаются редкие, последние и разовые доходы', () => {
  const income = (id: string, over: Partial<ForecastRule> = {}) => rule(id, { kind: 'income', ...over });
  const base = { today: '2026-10-18', balances: new Map([['cash', 1_400_000]]) };
  const salaryAndRent = [income('salary', { startOn: '2026-10-05', amountMinor: 1_000_000 }), rule('rent', { amountMinor: 600_000, startOn: '2026-11-01' })];

  it('квартальная, годовая премия и последний платёж контракта больше зарплаты — горизонт всё равно до зарплаты 5-го', () => {
    for (const bonus of [
      income('q', { frequency: 'monthly', intervalN: 3, startOn: '2026-10-25', amountMinor: 1_200_000 }),
      income('y', { frequency: 'yearly', startOn: '2026-10-25', amountMinor: 1_200_000 }),
      income('last', { startOn: '2026-09-25', endOn: '2026-10-25', amountMinor: 1_200_000 }),
    ]) {
      const r = calc({ ...base, rules: [...salaryAndRent, bonus] });
      expect(r, bonus.id).toMatchObject({ horizonEnd: '2026-11-04', paymentsMinor: 600_000 });
    }
  });

  it('зарплата в валюте без курса: сравнить нельзя — до дня перед ней смотрим всё равно, мелкий кешбэк горизонт не обрежет', () => {
    const r = calc({
      today: '2026-10-22',
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 500_000], ['usd', 0]]),
      rules: [
        income('salary', { walletId: 'usd', startOn: '2026-11-05', amountMinor: 100_000 }),
        income('cashback', { startOn: '2026-11-02', amountMinor: 500 }),
        rule('rent', { amountMinor: 900_000, startOn: '2026-11-03' }),
      ],
    });
    expect(r).toMatchObject({ notEnough: true, horizonEnd: '2026-11-04', paymentsMinor: 900_000 });
  });
});

describe('computeDailyForecast: последняя выплата зарплаты и переводы с накоплений', () => {
  it('зарплата по контракту до конца года: до её последней выплаты смотрим, аренда перед ней вычтена', () => {
    const r = calc({
      today: '2026-11-18',
      balances: new Map([['cash', 300_000]]),
      rules: [rule('salary', { kind: 'income', startOn: '2026-01-05', endOn: '2026-12-31', amountMinor: 1_000_000 }), rule('rent', { amountMinor: 250_000, startOn: '2026-01-01' })],
    });
    expect(r).toMatchObject({ horizonEnd: '2026-12-04', paymentsMinor: 250_000, perDayMinor: 2_941 }); // (3 000 − 2 500) ÷ 17
  });

  it('с накоплений приходит не больше, чем там лежит', () => {
    const wallets = [wallet('cash'), wallet('box', { kind: 'savings' })];
    const take = rule('take', { kind: 'transfer', walletId: 'box', toWalletId: 'cash', amountMinor: 50_000, startOn: '2026-10-25' });
    expect(calc({ wallets, balances: new Map([['cash', 100_000], ['box', 0]]), rules: [take] }).incomeMinor).toBe(0);
    expect(calc({ wallets, balances: new Map([['cash', 100_000], ['box', 20_000]]), rules: [take] }).incomeMinor).toBe(20_000);
    expect(calc({ wallets, balances: new Map([['cash', 100_000], ['box', 90_000]]), rules: [take] }).incomeMinor).toBe(50_000);
  });
});

describe('computeDailyForecast: плановые платежи по долгу «я должен»', () => {
  const debt = (over: Partial<ForecastInput['debts'][number]> = {}) => ({
    id: 'loan',
    direction: 'borrowed' as const,
    currency: 'TJS',
    dueOn: null,
    remainingMinor: 100_000,
    closedAt: null,
    archivedAt: null,
    ...over,
  });

  it('не больше остатка долга: еженедельные 600 при остатке 1 000 — вычитаем 1 000, а не 1 800', () => {
    const r = calc({
      today: '2026-10-18',
      balances: new Map([['cash', 150_000]]),
      debts: [debt({ dueOn: '2026-11-10' })],
      rules: [rule('pay', { debtId: 'loan', frequency: 'weekly', amountMinor: 60_000, startOn: '2026-10-20' }), rule('salary', { kind: 'income', startOn: '2026-11-05', amountMinor: 1_000_000 })],
    });
    expect(r).toMatchObject({ horizonEnd: '2026-11-04', paymentsMinor: 100_000, notEnough: false });
  });

  it('долг закрыт или отдан, а правило ещё живо — платить нечего', () => {
    for (const d of [
      debt({ closedAt: '2026-10-01T00:00:00.000Z', remainingMinor: 0 }),
      debt({ closedAt: '2026-10-01T00:00:00.000Z', remainingMinor: 50_000 }), // закрыли, простив остаток
      debt({ archivedAt: '2026-10-01T00:00:00.000Z' }),
      debt({ remainingMinor: 0 }),
    ]) {
      const r = calc({ debts: [d], rules: [rule('pay', { debtId: 'loan', frequency: 'weekly', amountMinor: 20_000, startOn: '2026-10-23' })] });
      expect(r.paymentsMinor).toBe(0);
    }
  });
});

describe('computeDailyForecast: регулярные переводы', () => {
  it('комиссия перевода между своими обычными кошельками вычитается заранее', () => {
    const r = calc({
      today: '2026-10-15',
      wallets: [wallet('cash'), wallet('card', { kind: 'card' })],
      balances: new Map([['cash', 100_000], ['card', 0]]),
      rules: [rule('move', { kind: 'transfer', toWalletId: 'card', amountMinor: 30_000, toAmountMinor: 20_000, startOn: '2026-10-20' })],
    });
    expect(r).toMatchObject({ paymentsMinor: 10_000, perDayMinor: 5_294 }); // (1000 − 100) ÷ 17
  });

  it('перевод на архивный кошелёк не случится — провести его нельзя (как и в календаре)', () => {
    for (const kind of ['card', 'savings'] as const) {
      const r = calc({
        today: '2026-10-15',
        wallets: [wallet('cash'), wallet('old', { kind, archivedAt: '2026-01-01T00:00:00.000Z' })],
        balances: new Map([['cash', 30_000], ['old', 0]]),
        rules: [rule('t', { kind: 'transfer', toWalletId: 'old', amountMinor: 25_000, toAmountMinor: 20_000, startOn: '2026-10-25' })],
      });
      expect(r, kind).toMatchObject({ paymentsMinor: 0, perDayMinor: 1_764 }); // 30 000 ÷ 17
    }
  });
});

describe('computeDailyForecast: предупреждения собираются со всех контрольных дней', () => {
  it('долг без курса со сроком после зарплаты: число помечено «≈», долг назван, хотя самый тесный день — до зарплаты', () => {
    const r = calc({
      today: '2026-10-18',
      balances: new Map([['cash', 300_000]]),
      rules: [rule('salary', { kind: 'income', startOn: '2026-10-25', amountMinor: 1_000_000 })],
      debts: [{ id: 'usd', direction: 'borrowed', currency: 'USD', dueOn: '2026-10-30', remainingMinor: 100_000, closedAt: null, archivedAt: null }],
    });
    expect(r.horizonEnd).toBe('2026-10-24');
    expect(r.skipped).toEqual([{ source: 'debt', currency: 'USD', amountMinor: 100_000 }]);
    expect(r.approximate).toBe(true);
  });

  it('пересчёт по курсу на другом контрольном дне — тоже «≈»; долг и его плановый платёж в одной валюте не называются дважды', () => {
    const fx = calc({
      today: '2026-10-18',
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 300_000], ['usd', 0]]),
      getRate: rates({ 'USD>TJS': 10.9 }),
      rules: [rule('salary', { kind: 'income', startOn: '2026-10-25', amountMinor: 1_000_000 }), rule('sub', { walletId: 'usd', amountMinor: 1_000, startOn: '2026-10-28' })],
    });
    expect(fx.horizonEnd).toBe('2026-10-24');
    expect(fx.approximate).toBe(true);
    const twice = calc({
      today: '2026-10-18',
      wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
      balances: new Map([['cash', 300_000], ['usd', 0]]),
      rules: [rule('salary', { kind: 'income', startOn: '2026-11-05', amountMinor: 10_000_000 }), rule('pay', { walletId: 'usd', debtId: 'loan', amountMinor: 10_000, startOn: '2026-10-25' })],
      debts: [{ id: 'loan', direction: 'borrowed', currency: 'USD', dueOn: '2026-11-03', remainingMinor: 100_000, closedAt: null, archivedAt: null }],
    });
    expect(twice.skipped).toEqual([{ source: 'debt', currency: 'USD', amountMinor: 100_000 }]);
  });

  it('платёж с неизвестного кошелька после зарплаты — тоже сказано', () => {
    const r = calc({
      today: '2026-10-18',
      balances: new Map([['cash', 300_000]]),
      rules: [rule('salary', { kind: 'income', startOn: '2026-10-25', amountMinor: 1_000_000 }), rule('ghost', { walletId: 'нет-такого', startOn: '2026-10-28' })],
    });
    expect(r).toMatchObject({ horizonEnd: '2026-10-24', unknownWalletPayments: 1, approximate: true });
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
        if (r.notEnough || r.availableMinor < 0) expect(r.perDayMinor).toBe(0);
        else expect(r.perDayMinor * r.daysLeft).toBeLessThanOrEqual(r.availableMinor);
        if (r.availableMinor < 0 && !r.notEnough) expect(r.untilTodayIncome).toBe(true); // минус — только утром до дохода
        expect(r.availableMinor).toBe(r.moneyMinor + r.incomeMinor - r.obligationsMinor);
        expect(r.daysLeft).toBeGreaterThanOrEqual(1);
        expect(r.horizonEnd >= r.today).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('если тратить «в день» каждый день до дня перед зарплатой (не меньше конца месяца / недели), денег хватает на всё (проверка по дням)', () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const inp = build(c);
        const r = ok(computeDailyForecast(inp));
        if (r.notEnough) return;
        const { today } = inp;
        const yesterday = addDaysIso(today, -1);
        // горизонт считаем сами, не по ответу: конец месяца (не меньше недели) или день перед ближайшей датой самого крупного дохода
        const monthEnd = endOfMonth(today);
        const week = addDaysIso(today, 6);
        let end = monthEnd > week ? monthEnd : week;
        let salary: { amount: number; next: string } | undefined;
        for (const rr of inp.rules) {
          if (rr.kind !== 'income') continue;
          const next = occurrencesBetween(rr, addDaysIso(today, 1), addDaysIso(today, 45))[0];
          if (next !== undefined && (salary === undefined || rr.amountMinor > salary.amount || (rr.amountMinor === salary.amount && next < salary.next))) {
            salary = { amount: rr.amountMinor, next };
          }
        }
        if (salary !== undefined && addDaysIso(salary.next, -1) > end) end = addDaysIso(salary.next, -1);
        const overdue = inp.rules
          .filter((rr) => rr.kind === 'expense')
          .reduce((sum, rr) => sum + occurrencesBetween(rr, rr.overdueFrom ?? today, yesterday).length * rr.amountMinor, 0);
        const between = (kind: 'income' | 'expense', from: string, to: string) =>
          inp.rules.filter((rr) => rr.kind === kind).reduce((sum, rr) => sum + occurrencesBetween(rr, from, to).length * rr.amountMinor, 0);
        // утро сегодняшнего дня: пока сегодняшний доход не проведён — только то, что на руках, минус просроченное
        if (between('income', today, today) > 0) {
          expect(r.perDayMinor, 'утро дня дохода').toBeLessThanOrEqual(Math.max(0, c.money - overdue));
          expect(r.todayLimitMinor, '«сегодня можно» утром дня дохода').toBeLessThanOrEqual(Math.max(0, c.money - overdue + c.spent));
        }
        for (let d = today, k = 1; d <= end; d = addDaysIso(d, 1), k++) {
          const balance = c.money - overdue + between('income', today, d) - between('expense', today, d) - r.perDayMinor * k;
          expect(balance, `конец дня ${d}`).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('мелкий разовый доход до конца месяца поднимает «в день» не больше, чем на свою сумму', () => {
    const bigRules = fc.array(
      fc.record({
        kind: fc.constantFrom<'expense' | 'income'>('expense', 'income'),
        frequency: fc.constantFrom<'daily' | 'weekly' | 'monthly'>('daily', 'weekly', 'monthly'),
        offset: fc.integer({ min: -40, max: 50 }),
        amountMinor: fc.integer({ min: 100_000, max: 5_000_000 }),
      }),
      { maxLength: 6 },
    );
    fc.assert(
      fc.property(
        fc.record({ todayOffset: fc.integer({ min: 0, max: 400 }), money: fc.integer({ min: 0, max: 50_000_000 }), spent: fc.constant(0), rules: bigRules }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 99_999 }),
        (c, at, a) => {
          const inp = build(c);
          const before = ok(computeDailyForecast(inp));
          const date = addDaysIso(inp.today, at);
          if (date > before.monthEnd) return;
          const after = ok(computeDailyForecast({ ...inp, rules: [...inp.rules, rule('tip', { kind: 'income', startOn: date, endOn: date, amountMinor: a })] }));
          expect(after.perDayMinor - before.perDayMinor).toBeLessThanOrEqual(a);
        },
      ),
      { numRuns: 400 },
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
