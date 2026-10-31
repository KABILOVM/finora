import { describe, expect, it } from 'vitest';
import type { Debt, LocalRow } from '@/domain/types';
import { computeDebtState } from '@/domain/debts';
import { findMatchingDebts, mergeCandidates, mergePreview, normName } from './debtMatch';
import type { DebtItem } from './debtSummary';

let n = 0;
const wallets = new Map([['w', { currency: 'TJS' }]]);

/** Долг для проверок: платежи — суммы возврата (для «мне должны» это доходы в кошелёк w). */
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

describe('normName: один и тот же человек', () => {
  it.each([
    ['Алишер', 'алишер'],
    ['  АЛИШЕР  ', 'алишер'],
    ['Али   шер', 'али шер'],
    ['Алишёр', 'алишер'],
    ['ЁЖИК', 'ежик'],
  ])('%s → %s', (input, expected) => expect(normName(input)).toBe(expected));
  it('пустое и из пробелов — пустая строка', () => {
    expect(normName('')).toBe('');
    expect(normName(' \n\t ')).toBe('');
  });
  it('разные люди — разные имена', () => {
    expect(normName('Али')).not.toBe(normName('Алишер'));
  });
});

describe('findMatchingDebts', () => {
  const q = { direction: 'lent', currency: 'TJS', counterparty: 'алишёр' } as const;

  it('находит того же человека того же направления и валюты', () => {
    const a = item();
    expect(findMatchingDebts([a], q)).toEqual([a]);
  });
  it('другое направление, другая валюта, другой человек — не находит', () => {
    expect(findMatchingDebts([item({ direction: 'borrowed' })], q)).toEqual([]);
    expect(findMatchingDebts([item({ currency: 'USD' })], q)).toEqual([]);
    expect(findMatchingDebts([item({ counterparty: 'Алишер Каримов' })], q)).toEqual([]);
  });
  it('архивные и удалённые не предлагаются, закрытые — да', () => {
    const closed = item({ closedAt: '2026-10-05T00:00:00.000Z' });
    expect(findMatchingDebts([item({ archivedAt: '2026-10-05T00:00:00.000Z' }), item({ deletedAt: '2026-10-05T00:00:00.000Z' }), closed], q)).toEqual([closed]);
  });
  it('долг, сумму которого не удалось посчитать (переполнение), не предлагается', () => {
    expect(findMatchingDebts([{ ...item(), state: null }], q)).toEqual([]);
  });
  it('пустое имя не совпадает ни с чем', () => {
    expect(findMatchingDebts([item({ counterparty: ' ' })], { ...q, counterparty: '  ' })).toEqual([]);
  });
  it('порядок сохраняется (как в списке долгов)', () => {
    const [a, b] = [item(), item({ counterparty: 'АЛИШЕР' })];
    expect(findMatchingDebts([a, b], q)).toEqual([a, b]);
  });
});

describe('mergeCandidates', () => {
  it('того же направления и валюты, кроме самого долга; одноимённые первыми', () => {
    const target = item();
    const other = item({ counterparty: 'Бобур' });
    const same = item({ counterparty: 'алишер' });
    const candidates = mergeCandidates([target, other, same], target.debt);
    expect(candidates.map((c) => [c.item, c.sameName])).toEqual([
      [same, true],
      [other, false],
    ]);
  });
  it('другое направление, другая валюта, архив и удалённые — не кандидаты', () => {
    const target = item();
    const nope = [
      item({ direction: 'borrowed' }),
      item({ currency: 'USD' }),
      item({ archivedAt: '2026-10-05T00:00:00.000Z' }),
      item({ deletedAt: '2026-10-05T00:00:00.000Z' }),
    ];
    expect(mergeCandidates([target, ...nope], target.debt)).toEqual([]);
  });
});

describe('mergePreview', () => {
  it('сумма, оплачено и остаток складываются; срок — ближайший', () => {
    const a = item({ principalMinor: 40_000, dueOn: '2026-11-20' }, [10_000]);
    const b = item({ principalMinor: 30_000, dueOn: '2026-11-10' }, [5_000, 5_000]);
    expect(mergePreview([a, b])).toEqual({
      principalMinor: 70_000,
      interestMinor: 0,
      paidMinor: 20_000,
      remainingMinor: 50_000,
      overpaidMinor: 0,
      dueOn: '2026-11-10',
      netted: false,
    });
  });
  it('проценты складываются, остаток считается от «сумма + проценты»', () => {
    const a = item({ principalMinor: 40_000, interestMinor: 4_000 }, [10_000]);
    const b = item({ principalMinor: 30_000, interestMinor: 6_000 }, [5_000]);
    expect(mergePreview([a, b])).toMatchObject({ principalMinor: 70_000, interestMinor: 10_000, paidMinor: 15_000, remainingMinor: 65_000, overpaidMinor: 0, netted: false });
  });
  it('сроков нет — null; срок есть у одного — он', () => {
    expect(mergePreview([item(), item()])!.dueOn).toBeNull();
    expect(mergePreview([item(), item({ dueOn: '2026-12-01' })])!.dueOn).toBe('2026-12-01');
  });
  it('переплата одного долга засчитывается в остаток другого, и об этом сказано (netted)', () => {
    const a = item({ principalMinor: 50_000 }, []);
    const b = item({ principalMinor: 10_000 }, [15_000]); // переплата 50
    expect(mergePreview([a, b])).toMatchObject({ principalMinor: 60_000, paidMinor: 15_000, remainingMinor: 45_000, overpaidMinor: 0, netted: true });
  });
  it('переплата больше остатка остальных — общая переплата, остаток 0', () => {
    const a = item({ principalMinor: 5_000 }, []);
    const b = item({ principalMinor: 10_000 }, [30_000]);
    expect(mergePreview([a, b])).toMatchObject({ remainingMinor: 0, overpaidMinor: 15_000, netted: true });
  });
  it('совпадает с computeDebtState по общему набору операций', () => {
    const a = item({ principalMinor: 40_000 }, [10_000, 2_000]);
    const b = item({ principalMinor: 30_000 }, [7_000]);
    const txs = ['a', 'b'].flatMap((k, i) =>
      [[10_000, 2_000], [7_000]][i]!.map((amountMinor, j) => ({
        id: `${k}${j}`,
        kind: 'income' as const,
        walletId: 'w',
        amountMinor,
        occurredOn: '2026-10-05',
        createdAt: '2026-10-05T10:00:00.000Z',
        deletedAt: null,
        debtId: 'merged',
      })),
    );
    const whole = computeDebtState({ id: 'merged', direction: 'lent', principalMinor: 70_000, currency: 'TJS' }, txs, wallets);
    expect(mergePreview([a, b])).toMatchObject({ paidMinor: whole.paidMinor, remainingMinor: whole.remainingMinor, overpaidMinor: whole.overpaidMinor });
  });
  it('суммы не помещаются в безопасное целое — null, а не неверное число', () => {
    const big = { ...item(), state: { ...item().state!, principalMinor: Number.MAX_SAFE_INTEGER } };
    expect(mergePreview([big, { ...big }])).toBeNull();
  });
  it('у одного из долгов нет расчёта — null', () => {
    expect(mergePreview([item(), { ...item(), state: null }])).toBeNull();
  });
});
