import { describe, expect, it } from 'vitest';
import { computeDebtState } from '@/domain/debts';
import type { Debt, LocalRow } from '@/domain/types';
import { foldGroups, groupDebts, remainingByCurrency, type DebtItem } from './debtSummary';
import { findMatchingDebts } from './debtMatch';
import { planNetting } from './netting';

let n = 0;
const wallets = new Map([['w', { currency: 'TJS' }]]);

/** Долг для проверок: платежи — суммы возврата (для «мне должны» это доходы в кошелёк w). */
function item(over: Partial<Debt> = {}, payments: number[] = []): DebtItem {
  const id = over.id ?? `debt-${++n}`;
  const debt = {
    id,
    direction: 'lent',
    counterparty: 'Али',
    principalMinor: 50_000,
    interestMinor: null,
    interestRateBp: null,
    termMonths: null,
    mergedIntoId: null,
    currency: 'TJS',
    openedOn: '2026-10-01',
    dueOn: null,
    note: '',
    closedAt: null,
    archivedAt: null,
    deletedAt: null,
    ...over,
  } as LocalRow<Debt>;
  const txs = payments.map((amountMinor, i) => ({
    id: `${id}-p${i}`,
    kind: 'income' as const,
    walletId: 'w',
    amountMinor,
    occurredOn: '2026-10-05',
    createdAt: `2026-10-05T10:00:00.${String(i).padStart(3, '0')}Z`,
    deletedAt: null,
    debtId: id,
  }));
  return { debt, state: computeDebtState(debt, txs, wallets) };
}

describe('foldGroups: объединённый долг одним элементом списка', () => {
  const main = () => item({ id: 'main', principalMinor: 40_000, interestMinor: 5_000, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-05', dueOn: '2026-11-20' }, [10_000]);
  const part = () => item({ id: 'part', mergedIntoId: 'main', principalMinor: 30_000, openedOn: '2026-10-01', dueOn: '2026-11-10' }, [5_000]);

  it('составляющие из списка уходят, у главного долга итог по частям, а свои долги частей лежат в parts (главный первым)', () => {
    const folded = foldGroups([main(), part()]);
    expect(folded).toHaveLength(1);
    const g = folded[0]!;
    expect(g.debt.id).toBe('main');
    expect(g.parts!.map((p) => p.debt.id)).toEqual(['main', 'part']);
    expect(g.state).toMatchObject({ principalMinor: 70_000, interestMinor: 5_000, totalMinor: 75_000, paidMinor: 15_000, remainingMinor: 60_000, settled: false });
    expect(g.debt).toMatchObject({ principalMinor: 70_000, interestMinor: 5_000, openedOn: '2026-10-01', dueOn: '2026-11-10' });
  });

  it('у частей остаются свои условия: исходные долги в parts не тронуты', () => {
    const g = foldGroups([main(), part()])[0]!;
    expect(g.parts![0]!.debt).toMatchObject({ principalMinor: 40_000, interestRateBp: 2400, termMonths: 12, dueOn: '2026-11-20' });
    expect(g.parts![1]!.debt).toMatchObject({ principalMinor: 30_000, interestMinor: null, dueOn: '2026-11-10' });
    expect(g.parts![0]!.state).toMatchObject({ remainingMinor: 35_000 });
    expect(g.parts![1]!.state).toMatchObject({ remainingMinor: 25_000 });
  });

  it('ставка и срок у итога остаются, только если процентами обложены все части и условия одинаковые', () => {
    const a = item({ id: 'a', interestMinor: 1_000, interestRateBp: 2400, termMonths: 12 });
    const same = item({ id: 'b', mergedIntoId: 'a', interestMinor: 2_000, interestRateBp: 2400, termMonths: 12 });
    expect(foldGroups([a, same])[0]!.debt).toMatchObject({ interestMinor: 3_000, interestRateBp: 2400, termMonths: 12 });
    const other = item({ id: 'c', mergedIntoId: 'a', interestMinor: 2_000, interestRateBp: 1200, termMonths: 6 });
    expect(foldGroups([a, other])[0]!.debt).toMatchObject({ interestMinor: 3_000, interestRateBp: null, termMonths: null });
    const plain = item({ id: 'd', mergedIntoId: 'a' });
    expect(foldGroups([a, plain])[0]!.debt).toMatchObject({ interestMinor: 1_000, interestRateBp: null, termMonths: null });
  });

  it('итоги по валюте и просрочка считаются по итогу один раз: части не удваиваются', () => {
    const items = foldGroups([main(), part(), item({ id: 'solo', counterparty: 'Бобур', principalMinor: 1_000 })]);
    const totals = remainingByCurrency(items);
    expect(totals).toEqual({ ok: true, totals: [{ currency: 'TJS', minor: 61_000 }] });
  });

  it('срок группы — ближайший среди тех частей, что ещё должны', () => {
    const early = item({ id: 'x', principalMinor: 1_000, dueOn: '2026-10-10' }, [1_000]); // погашена
    const late = item({ id: 'y', mergedIntoId: 'x', principalMinor: 1_000, dueOn: '2026-12-01' });
    expect(foldGroups([early, late])[0]!.debt.dueOn).toBe('2026-12-01');
  });

  it('закрыта одна часть — группа открыта, а её остаток в итог не входит; закрыты все — группа закрыта', () => {
    const closedAt = '2026-10-20T00:00:00.000Z';
    const a = item({ id: 'a', principalMinor: 20_000 });
    const b = item({ id: 'b', mergedIntoId: 'a', principalMinor: 30_000, closedAt });
    const half = foldGroups([a, b])[0]!;
    expect(half.debt.closedAt).toBeNull();
    expect(half.state).toMatchObject({ remainingMinor: 20_000, principalMinor: 50_000 });
    const closedA = item({ id: 'a', principalMinor: 20_000, closedAt });
    const all = foldGroups([closedA, b])[0]!;
    expect(all.debt.closedAt).toBe(closedAt);
    expect(all.state).toMatchObject({ remainingMinor: 50_000 });
  });

  it('списки: группа попадает во вкладку по итогу — «Погашены», когда погашены все части', () => {
    const a = item({ id: 'a', principalMinor: 10_000 }, [10_000]);
    const b = item({ id: 'b', mergedIntoId: 'a', principalMinor: 5_000 }, [5_000]);
    const g = groupDebts(foldGroups([a, b]), 'lent');
    expect(g.settled.map((x) => x.debt.id)).toEqual(['a']);
    expect(g.active).toEqual([]);
  });

  it('связь, которая не действует (главного нет, другая валюта), игнорируется: долг виден сам по себе', () => {
    const orphan = item({ id: 'o', mergedIntoId: 'ghost' });
    const usd = item({ id: 'u', mergedIntoId: 'a', currency: 'USD' });
    const a = item({ id: 'a' });
    expect(foldGroups([a, orphan, usd]).map((x) => x.debt.id).sort()).toEqual(['a', 'o', 'u']);
  });

  it('переполнение суммы у одной части — у группы нет расчёта (null), а не неверное число', () => {
    const a = item({ id: 'a' });
    const b = { ...item({ id: 'b', mergedIntoId: 'a' }), state: null };
    expect(foldGroups([a, b])[0]!.state).toBeNull();
  });

  it('пополнять и зачитывать объединённый долг нельзя: он не предлагается «добавить ещё» и не участвует во взаимозачёте', () => {
    const folded = foldGroups([main(), part()]);
    expect(findMatchingDebts(folded, { direction: 'lent', currency: 'TJS', counterparty: 'Али' })).toEqual([]);
    const borrowed = item({ direction: 'borrowed', principalMinor: 10_000 });
    expect(planNetting([...folded, borrowed], 'TJS')).toBeNull();
    // а отдельный долг тому же человеку — участвует
    const lone = item({ principalMinor: 10_000 });
    expect(planNetting([lone, borrowed], 'TJS')).not.toBeNull();
  });
});
