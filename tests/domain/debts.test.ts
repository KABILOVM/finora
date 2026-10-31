import { describe, expect, it } from 'vitest';
import { computeDebtState, issueKind, paymentKind, type DebtTx } from '@/domain/debts';

const wallets = new Map([
  ['tjs', { currency: 'TJS' }],
  ['usd', { currency: 'USD' }],
]);
const debt = (over: Partial<Parameters<typeof computeDebtState>[0]> = {}) => ({
  id: 'd1',
  direction: 'lent' as const,
  principalMinor: 100_000,
  currency: 'TJS',
  ...over,
});
let n = 0;
const op = (over: Partial<DebtTx> = {}): DebtTx => ({
  id: `t${++n}`,
  kind: 'income',
  walletId: 'tjs',
  amountMinor: 10_000,
  occurredOn: '2026-10-05',
  createdAt: `2026-10-05T10:00:00.${String(n % 1000).padStart(3, '0')}Z`,
  deletedAt: null,
  debtId: 'd1',
  ...over,
});

describe('computeDebtState: проценты', () => {
  const credit = (over: Partial<Parameters<typeof computeDebtState>[0]> = {}) => debt({ direction: 'borrowed', principalMinor: 1_000_000, interestMinor: 134_715, ...over });

  it('остаток считается от «сумма долга + проценты»: проценты — это то, что нужно вернуть сверх полученного', () => {
    const s = computeDebtState(credit(), [op({ kind: 'income', amountMinor: 1_000_000 }), op({ kind: 'expense', amountMinor: 94_560 })], wallets);
    expect(s).toMatchObject({
      principalMinor: 1_000_000, interestMinor: 134_715, totalMinor: 1_134_715, paidMinor: 94_560, remainingMinor: 1_040_155, overpaidMinor: 0,
      issuedMinor: 1_000_000, settled: false,
    });
  });

  it('проценты денег не двигают: «получено деньгами» — только сумма долга', () => {
    const s = computeDebtState(credit(), [op({ kind: 'income', amountMinor: 1_000_000 })], wallets);
    expect(s.issuedMinor).toBe(1_000_000);
    expect(s.remainingMinor).toBe(1_134_715);
  });

  it('вернули только сумму долга — долг не погашен, остались проценты', () => {
    const s = computeDebtState(credit(), [op({ kind: 'expense', amountMinor: 1_000_000 })], wallets);
    expect(s).toMatchObject({ remainingMinor: 134_715, settled: false });
  });

  it('вернули всё с процентами — погашен без переплаты; лишнее — переплата', () => {
    expect(computeDebtState(credit(), [op({ kind: 'expense', amountMinor: 1_134_715 })], wallets)).toMatchObject({ remainingMinor: 0, overpaidMinor: 0, settled: true });
    expect(computeDebtState(credit(), [op({ kind: 'expense', amountMinor: 1_200_000 })], wallets)).toMatchObject({ remainingMinor: 0, overpaidMinor: 65_285, settled: true });
  });

  it('долг «мне должны» с процентами считается так же', () => {
    const s = computeDebtState(debt({ principalMinor: 100_000, interestMinor: 10_000 }), [op({ amountMinor: 30_000 })], wallets);
    expect(s).toMatchObject({ totalMinor: 110_000, remainingMinor: 80_000 });
  });

  it('без процентов (нет поля или null) всё как раньше', () => {
    for (const over of [{}, { interestMinor: null }, { interestMinor: 0 }]) {
      expect(computeDebtState(debt(over), [op({ amountMinor: 30_000 })], wallets)).toMatchObject({ interestMinor: 0, totalMinor: 100_000, remainingMinor: 70_000 });
    }
  });

  it('сумма с процентами не помещается в безопасное целое — RangeError, а не неверное число', () => {
    expect(() => computeDebtState(debt({ principalMinor: Number.MAX_SAFE_INTEGER, interestMinor: 10 }), [], wallets)).toThrow(RangeError);
  });
});

describe('computeDebtState', () => {
  it('lent: выдача — расход, платежи — доходы; остаток = долг − платежи', () => {
    const s = computeDebtState(debt(), [op({ kind: 'expense', amountMinor: 100_000 }), op({ amountMinor: 30_000 }), op({ amountMinor: 20_000 })], wallets);
    expect(s).toMatchObject({ principalMinor: 100_000, paidMinor: 50_000, remainingMinor: 50_000, overpaidMinor: 0, issuedMinor: 100_000, settled: false });
    expect(s.payments.map((p) => p.amountMinor)).toEqual([30_000, 20_000]);
    expect(s.issues).toEqual([]);
  });

  it('borrowed: наоборот — получение это доход, платежи — расходы', () => {
    const d = debt({ direction: 'borrowed' });
    const s = computeDebtState(d, [op({ kind: 'income', amountMinor: 100_000 }), op({ kind: 'expense', amountMinor: 40_000 })], wallets);
    expect(s).toMatchObject({ paidMinor: 40_000, remainingMinor: 60_000, issuedMinor: 100_000 });
    expect(paymentKind('borrowed')).toBe('expense');
    expect(paymentKind('lent')).toBe('income');
    expect(issueKind('borrowed')).toBe('income');
    expect(issueKind('lent')).toBe('expense');
  });

  it('платёж «не в ту сторону» не уменьшает остаток', () => {
    const s = computeDebtState(debt(), [op({ kind: 'expense', amountMinor: 5_000 })], wallets);
    expect(s).toMatchObject({ paidMinor: 0, remainingMinor: 100_000, issuedMinor: 5_000 });
  });

  it('точное погашение: остаток 0, переплаты нет', () => {
    const s = computeDebtState(debt(), [op({ amountMinor: 100_000 })], wallets);
    expect(s).toMatchObject({ remainingMinor: 0, overpaidMinor: 0, settled: true });
  });

  it('переплата считается отдельно, остаток не уходит в минус', () => {
    const s = computeDebtState(debt(), [op({ amountMinor: 70_000 }), op({ amountMinor: 45_000 })], wallets);
    expect(s).toMatchObject({ paidMinor: 115_000, remainingMinor: 0, overpaidMinor: 15_000, settled: true });
  });

  it('операции другой валюты не считаются и попадают в диагностику', () => {
    const s = computeDebtState(debt(), [op({ walletId: 'usd', amountMinor: 999 }), op({ amountMinor: 10_000 })], wallets);
    expect(s.paidMinor).toBe(10_000);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0]).toMatchObject({ reason: 'foreign-currency', currency: 'USD' });
  });

  it('неизвестный кошелёк, перевод и битая сумма — в диагностику, остаток не страдает', () => {
    const s = computeDebtState(
      debt(),
      [
        op({ walletId: 'нет такого' }),
        op({ kind: 'transfer' }),
        op({ amountMinor: 0 }),
        op({ amountMinor: 1.5 }),
        op({ amountMinor: 25_000 }),
      ],
      wallets,
    );
    expect(s.paidMinor).toBe(25_000);
    expect(s.issues.map((i) => i.reason).sort()).toEqual(['bad-amount', 'bad-amount', 'transfer', 'unknown-wallet']);
  });

  it('удалённые операции и операции других долгов пропускаются', () => {
    const s = computeDebtState(
      debt(),
      [op({ deletedAt: '2026-10-06T00:00:00.000Z' }), op({ debtId: 'другой' }), op({ debtId: null }), op({ amountMinor: 1_000 })],
      wallets,
    );
    expect(s.paidMinor).toBe(1_000);
    expect(s.issues).toEqual([]);
  });

  it('платежи идут по порядку: дата, время создания, id', () => {
    const s = computeDebtState(
      debt(),
      [op({ id: 'b', occurredOn: '2026-10-07' }), op({ id: 'a', occurredOn: '2026-10-03' }), op({ id: 'c', occurredOn: '2026-10-07', createdAt: '2026-10-01T00:00:00.000Z' })],
      wallets,
    );
    expect(s.payments.map((p) => p.txId)).toEqual(['a', 'c', 'b']);
  });

  it('кошельки можно передать и списком', () => {
    const s = computeDebtState(debt(), [op({ amountMinor: 7 })], [
      { id: 'tjs', currency: 'TJS' },
      { id: 'usd', currency: 'USD' },
    ]);
    expect(s.paidMinor).toBe(7);
  });

  it('переполнение суммы платежей — явная ошибка, а не тихая потеря точности', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    expect(() => computeDebtState(debt(), [op({ amountMinor: big }), op({ amountMinor: big })], wallets)).toThrow(RangeError);
  });

  it('нет операций: остаток равен сумме долга', () => {
    expect(computeDebtState(debt(), [], wallets)).toMatchObject({ remainingMinor: 100_000, paidMinor: 0, issuedMinor: 0, settled: false, payments: [] });
  });
});

describe('computeDebtState: выдачи и пополнения (entries)', () => {
  it('исходная выдача и «добавить ещё» — по порядку, старые первыми; платежи в них не попадают', () => {
    const s = computeDebtState(
      debt({ principalMinor: 150_000 }),
      [
        op({ id: 'late', kind: 'expense', amountMinor: 50_000, occurredOn: '2026-10-20' }),
        op({ id: 'first', kind: 'expense', amountMinor: 100_000, occurredOn: '2026-10-01' }),
        op({ id: 'pay', amountMinor: 30_000, occurredOn: '2026-10-10' }),
      ],
      wallets,
    );
    expect(s.entries).toEqual([
      { txId: 'first', occurredOn: '2026-10-01', amountMinor: 100_000 },
      { txId: 'late', occurredOn: '2026-10-20', amountMinor: 50_000 },
    ]);
    expect(s.issuedMinor).toBe(150_000);
    expect(s.payments.map((p) => p.txId)).toEqual(['pay']);
  });

  it('удалённые, чужие и другой валюты операции в entries не входят', () => {
    const s = computeDebtState(
      debt(),
      [
        op({ id: 'ok', kind: 'expense', amountMinor: 100_000 }),
        op({ id: 'gone', kind: 'expense', amountMinor: 1, deletedAt: '2026-10-06T00:00:00.000Z' }),
        op({ id: 'other', kind: 'expense', amountMinor: 2, debtId: 'd2' }),
        op({ id: 'usd', kind: 'expense', amountMinor: 3, walletId: 'usd' }),
      ],
      wallets,
    );
    expect(s.entries.map((e) => e.txId)).toEqual(['ok']);
    expect(s.issues.map((i) => i.txId)).toEqual(['usd']);
  });

  it('долг «на бумаге» — entries пуст', () => {
    expect(computeDebtState(debt(), [], wallets).entries).toEqual([]);
  });
});

