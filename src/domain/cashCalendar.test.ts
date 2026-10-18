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

describe('просроченные платежи', () => {
  it('без overdueFrom прошлые даты не ставятся (как раньше)', () => {
    const c = ok(computeCashCalendar(input({ rules: [rule('rent', { startOn: '2026-10-10' })] })));
    expect(day(c, TODAY).events).toEqual([]);
  });

  it('просроченный расход — одним событием на сегодня, помечен; несколько дат складываются', () => {
    const c = ok(
      computeCashCalendar(
        input({
          rules: [
            rule('rent', { startOn: '2026-10-10', amountMinor: 30_000, overdueFrom: '2026-09-15' }),
            rule('daily', { frequency: 'daily', startOn: '2026-10-12', endOn: '2026-10-14', amountMinor: 1_000, overdueFrom: '2026-10-01' }),
          ],
          labels: new Map([['rent', 'Аренда']]),
        }),
      ),
    );
    const events = day(c, TODAY).events;
    expect(events).toEqual([
      { kind: 'payment', id: 'rent', label: 'Аренда', date: TODAY, deltaMinor: -30_000, overdue: true, overdueCount: 1 },
      { kind: 'payment', id: 'daily', label: 'Платёж', date: TODAY, deltaMinor: -3_000, overdue: true, overdueCount: 3 },
    ]);
    expect(day(c, TODAY).balanceMinor).toBe(67_000);
  });

  it('проведённая или пропущенная прошлая дата и дата раньше overdueFrom не ставятся', () => {
    const c = ok(
      computeCashCalendar(
        input({
          rules: [rule('a', { startOn: '2026-10-10', overdueFrom: '2026-09-15' }), rule('b', { startOn: '2026-10-10', overdueFrom: '2026-10-11' })],
          doneOccurrences: new Set([occurrenceKey('a', '2026-10-10')]),
        }),
      ),
    );
    expect(day(c, TODAY).events).toEqual([]);
  });

  it('просроченный доход не ставится: обещать деньги, которые могут не прийти, нельзя', () => {
    const c = ok(computeCashCalendar(input({ rules: [rule('inc', { kind: 'income', startOn: '2026-10-10', endOn: '2026-10-10', overdueFrom: '2026-09-15' })] })));
    expect(c.days.every((d) => d.events.length === 0)).toBe(true);
    expect(c.endMinor).toBe(100_000);
  });

  it('у правила и просроченная дата, и дата сегодня: два события на сегодня', () => {
    const c = ok(computeCashCalendar(input({ rules: [rule('w', { frequency: 'weekly', startOn: '2026-10-08', amountMinor: 5_000, overdueFrom: '2026-10-01' })] })));
    const events = day(c, TODAY).events;
    expect(events.map((e) => [e.deltaMinor, e.overdue ?? false])).toEqual([
      [-5_000, false],
      [-5_000, true],
    ]);
  });

  it('просроченный платёж по долгу до его срока — сегодня, а в срок отдаётся остаток за его вычетом (второй раз не берётся)', () => {
    const c = ok(computeCashCalendar(input({ debts: [debt('d')], rules: [rule('pay', { debtId: 'd', startOn: '2026-10-10', overdueFrom: '2026-09-15' })] })));
    expect(day(c, TODAY).events.map((e) => [e.kind, e.deltaMinor, e.overdue])).toEqual([['payment', -10_000, true]]);
    expect(day(c, '2026-10-25').events.map((e) => [e.kind, e.deltaMinor])).toEqual([['debt-pay', -10_000]]);
    expect(c.endMinor).toBe(80_000); // весь долг 200 — один раз
  });
});

describe('доходы, которые на руки не придут, и возвраты по долгам', () => {
  it('доход на архивный кошелёк не ставится (его деньги в «деньги на руках» не входят — как и в прогнозе «в день»)', () => {
    const c = ok(
      computeCashCalendar(
        input({
          wallets: [wallet('cash'), wallet('old', { kind: 'card', archivedAt: '2026-01-01T00:00:00.000Z' })],
          rules: [rule('inc', { kind: 'income', walletId: 'old', amountMinor: 50_000, startOn: '2026-10-25' })],
        }),
      ),
    );
    expect(c.days.every((d) => d.events.length === 0)).toBe(true);
    expect(c.endMinor).toBe(c.startMinor);
  });

  it('перевод на архивный кошелёк или с него не случится — с архивным кошельком операцию не провести', () => {
    const wallets = [
      wallet('cash'),
      wallet('box', { kind: 'savings' }),
      wallet('old', { kind: 'card', archivedAt: '2026-01-01T00:00:00.000Z' }),
      wallet('oldBox', { kind: 'savings', archivedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    for (const r of [
      rule('t', { kind: 'transfer', toWalletId: 'old', amountMinor: 5_000 }),
      rule('t', { kind: 'transfer', walletId: 'box', toWalletId: 'old', amountMinor: 5_000 }),
      rule('t', { kind: 'transfer', walletId: 'oldBox', toWalletId: 'cash', amountMinor: 5_000 }),
      rule('t', { kind: 'expense', walletId: 'old', amountMinor: 5_000 }),
    ]) {
      expect(ok(computeCashCalendar(input({ wallets, rules: [r] }))).days.every((d) => d.events.length === 0)).toBe(true);
    }
  });

  it('возврат «мне должны» по расписанию — только ожидание: ставится, лишь когда включено «Мне вернут долги в срок»', () => {
    const debts = [debt('lent', { direction: 'lent', dueOn: null, remainingMinor: 30_000 })];
    const rules = [rule('back', { kind: 'income', debtId: 'lent', amountMinor: 10_000, startOn: '2026-10-25' })];
    expect(ok(computeCashCalendar(input({ debts, rules }))).endMinor).toBe(100_000);
    expect(ok(computeCashCalendar(input({ debts, rules, includeReceivables: true }))).endMinor).toBe(110_000);
  });

  it('«мне должны» к сроку учтено остатком: второй раз не берутся только возвраты МНЕ, а мои выдачи в долг — берутся', () => {
    const c = ok(
      computeCashCalendar(
        input({
          includeReceivables: true,
          debts: [debt('lent', { direction: 'lent', dueOn: '2026-11-05', remainingMinor: 30_000 })],
          rules: [
            rule('give', { kind: 'expense', debtId: 'lent', amountMinor: 10_000, startOn: '2026-10-01', overdueFrom: '2026-09-15' }),
            rule('back', { kind: 'income', debtId: 'lent', amountMinor: 5_000, startOn: '2026-10-25' }),
          ],
        }),
      ),
    );
    const kinds = c.days.flatMap((d) => d.events.map((e) => `${e.kind}:${e.id}:${e.date}`));
    expect(kinds).toEqual(['payment:give:2026-10-15', 'payment:give:2026-11-01', 'debt-receive:lent:2026-11-05']);
  });
});

describe('плановые платежи по долгам — не больше остатка', () => {
  it('«я должен» закрыт (остаток простили) или в архиве, а правило живо — платить нечего', () => {
    for (const d of [debt('d', { dueOn: null, closedAt: '2026-10-01T00:00:00.000Z' }), debt('d', { dueOn: null, archivedAt: '2026-10-01T00:00:00.000Z' })]) {
      const c = ok(computeCashCalendar(input({ debts: [d], rules: [rule('pay', { debtId: 'd', frequency: 'weekly', amountMinor: 5_000, startOn: '2026-10-16' })] })));
      expect(c.endMinor).toBe(100_000);
    }
  });

  it('«я должен»: еженедельные 100 при остатке 200 — два платежа, в срок ничего не осталось', () => {
    const c = ok(
      computeCashCalendar(
        input({
          balances: new Map([['cash', 25_000]]),
          debts: [debt('d', { dueOn: '2026-11-10', remainingMinor: 20_000 })],
          rules: [rule('pay', { debtId: 'd', frequency: 'weekly', amountMinor: 10_000, startOn: '2026-10-20' })],
        }),
      ),
    );
    const events = c.days.flatMap((d) => d.events.map((e) => [e.kind, e.date, e.deltaMinor]));
    expect(events).toEqual([
      ['payment', '2026-10-20', -10_000],
      ['payment', '2026-10-27', -10_000],
    ]);
    expect(c.firstNegativeDate).toBeNull();
  });

  it('долг и его плановый платёж в валюте без курса не называются дважды: 100 $ в платежах + 900 $ в долгах', () => {
    const c = ok(
      computeCashCalendar(
        input({
          getRate: (from, to) => (from === to ? 1 : null),
          wallets: [wallet('cash'), wallet('usd', { currency: 'USD' })],
          balances: new Map([['cash', 100_000], ['usd', 0]]),
          debts: [debt('loan', { currency: 'USD', dueOn: '2026-11-03', remainingMinor: 100_000 })],
          rules: [rule('pay', { walletId: 'usd', debtId: 'loan', amountMinor: 10_000, startOn: '2026-10-25' })],
        }),
      ),
    );
    expect(c.skipped).toEqual([
      { source: 'payment', currency: 'USD', amountMinor: 10_000 },
      { source: 'debt', currency: 'USD', amountMinor: 90_000 },
    ]);
  });

  it('«мне должны»: остаток уходит на возвраты по датам, а не по порядку правил', () => {
    const debts = [debt('lent', { direction: 'lent', dueOn: null, remainingMinor: 30_000 })];
    const late = rule('late', { kind: 'income', debtId: 'lent', amountMinor: 30_000, startOn: '2026-11-10' });
    const early = rule('early', { kind: 'income', debtId: 'lent', amountMinor: 10_000, frequency: 'weekly', startOn: '2026-10-16' });
    for (const rules of [[late, early], [early, late]]) {
      const c = ok(computeCashCalendar(input({ includeReceivables: true, debts, rules })));
      expect(c.days.flatMap((d) => d.events.map((e) => [e.id, e.date]))).toEqual([
        ['early', '2026-10-16'],
        ['early', '2026-10-23'],
        ['early', '2026-10-30'],
      ]);
    }
  });
});

describe('регулярные переводы с комиссией', () => {
  it('между обычными кошельками — минус комиссия; с накоплений — плюс то, что придёт', () => {
    const wallets = [wallet('cash'), wallet('card', { kind: 'card' }), wallet('box', { kind: 'savings' })];
    const fee = ok(computeCashCalendar(input({ wallets, rules: [rule('move', { kind: 'transfer', toWalletId: 'card', amountMinor: 30_000, toAmountMinor: 20_000 })] })));
    expect(day(fee, '2026-10-20').events.map((e) => e.deltaMinor)).toEqual([-10_000]);
    const take = ok(computeCashCalendar(input({ wallets, rules: [rule('take', { kind: 'transfer', walletId: 'box', toWalletId: 'cash', amountMinor: 30_000, toAmountMinor: 20_000 })] })));
    expect(day(take, '2026-10-20').events.map((e) => e.deltaMinor)).toEqual([20_000]);
  });
});

describe('возвраты «мне должны» по расписанию', () => {
  it('по закрытому или погашенному долгу не ждём; больше остатка — тоже', () => {
    const rules = [rule('back', { kind: 'income', debtId: 'lent', amountMinor: 20_000, frequency: 'weekly', startOn: '2026-10-16' })];
    const closed = ok(computeCashCalendar(input({ includeReceivables: true, rules, debts: [debt('lent', { direction: 'lent', dueOn: null, closedAt: '2026-10-01T00:00:00.000Z' })] })));
    expect(closed.endMinor).toBe(100_000);
    const capped = ok(computeCashCalendar(input({ includeReceivables: true, rules, debts: [debt('lent', { direction: 'lent', dueOn: null, remainingMinor: 30_000 })] })));
    expect(capped.endMinor).toBe(130_000); // 200 + 100, а не 200 × 5
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
