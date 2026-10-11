import { describe, expect, it } from 'vitest';
import type { Debt, LocalRow, Transaction, Wallet } from '@/domain/types';
import {
  buildDebtItems,
  compareDebts,
  groupDebts,
  isOwing,
  nearestDue,
  overdueCount,
  remainingByCurrency,
} from './debtSummary';

type D = Pick<Debt, 'id' | 'direction' | 'counterparty' | 'principalMinor' | 'currency' | 'openedOn' | 'dueOn' | 'closedAt' | 'archivedAt' | 'deletedAt'>;

const debt = (over: Partial<D> & Pick<D, 'id'>): LocalRow<Debt> =>
  ({
    direction: 'lent',
    counterparty: over.id,
    principalMinor: 100_000,
    currency: 'TJS',
    openedOn: '2026-10-01',
    dueOn: null,
    note: '',
    closedAt: null,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    clientUpdatedAt: '2026-10-01T00:00:00.000Z',
    deviceId: 'd',
    deletedAt: null,
    dirty: 0,
    serverSeq: null,
    syncError: null,
    ...over,
  }) as LocalRow<Debt>;

const pay = (id: string, debtId: string, amountMinor: number, over: Partial<Transaction> = {}) =>
  ({
    id,
    kind: 'income' as const,
    walletId: 'w-tjs',
    amountMinor,
    occurredOn: '2026-10-05',
    createdAt: '2026-10-05T00:00:00.000Z',
    deletedAt: null,
    debtId,
    ...over,
  }) satisfies Pick<Transaction, 'id' | 'kind' | 'walletId' | 'amountMinor' | 'occurredOn' | 'createdAt' | 'deletedAt' | 'debtId'>;

const wallets = new Map<string, Pick<Wallet, 'currency'>>([
  ['w-tjs', { currency: 'TJS' }],
  ['w-usd', { currency: 'USD' }],
]);

describe('buildDebtItems: остатки из операций', () => {
  it('остаток = сумма долга минус платежи; чужие и удалённые операции не считаются', () => {
    const items = buildDebtItems(
      [debt({ id: 'a' }), debt({ id: 'b' })],
      [pay('p1', 'a', 30_000), pay('p2', 'a', 10_000, { deletedAt: '2026-10-06T00:00:00.000Z' }), pay('p3', 'b', 5_000)],
      wallets,
    );
    expect(items.find((i) => i.debt.id === 'a')?.state?.remainingMinor).toBe(70_000);
    expect(items.find((i) => i.debt.id === 'b')?.state?.remainingMinor).toBe(95_000);
  });

  it('пусто: нет долгов — нет строк; долг без операций — полный остаток', () => {
    expect(buildDebtItems([], [], wallets)).toEqual([]);
    expect(buildDebtItems([debt({ id: 'a' })], [], wallets)[0]?.state?.remainingMinor).toBe(100_000);
  });

  it('удалённый долг в список не попадает', () => {
    expect(buildDebtItems([debt({ id: 'a', deletedAt: '2026-10-02T00:00:00.000Z' })], [], wallets)).toEqual([]);
  });

  it('переполнение одного долга не роняет остальные: у него state === null', () => {
    const big = 4_000_000_000_000_000; // 4e15: две таких суммы выходят за безопасное целое
    const items = buildDebtItems(
      [debt({ id: 'big', principalMinor: 1_000_000_000_000_000 }), debt({ id: 'ok' })],
      [pay('x1', 'big', big), pay('x2', 'big', big), pay('x3', 'big', big)],
      wallets,
    );
    expect(items.find((i) => i.debt.id === 'big')?.state).toBeNull();
    expect(items.find((i) => i.debt.id === 'ok')?.state?.remainingMinor).toBe(100_000);
  });

  it('платёж в кошельке другой валюты в остаток не входит и попадает в issues', () => {
    const [it] = buildDebtItems([debt({ id: 'a' })], [pay('p1', 'a', 30_000, { walletId: 'w-usd' })], wallets);
    expect(it?.state?.remainingMinor).toBe(100_000);
    expect(it?.state?.issues).toHaveLength(1);
  });
});

describe('compareDebts и groupDebts', () => {
  it('открытые раньше закрытых, по сроку (без срока в конце), затем новые сверху', () => {
    const rows = [
      debt({ id: 'nodue', dueOn: null }),
      debt({ id: 'closed', closedAt: '2026-10-09T00:00:00.000Z', dueOn: '2026-10-01' }),
      debt({ id: 'late', dueOn: '2026-11-30' }),
      debt({ id: 'soon', dueOn: '2026-10-20' }),
    ];
    expect([...rows].sort(compareDebts).map((d) => d.id)).toEqual(['soon', 'late', 'nodue', 'closed']);
  });

  it('группы: открытые / закрытые / архив, по направлению', () => {
    const items = buildDebtItems(
      [
        debt({ id: 'l1' }),
        debt({ id: 'l2', closedAt: '2026-10-09T00:00:00.000Z' }),
        debt({ id: 'l3', archivedAt: '2026-10-09T00:00:00.000Z' }),
        debt({ id: 'b1', direction: 'borrowed' }),
      ],
      [],
      wallets,
    );
    const lent = groupDebts(items, 'lent');
    expect(lent.active.map((i) => i.debt.id)).toEqual(['l1']);
    expect(lent.closed.map((i) => i.debt.id)).toEqual(['l2']);
    expect(lent.archived.map((i) => i.debt.id)).toEqual(['l3']);
    expect(groupDebts(items, 'borrowed').active.map((i) => i.debt.id)).toEqual(['b1']);
  });
});

describe('итоги по валютам', () => {
  it('каждая валюта отдельно, основная первой, закрытые и архивные не считаются', () => {
    const items = buildDebtItems(
      [
        debt({ id: 'a', principalMinor: 50_000 }),
        debt({ id: 'b', principalMinor: 70_000 }),
        debt({ id: 'c', principalMinor: 20_000, currency: 'USD' }),
        debt({ id: 'd', principalMinor: 99_999, closedAt: '2026-10-09T00:00:00.000Z' }),
        debt({ id: 'e', principalMinor: 88_888, archivedAt: '2026-10-09T00:00:00.000Z' }),
      ],
      [pay('p', 'a', 10_000)],
      wallets,
    );
    expect(remainingByCurrency(items, 'TJS')).toEqual({
      ok: true,
      totals: [
        { currency: 'TJS', minor: 110_000 }, // 40 000 + 70 000
        { currency: 'USD', minor: 20_000 },
      ],
    });
    expect(remainingByCurrency(items, 'USD')).toMatchObject({ totals: [{ currency: 'USD' }, { currency: 'TJS' }] });
  });

  it('пусто — пустой список, а не ноль', () => {
    expect(remainingByCurrency([], 'TJS')).toEqual({ ok: true, totals: [] });
  });

  it('полностью погашенный долг в итог не входит (остаток 0)', () => {
    const items = buildDebtItems([debt({ id: 'a', principalMinor: 1000 })], [pay('p', 'a', 1000)], wallets);
    expect(isOwing(items[0]!)).toBe(false);
    expect(remainingByCurrency(items, 'TJS')).toEqual({ ok: true, totals: [] });
  });

  it('сумма не помещается в безопасное целое — ok: false, а не неверное число', () => {
    const items = buildDebtItems(
      Array.from({ length: 10 }, (_, i) => debt({ id: `d${i}`, principalMinor: 1_000_000_000_000_000 })),
      [],
      wallets,
    );
    expect(remainingByCurrency(items, 'TJS')).toEqual({ ok: false });
  });
});

describe('просрочка и ближайший срок', () => {
  const items = buildDebtItems(
    [
      debt({ id: 'late', dueOn: '2026-10-10' }),
      debt({ id: 'today', dueOn: '2026-10-15' }),
      debt({ id: 'later', dueOn: '2026-12-01' }),
      debt({ id: 'paid', dueOn: '2026-09-01', principalMinor: 1000 }),
      debt({ id: 'closed', dueOn: '2026-09-01', closedAt: '2026-10-09T00:00:00.000Z' }),
    ],
    [pay('p', 'paid', 1000)],
    wallets,
  );
  it('просрочен только тот, у кого срок строго раньше сегодня и остаток есть', () => {
    expect(overdueCount(items, '2026-10-15')).toBe(1);
    expect(overdueCount(items, '2026-10-16')).toBe(2);
    expect(overdueCount(items, '2026-10-10')).toBe(0);
  });
  it('ближайший срок: просроченный раньше всех; погашенные и закрытые не в счёт', () => {
    expect(nearestDue(items)?.debt.id).toBe('late');
    expect(nearestDue(items.filter((i) => i.debt.id === 'paid' || i.debt.id === 'closed'))).toBeNull();
    expect(nearestDue([])).toBeNull();
  });
});
