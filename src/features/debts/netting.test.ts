import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeDebtState } from '@/domain/debts';
import type { Debt, LocalRow } from '@/domain/types';
import type { DebtItem } from './debtSummary';
import { nettableCurrencies, planNetting } from './netting';
import { groupByPerson } from './people';

let n = 0;
const wallets = new Map([['w', { currency: 'TJS' }]]);

function item(over: Partial<Debt> = {}, payments: number[] = []): DebtItem {
  const id = `debt-${++n}`;
  const debt = {
    id,
    direction: 'lent',
    counterparty: 'Алишер',
    principalMinor: 50_000,
    currency: 'TJS',
    openedOn: '2026-10-01',
    dueOn: null,
    note: '',
    closedAt: null,
    archivedAt: null,
    deletedAt: null,
    ...over,
  } as LocalRow<Debt>;
  const kind = debt.direction === 'lent' ? ('income' as const) : ('expense' as const);
  const txs = payments.map((amountMinor, i) => ({
    id: `${id}-p${i}`,
    kind,
    walletId: 'w',
    amountMinor,
    occurredOn: '2026-10-05',
    createdAt: `2026-10-05T10:00:00.${String(i).padStart(3, '0')}Z`,
    deletedAt: null,
    debtId: id,
  }));
  return { debt, state: computeDebtState(debt, txs, wallets) };
}
const id = (it: DebtItem) => it.debt.id;

describe('planNetting', () => {
  it('один «мне должны» 500 и один «я должен» 200: зачтём 200; долг мне станет 300, мой — 0', () => {
    const l = item({ principalMinor: 50_000 });
    const b = item({ direction: 'borrowed', principalMinor: 20_000 });
    const plan = planNetting([l, b], 'TJS')!;
    expect(plan.steps).toEqual([{ lentId: id(l), borrowedId: id(b), amountMinor: 20_000 }]);
    expect(plan.totalMinor).toBe(20_000);
    expect(plan.after.get(id(l))).toBe(30_000);
    expect(plan.after.get(id(b))).toBe(0);
  });

  it('наоборот: я должен больше — гасится долг мне', () => {
    const l = item({ principalMinor: 10_000 });
    const b = item({ direction: 'borrowed', principalMinor: 40_000 });
    const plan = planNetting([l, b], 'TJS')!;
    expect(plan.totalMinor).toBe(10_000);
    expect(plan.after.get(id(l))).toBe(0);
    expect(plan.after.get(id(b))).toBe(30_000);
  });

  it('равные суммы — оба долга гасятся целиком', () => {
    const l = item({ principalMinor: 7_000 });
    const b = item({ direction: 'borrowed', principalMinor: 7_000 });
    const plan = planNetting([l, b], 'TJS')!;
    expect(plan.steps).toHaveLength(1);
    expect([...plan.after.values()]).toEqual([0, 0]);
  });

  it('несколько долгов: идём по порядку списка, меньшая сторона гасится целиком, пары не пересекаются дважды', () => {
    const l1 = item({ principalMinor: 30_000 });
    const l2 = item({ principalMinor: 50_000 });
    const b1 = item({ direction: 'borrowed', principalMinor: 20_000 });
    const b2 = item({ direction: 'borrowed', principalMinor: 40_000 });
    const plan = planNetting([l1, l2, b1, b2], 'TJS')!;
    expect(plan.steps).toEqual([
      { lentId: id(l1), borrowedId: id(b1), amountMinor: 20_000 },
      { lentId: id(l1), borrowedId: id(b2), amountMinor: 10_000 },
      { lentId: id(l2), borrowedId: id(b2), amountMinor: 30_000 },
    ]);
    expect(plan.totalMinor).toBe(60_000);
    expect(plan.after.get(id(l1))).toBe(0);
    expect(plan.after.get(id(l2))).toBe(20_000);
    expect(plan.after.get(id(b1))).toBe(0);
    expect(plan.after.get(id(b2))).toBe(0);
  });

  it('считается остаток, а не сумма долга: платёж уже уменьшил долг', () => {
    const l = item({ principalMinor: 50_000 }, [45_000]);
    const b = item({ direction: 'borrowed', principalMinor: 20_000 });
    expect(planNetting([l, b], 'TJS')!.totalMinor).toBe(5_000);
  });

  it('другая валюта не зачитывается', () => {
    const l = item({ principalMinor: 50_000 });
    const b = item({ direction: 'borrowed', principalMinor: 20_000, currency: 'USD' });
    expect(planNetting([l, b], 'TJS')).toBeNull();
    expect(planNetting([l, b], 'USD')).toBeNull();
  });

  it('нет второй стороны, закрытый, архивный, погашенный и «без суммы» долги — зачитывать нечего', () => {
    const l = item();
    expect(planNetting([l], 'TJS')).toBeNull();
    expect(planNetting([l, item({ direction: 'borrowed', closedAt: '2026-10-03T00:00:00Z' })], 'TJS')).toBeNull();
    expect(planNetting([l, item({ direction: 'borrowed', archivedAt: '2026-10-03T00:00:00Z' })], 'TJS')).toBeNull();
    expect(planNetting([l, item({ direction: 'borrowed', principalMinor: 100 }, [100])], 'TJS')).toBeNull();
    expect(planNetting([l, { ...item({ direction: 'borrowed' }), state: null }], 'TJS')).toBeNull();
  });

  it('nettableCurrencies: только валюты, где есть обе стороны', () => {
    const person = groupByPerson([
      item({ principalMinor: 5_000 }),
      item({ direction: 'borrowed', principalMinor: 3_000 }),
      item({ currency: 'USD', principalMinor: 100 }),
    ])[0]!;
    expect(nettableCurrencies(person).map((t) => t.currency)).toEqual(['TJS']);
  });

  it('свойство: зачтено ровно min(Σ мне должны, Σ я должен); никто не уходит в минус; меньшая сторона обнуляется', () => {
    const side = fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(side, side, (lentSums, borrowedSums) => {
        const lent = lentSums.map((p) => item({ principalMinor: p }));
        const borrowed = borrowedSums.map((p) => item({ direction: 'borrowed', principalMinor: p }));
        const plan = planNetting([...lent, ...borrowed], 'TJS')!;
        const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
        const expected = Math.min(sum(lentSums), sum(borrowedSums));
        expect(plan.totalMinor).toBe(expected);
        expect(plan.steps.reduce((a, s) => a + s.amountMinor, 0)).toBe(expected);
        for (const s of plan.steps) expect(s.amountMinor).toBeGreaterThan(0);
        for (const d of [...lent, ...borrowed]) expect(plan.after.get(id(d))!).toBeGreaterThanOrEqual(0);
        const lentAfter = sum(lent.map((d) => plan.after.get(id(d))!));
        const borrowedAfter = sum(borrowed.map((d) => plan.after.get(id(d))!));
        expect(lentAfter).toBe(sum(lentSums) - expected);
        expect(borrowedAfter).toBe(sum(borrowedSums) - expected);
        expect(Math.min(lentAfter, borrowedAfter)).toBe(0);
      }),
    );
  });
});
