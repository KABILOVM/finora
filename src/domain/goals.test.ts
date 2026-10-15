import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ceilDiv, compareGoals, goalProgress, NUDGE_FROM_DAY, savingNudge, walletNetFlow, wholeMonthsBetween, type FlowTx } from './goals';

const TODAY = '2026-10-15';
const prog = (balanceMinor: number, goalMinor: number, goalOn: string | null = null, today = TODAY) => goalProgress({ balanceMinor, goalMinor, goalOn, today });

describe('goalProgress: сколько накоплено', () => {
  it('процент вниз; цель достигнута — 100 и «осталось 0»', () => {
    expect(prog(0, 1000)).toMatchObject({ percent: 0, remainingMinor: 1000, reached: false });
    expect(prog(500, 1000)).toMatchObject({ percent: 50, remainingMinor: 500 });
    expect(prog(999, 1000)).toMatchObject({ percent: 99, remainingMinor: 1, reached: false });
    expect(prog(1000, 1000)).toMatchObject({ percent: 100, remainingMinor: 0, reached: true });
    expect(prog(1500, 1000)).toMatchObject({ percent: 100, remainingMinor: 0, reached: true });
  });

  it('остаток кошелька отрицательный — 0%, осталось цель плюс долг кошелька', () => {
    expect(prog(-200, 1000)).toMatchObject({ percent: 0, remainingMinor: 1200, reached: false });
  });

  it('большие суммы не теряют точность: 1e15−1 из 1e15 — это 99%, а не 100%', () => {
    const big = 1_000_000_000_000_000;
    expect(prog(big - 1, big)).toMatchObject({ percent: 99, reached: false, remainingMinor: 1 });
    expect(prog(Math.floor(big / 3), big).percent).toBe(33);
  });

  it('без срока: ни дней, ни месяцев, ни «в месяц»', () => {
    expect(prog(100, 1000)).toMatchObject({ daysLeft: null, overdue: false, monthsLeft: null, perMonthMinor: null });
  });

  it('срок впереди: дни, месяцы (не меньше одного) и «откладывать в месяц» — вверх', () => {
    expect(prog(0, 1000, '2026-10-16')).toMatchObject({ daysLeft: 1, monthsLeft: 1, perMonthMinor: 1000 });
    expect(prog(0, 1000, '2026-10-15')).toMatchObject({ daysLeft: 0, overdue: false, monthsLeft: 1, perMonthMinor: 1000 }); // срок сегодня
    expect(prog(0, 1000, '2027-01-15')).toMatchObject({ daysLeft: 92, monthsLeft: 3, perMonthMinor: 334 }); // 1000 ÷ 3 вверх
    expect(prog(250, 1000, '2027-01-15')).toMatchObject({ monthsLeft: 3, perMonthMinor: 250 });
  });

  it('срок прошёл: просрочено, месяцев и «в месяц» нет; достигнутая цель — не просрочена', () => {
    expect(prog(100, 1000, '2026-10-14')).toMatchObject({ daysLeft: -1, overdue: true, monthsLeft: null, perMonthMinor: null });
    expect(prog(1000, 1000, '2026-10-14')).toMatchObject({ overdue: false, reached: true });
  });

  it('цель достигнута, срок впереди: «в месяц» не нужно', () => {
    expect(prog(1000, 1000, '2027-01-15')).toMatchObject({ reached: true, monthsLeft: null, perMonthMinor: null });
  });

  it('свойство: процент 0…100 и растёт с остатком; «в месяц» покрывает остаток и не больше чем на один месяц сверх', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 5_000_000 }), fc.integer({ min: 1, max: 5_000_000 }), fc.integer({ min: 0, max: 800 }), (balance, goal, days) => {
        const date = new Date(Date.UTC(2026, 9, 15 + days)).toISOString().slice(0, 10);
        const p = prog(balance, goal, date);
        expect(p.percent).toBeGreaterThanOrEqual(0);
        expect(p.percent).toBeLessThanOrEqual(100);
        expect(prog(balance + 1, goal, date).percent).toBeGreaterThanOrEqual(p.percent);
        if (p.monthsLeft !== null && p.perMonthMinor !== null) {
          expect(p.perMonthMinor * p.monthsLeft).toBeGreaterThanOrEqual(p.remainingMinor);
          expect((p.perMonthMinor - 1) * p.monthsLeft).toBeLessThan(p.remainingMinor);
        }
      }),
    );
  });
});

describe('wholeMonthsBetween и ceilDiv', () => {
  it('календарные месяцы с учётом числа', () => {
    expect(wholeMonthsBetween('2026-10-15', '2026-11-14')).toBe(0);
    expect(wholeMonthsBetween('2026-10-15', '2026-11-15')).toBe(1);
    expect(wholeMonthsBetween('2026-10-15', '2027-10-15')).toBe(12);
    expect(wholeMonthsBetween('2028-01-31', '2028-02-29')).toBe(0); // 29 февраля — ещё не «31-е следующего месяца»
    expect(wholeMonthsBetween('2026-12-20', '2027-01-20')).toBe(1);
  });
  it('ceilDiv', () => {
    expect(ceilDiv(0, 3)).toBe(0);
    expect(ceilDiv(1, 3)).toBe(1);
    expect(ceilDiv(9, 3)).toBe(3);
    expect(ceilDiv(10, 3)).toBe(4);
    expect(ceilDiv(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(ceilDiv(-5, 3)).toBe(0);
  });
  it('свойство: ceilDiv как Math.ceil на малых числах', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 1000 }), (a, b) => ceilDiv(a, b) === Math.ceil(a / b)));
  });
});

describe('walletNetFlow: сколько пришло на кошелёк за период', () => {
  const tx = (over: Partial<FlowTx>): FlowTx => ({ kind: 'income', walletId: 'w', toWalletId: null, amountMinor: 100, toAmountMinor: null, occurredOn: '2026-10-10', deletedAt: null, ...over });
  const flow = (txs: FlowTx[]) => walletNetFlow('w', txs, '2026-10-01', '2026-10-31');

  it('доходы и переводы на кошелёк плюс, расходы и переводы с него минус', () => {
    expect(
      flow([
        tx({ kind: 'income', amountMinor: 500 }),
        tx({ kind: 'expense', amountMinor: 120 }),
        tx({ kind: 'transfer', walletId: 'other', toWalletId: 'w', amountMinor: 1000, toAmountMinor: 900 }), // с обменом/комиссией: зачислено 900
        tx({ kind: 'transfer', walletId: 'w', toWalletId: 'other', amountMinor: 300, toAmountMinor: 300 }),
      ]),
    ).toBe(500 - 120 + 900 - 300);
  });
  it('чужие кошельки, удалённые, вне периода и с битой суммой не считаются; границы периода включительно', () => {
    expect(
      flow([
        tx({ walletId: 'other', amountMinor: 999 }),
        tx({ deletedAt: '2026-10-11T00:00:00Z', amountMinor: 999 }),
        tx({ occurredOn: '2026-09-30', amountMinor: 999 }),
        tx({ occurredOn: '2026-11-01', amountMinor: 999 }),
        tx({ amountMinor: -5 }),
        tx({ amountMinor: 0 }),
        tx({ occurredOn: '2026-10-01', amountMinor: 7 }),
        tx({ occurredOn: '2026-10-31', amountMinor: 11 }),
      ]),
    ).toBe(18);
  });
  it('перевод без суммы зачисления — на ту же сумму; может быть отрицательным; пусто — 0', () => {
    expect(flow([tx({ kind: 'transfer', walletId: 'o', toWalletId: 'w', amountMinor: 400, toAmountMinor: null })])).toBe(400);
    expect(flow([tx({ kind: 'expense', amountMinor: 50 })])).toBe(-50);
    expect(flow([])).toBe(0);
  });
  it('переполнение — RangeError, а не неверная сумма', () => {
    expect(() => flow([tx({ amountMinor: Number.MAX_SAFE_INTEGER }), tx({ amountMinor: Number.MAX_SAFE_INTEGER })])).toThrow(RangeError);
  });
});

describe('savingNudge: «пора отложить»', () => {
  // цель 1 200 к 15 января; сегодня 15 октября: 3 месяца, остаток 1 000 → нужно 334/мес (первый месяц)
  const p = prog(200, 1200, '2027-01-15');
  it('первая половина месяца — рано', () => {
    expect(savingNudge(p, 0, '2026-10-14')).toBeNull();
    expect(NUDGE_FROM_DAY).toBe(15);
  });
  it('с 15-го и отложено меньше нужного — подсказка; нужное считается от остатка на начало месяца', () => {
    expect(savingNudge(p, 0, '2026-10-15')).toEqual({ savedMinor: 0, neededMinor: 334 });
    // уже отложили 100: остаток на начало месяца 1 000 (сейчас 900 + 100 отложено → balance 300), нужно 334, отложено 100
    const after = prog(300, 1200, '2027-01-15');
    expect(savingNudge(after, 100, '2026-10-20')).toEqual({ savedMinor: 100, neededMinor: 334 });
  });
  it('отложено столько же или больше нужного — тишина', () => {
    const after = prog(534, 1200, '2027-01-15'); // 200 + 334 отложено
    expect(savingNudge(after, 334, '2026-10-25')).toBeNull();
    expect(savingNudge(after, 1000, '2026-10-25')).toBeNull();
  });
  it('отрицательный приход (потратили с накоплений) считается как «ничего не отложено»', () => {
    expect(savingNudge(p, -500, '2026-10-20')).toEqual({ savedMinor: 0, neededMinor: 334 });
  });
  it('цели достигнута, срока нет или он прошёл — тишина', () => {
    expect(savingNudge(prog(1200, 1200, '2027-01-15'), 0, '2026-10-20')).toBeNull();
    expect(savingNudge(prog(0, 1200), 0, '2026-10-20')).toBeNull();
    expect(savingNudge(prog(0, 1200, '2026-10-01'), 0, '2026-10-20')).toBeNull();
  });
  it('последний месяц: нужен весь остаток', () => {
    expect(savingNudge(prog(0, 600, '2026-11-15'), 100, '2026-10-20')).toEqual({ savedMinor: 100, neededMinor: 700 });
  });
});

describe('compareGoals', () => {
  const g = (id: string, goalOn: string | null, percent: number) => ({ id, goalOn, percent });
  it('сначала ближайший срок; без срока — в конце; при равном сроке меньший процент выше; затем по id', () => {
    const sorted = [g('d', null, 10), g('b', '2027-01-01', 50), g('a', '2026-12-01', 90), g('c', '2027-01-01', 20), g('e', '2027-01-01', 20)].sort(compareGoals);
    expect(sorted.map((x) => x.id)).toEqual(['a', 'c', 'e', 'b', 'd']);
  });
});
