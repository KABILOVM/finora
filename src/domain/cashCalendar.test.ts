import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeCashCalendar, CALENDAR_DAYS, type CalendarInput, type CashCalendarOk } from './cashCalendar';
import { occurrenceKey, type ForecastDebt, type ForecastRule, type ForecastWallet } from './forecast';

/** Четверг 15 октября 2026; календарь на 30 дней — до 13 ноября включительно. */
const TODAY = '2026-10-15';

const wallet = (id: string, over: Partial<ForecastWallet> = {}): ForecastWallet => ({ id, currency: 'TJS', kind: 'cash', archivedAt: null, ...over });
const rule = (id: string, over: Partial<ForecastRule> = {}): ForecastRule => ({
  id,
  kind: 'expense',
  walletId: 'cash',
  amountMinor: 10_000,
  debtId: null,
  frequency: 'monthly',
  intervalN: 1,
  startOn: '2026-10-20',
  endOn: null,
  archivedAt: null,
  deletedAt: null,
  ...over,
});
const debt = (id: string, over: Partial<ForecastDebt> = {}): ForecastDebt => ({
  id,
  direction: 'borrowed',
  currency: 'TJS',
  dueOn: '2026-10-25',
  remainingMinor: 20_000,
  closedAt: null,
  archivedAt: null,
  ...over,
});
const input = (over: Partial<CalendarInput> = {}): CalendarInput => ({
  today: TODAY,
  base: 'TJS',
  wallets: [wallet('cash')],
  balances: new Map([['cash', 100_000]]),
  rules: [],
  doneOccurrences: new Set(),
  debts: [],
  getRate: (from, to) => (from === to ? 1 : from === 'USD' && to === 'TJS' ? 10.9 : null),
  usualPerDayMinor: null,
  spentTodayMinor: 0,
  includeUsual: false,
  includeReceivables: false,
  ...over,
});
const ok = (c: ReturnType<typeof computeCashCalendar>): CashCalendarOk => {
  if (c.status !== 'ok') throw new Error(`ожидали ok, получили ${c.status}`);
  return c;
};
const day = (c: CashCalendarOk, date: string) => c.days.find((d) => d.date === date)!;

describe('computeCashCalendar: основа', () => {
  it('нет событий: 30 дней подряд от сегодня, остаток не меняется', () => {
    const c = ok(computeCashCalendar(input()));
    expect(c.days).toHaveLength(CALENDAR_DAYS);
    expect(c.days[0]?.date).toBe('2026-10-15');
    expect(c.endDate).toBe('2026-11-13');
    expect(c.startMinor).toBe(100_000);
    expect(c.endMinor).toBe(100_000);
    expect(c.days.every((d) => d.balanceMinor === 100_000 && d.events.length === 0)).toBe(true);
    expect(c).toMatchObject({ minBalanceMinor: 100_000, minDate: '2026-10-15', firstNegativeDate: null, approximate: false, usualApplied: false });
  });

  it('число дней можно задать', () => {
    expect(ok(computeCashCalendar(input({ days: 7 }))).days).toHaveLength(7);
    expect(computeCashCalendar(input({ days: 0 }))).toEqual({ status: 'bad-date' });
    expect(computeCashCalendar(input({ days: 2.5 }))).toEqual({ status: 'bad-date' });
  });

  it('нет кошельков, только накопления, кривая дата — статусы без падения', () => {
    expect(computeCashCalendar(input({ wallets: [] }))).toEqual({ status: 'no-wallets' });
    expect(computeCashCalendar(input({ wallets: [wallet('cash', { archivedAt: '2026-01-01T00:00:00.000Z' })] }))).toEqual({ status: 'no-wallets' });
    expect(computeCashCalendar(input({ wallets: [wallet('box', { kind: 'savings' })] }))).toEqual({ status: 'only-savings' });
    expect(computeCashCalendar(input({ today: '2026-13-45' }))).toEqual({ status: 'bad-date' });
  });

  it('накопления в деньги на руках не входят', () => {
    const c = ok(computeCashCalendar(input({ wallets: [wallet('cash'), wallet('box', { kind: 'savings' })], balances: new Map([['cash', 100], ['box', 999_999]]) })));
    expect(c.startMinor).toBe(100);
  });
});

describe('регулярные платежи и доходы', () => {
  it('расход по расписанию уменьшает остаток с его дня (месячный платёж 20-го — один раз за 30 дней, потом 20 ноября вне окна)', () => {
    const c = ok(computeCashCalendar(input({ rules: [rule('rent', { amountMinor: 30_000 })] })));
    expect(day(c, '2026-10-19').balanceMinor).toBe(100_000);
    expect(day(c, '2026-10-20')).toMatchObject({ eventsMinor: -30_000, balanceMinor: 70_000 });
    expect(day(c, '2026-10-20').events).toEqual([{ kind: 'payment', id: 'rent', label: 'Платёж', date: '2026-10-20', deltaMinor: -30_000 }]);
    expect(c.endMinor).toBe(70_000);
    expect(c.days.flatMap((d) => d.events)).toHaveLength(1);
  });

  it('еженедельный платёж встречается каждую неделю', () => {
    const c = ok(computeCashCalendar(input({ rules: [rule('gym', { frequency: 'weekly', startOn: '2026-10-15', amountMinor: 1_000 })] })));
    expect(c.days.flatMap((d) => d.events).map((e) => e.date)).toEqual(['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12']);
    expect(c.endMinor).toBe(95_000);
  });

  it('доход на обычный кошелёк прибавляется; «проведено» и «пропущено» за дату не считаются', () => {
    const rules = [rule('salary', { kind: 'income', amountMinor: 300_000, startOn: '2026-10-25' })];
    expect(ok(computeCashCalendar(input({ rules }))).endMinor).toBe(400_000);
    const done = new Set([occurrenceKey('salary', '2026-10-25')]);
    expect(ok(computeCashCalendar(input({ rules, doneOccurrences: done }))).endMinor).toBe(100_000);
  });

  it('подпись берётся из labels', () => {
    const c = ok(computeCashCalendar(input({ rules: [rule('rent')], labels: new Map([['rent', 'Аренда']]) })));
    expect(day(c, '2026-10-20').events[0]?.label).toBe('Аренда');
  });

  it('архивное и удалённое правило не считается', () => {
    const rules = [rule('a', { archivedAt: '2026-10-01T00:00:00.000Z' }), rule('b', { deletedAt: '2026-10-01T00:00:00.000Z' })];
    expect(ok(computeCashCalendar(input({ rules }))).endMinor).toBe(100_000);
  });

  it('расход с накопления и доход на накопление на деньги на руках не влияют', () => {
    const wallets = [wallet('cash'), wallet('box', { kind: 'savings' })];
    const rules = [rule('a', { walletId: 'box' }), rule('b', { kind: 'income', walletId: 'box' })];
    expect(ok(computeCashCalendar(input({ wallets, rules }))).endMinor).toBe(100_000);
  });

  it('перевод на накопления — минус, перевод с накоплений — плюс, между обычными кошельками — ничего', () => {
    const wallets = [wallet('cash'), wallet('card', { kind: 'card' }), wallet('box', { kind: 'savings' })];
    const toBox = rule('t1', { kind: 'transfer', walletId: 'cash', toWalletId: 'box', amountMinor: 5_000 });
    const fromBox = rule('t2', { kind: 'transfer', walletId: 'box', toWalletId: 'cash', amountMinor: 2_000 });
    const between = rule('t3', { kind: 'transfer', walletId: 'cash', toWalletId: 'card', amountMinor: 9_000 });
    const noTarget = rule('t4', { kind: 'transfer', walletId: 'cash', toWalletId: null, amountMinor: 9_000 });
    expect(ok(computeCashCalendar(input({ wallets, rules: [toBox, fromBox, between, noTarget] }))).endMinor).toBe(100_000 - 5_000 + 2_000);
  });

  it('кошелёк правила не найден — платёж не считается, а об этом сказано', () => {
    const c = ok(computeCashCalendar(input({ rules: [rule('ghost', { walletId: 'нет такого' })] })));
    expect(c.unknownWalletPayments).toBe(1);
    expect(c.endMinor).toBe(100_000);
    expect(c.approximate).toBe(true);
  });

  it('платёж в долларах переводится по курсу; без курса — не входит и назван', () => {
    const wallets = [wallet('cash'), wallet('usd', { currency: 'USD' }), wallet('eur', { currency: 'EUR' })];
    const rules = [rule('p1', { walletId: 'usd', amountMinor: 1_000 }), rule('p2', { walletId: 'eur', amountMinor: 700 })]; // 10 $ = 109 с.
    const c = ok(computeCashCalendar(input({ wallets, rules, balances: new Map([['cash', 100_000]]) })));
    expect(c.endMinor).toBe(100_000 - 10_900);
    expect(c.skipped).toEqual([{ source: 'payment', currency: 'EUR', amountMinor: 700 }]);
    expect(c.approximate).toBe(true);
  });
});

describe('долги', () => {
  it('долг «я должен»: остаток уходит в день срока', () => {
    const c = ok(computeCashCalendar(input({ debts: [debt('d1')], labels: new Map([['d1', 'Рустам']]) })));
    expect(day(c, '2026-10-25')).toMatchObject({ eventsMinor: -20_000, balanceMinor: 80_000 });
    expect(day(c, '2026-10-25').events[0]).toMatchObject({ kind: 'debt-pay', label: 'Рустам' });
  });

  it('просроченный долг уходит сегодня и помечен', () => {
    const c = ok(computeCashCalendar(input({ debts: [debt('d1', { dueOn: '2026-10-01' })] })));
    expect(day(c, '2026-10-15').events[0]).toMatchObject({ kind: 'debt-pay', overdue: true, date: '2026-10-15' });
    expect(day(c, '2026-10-15').balanceMinor).toBe(80_000);
  });

  it('без срока, дальше окна, закрытый, архивный и погашенный долг не ставятся', () => {
    const debts = [
      debt('a', { dueOn: null }),
      debt('b', { dueOn: '2026-12-31' }),
      debt('c', { closedAt: '2026-10-01T00:00:00.000Z' }),
      debt('d', { archivedAt: '2026-10-01T00:00:00.000Z' }),
      debt('e', { remainingMinor: 0 }),
    ];
    expect(ok(computeCashCalendar(input({ debts }))).endMinor).toBe(100_000);
  });

  it('«мне должны» — только если включено; тогда плюс в день срока', () => {
    const debts = [debt('d1', { direction: 'lent', remainingMinor: 15_000, dueOn: '2026-10-30' })];
    expect(ok(computeCashCalendar(input({ debts }))).endMinor).toBe(100_000);
    const c = ok(computeCashCalendar(input({ debts, includeReceivables: true })));
    expect(day(c, '2026-10-30').events[0]).toMatchObject({ kind: 'debt-receive', deltaMinor: 15_000 });
    expect(c.endMinor).toBe(115_000);
  });

  it('платёж по долгу, уже учтённый остатком, второй раз не вычитается', () => {
    const c = ok(computeCashCalendar(input({ debts: [debt('d1')], rules: [rule('p', { debtId: 'd1', amountMinor: 5_000, startOn: '2026-10-18' })] })));
    expect(c.endMinor).toBe(80_000); // только остаток долга
    // а если долг не попал в окно (срок дальше) — платёж по расписанию считается как обычный
    const c2 = ok(computeCashCalendar(input({ debts: [debt('d1', { dueOn: '2027-01-01' })], rules: [rule('p', { debtId: 'd1', amountMinor: 5_000, startOn: '2026-10-18' })] })));
    expect(c2.endMinor).toBe(95_000);
  });

  it('долг в валюте без курса — не входит, назван', () => {
    const c = ok(computeCashCalendar(input({ debts: [debt('d1', { currency: 'EUR' })] })));
    expect(c.endMinor).toBe(100_000);
    expect(c.skipped).toEqual([{ source: 'debt', currency: 'EUR', amountMinor: 20_000 }]);
  });
});

describe('обычные траты', () => {
  it('каждый день минус обычное; за сегодня — только то, что ещё не потрачено', () => {
    const c = ok(computeCashCalendar(input({ includeUsual: true, usualPerDayMinor: 2_000, spentTodayMinor: 500 })));
    expect(day(c, '2026-10-15')).toMatchObject({ usualMinor: -1_500, balanceMinor: 98_500 });
    expect(day(c, '2026-10-16')).toMatchObject({ usualMinor: -2_000, balanceMinor: 96_500 });
    expect(c.endMinor).toBe(100_000 - 1_500 - 29 * 2_000);
    expect(c.usualApplied).toBe(true);
  });

  it('сегодня потрачено больше обычного — сегодня ничего не вычитается, не прибавляется', () => {
    const c = ok(computeCashCalendar(input({ includeUsual: true, usualPerDayMinor: 2_000, spentTodayMinor: 9_000 })));
    expect(day(c, '2026-10-15').usualMinor).toBe(0);
    expect(Object.is(day(c, '2026-10-15').usualMinor, -0)).toBe(false);
  });

  it('выключено или истории нет — не применяются', () => {
    expect(ok(computeCashCalendar(input({ includeUsual: false, usualPerDayMinor: 2_000 }))).usualApplied).toBe(false);
    const c = ok(computeCashCalendar(input({ includeUsual: true, usualPerDayMinor: null })));
    expect(c.usualApplied).toBe(false);
    expect(c.endMinor).toBe(100_000);
  });

  it('уход в минус: первый день с отрицательным остатком и самый низкий остаток', () => {
    const c = ok(
      computeCashCalendar(
        input({
          balances: new Map([['cash', 5_000]]),
          includeUsual: true,
          usualPerDayMinor: 1_000,
          rules: [rule('salary', { kind: 'income', amountMinor: 50_000, startOn: '2026-11-05' })],
        }),
      ),
    );
    // 5 000 − 1 000 в день (с сегодняшнего): на конец 19 октября 0, на конец 20-го −1 000
    expect(c.firstNegativeDate).toBe('2026-10-20');
    expect(c.minDate).toBe('2026-11-04'); // до зарплаты 5 ноября остаток самый низкий: 21 день обычных трат (15 октября … 4 ноября)
    expect(c.minBalanceMinor).toBe(5_000 - 21 * 1_000);
    expect(day(c, '2026-11-05').balanceMinor).toBe(5_000 - 22 * 1_000 + 50_000);
  });
});

describe('переполнение и свойства', () => {
  it('суммы не помещаются в безопасное целое — status overflow, а не неверное число', () => {
    expect(computeCashCalendar(input({ balances: new Map([['cash', Number.MAX_SAFE_INTEGER]]), rules: [rule('r', { kind: 'income', amountMinor: Number.MAX_SAFE_INTEGER, startOn: '2026-10-16' })] }))).toEqual({ status: 'overflow' });
  });

  it('свойство: остаток на конец = старт + сумма событий + обычные траты; остаток каждого дня — от предыдущего', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(fc.record({ amount: fc.integer({ min: 1, max: 100_000 }), income: fc.boolean(), offset: fc.integer({ min: 0, max: 40 }), weekly: fc.boolean() }), { maxLength: 6 }),
        fc.option(fc.integer({ min: 0, max: 5_000 }), { nil: null }),
        fc.integer({ min: 0, max: 3_000 }),
        (start, items, usual, spent) => {
          const rules = items.map((it, i) =>
            rule(`r${i}`, {
              kind: it.income ? 'income' : 'expense',
              amountMinor: it.amount,
              frequency: it.weekly ? 'weekly' : 'monthly',
              startOn: new Date(Date.UTC(2026, 9, 15 + it.offset)).toISOString().slice(0, 10),
            }),
          );
          const c = computeCashCalendar(input({ balances: new Map([['cash', start]]), rules, includeUsual: true, usualPerDayMinor: usual, spentTodayMinor: spent }));
          if (c.status !== 'ok') return false;
          let balance = c.startMinor;
          for (const d of c.days) {
            balance += d.eventsMinor + d.usualMinor;
            if (d.balanceMinor !== balance) return false;
          }
          const total = c.days.reduce((s, d) => s + d.eventsMinor + d.usualMinor, 0);
          return c.endMinor === c.startMinor + total && c.minBalanceMinor === Math.min(...c.days.map((d) => d.balanceMinor));
        },
      ),
      { numRuns: 300 },
    );
  });
});
