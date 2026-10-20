import { describe, expect, it } from 'vitest';
import type { TransactionInput } from '@/db';
import type { OpStatus, PlanOp, ZenRow } from '@/import/types';
import { walletImpacts } from './impact';

const row = { index: 0, line: 2, date: '2026-09-01', kind: 'expense', outcome: null, income: null, categoryPath: [], note: '', idKey: 'k' } as unknown as ZenRow;
const op = (input: Partial<TransactionInput>, status: OpStatus = 'add'): PlanOp => ({
  row,
  id: 'x',
  status,
  input: { kind: 'expense', walletId: 'A', amountMinor: 100, occurredOn: '2026-09-01', ...input },
});

describe('walletImpacts: на сколько импорт сдвинет остаток кошельков', () => {
  it('расход минус, доход плюс, операции считаются по кошелькам', () => {
    const m = walletImpacts([op({ kind: 'expense', walletId: 'A', amountMinor: 1_000 }), op({ kind: 'income', walletId: 'A', amountMinor: 250 }), op({ kind: 'expense', walletId: 'B', amountMinor: 5 })]);
    expect(m.get('A')).toEqual({ count: 2, deltaMinor: -750 });
    expect(m.get('B')).toEqual({ count: 1, deltaMinor: -5 });
  });

  it('перевод: минус со счёта списания, плюс на счёт зачисления; разница — комиссия', () => {
    const m = walletImpacts([op({ kind: 'transfer', walletId: 'A', toWalletId: 'B', amountMinor: 50_000, toAmountMinor: 49_500 })]);
    expect(m.get('A')).toEqual({ count: 1, deltaMinor: -50_000 });
    expect(m.get('B')).toEqual({ count: 1, deltaMinor: 49_500 });
  });

  it('учитываются только операции, которые добавятся: «уже есть», «ждёт курса» и прочие остаток не меняют', () => {
    const m = walletImpacts([op({ amountMinor: 100 }), op({ amountMinor: 900 }, 'exists'), op({ amountMinor: 900 }, 'wait-rate'), op({ amountMinor: 900 }, 'review'), op({ amountMinor: 900 }, 'blocked')]);
    expect(m.get('A')).toEqual({ count: 1, deltaMinor: -100 });
  });

  it('операции без данных для записи пропускаются, сумма не помещается в целое — null', () => {
    expect(walletImpacts([{ row, id: 'x', status: 'add' }]).size).toBe(0);
    const m = walletImpacts([op({ kind: 'income', walletId: 'A', amountMinor: Number.MAX_SAFE_INTEGER }), op({ kind: 'income', walletId: 'A', amountMinor: 10 })]);
    expect(m.get('A')).toEqual({ count: 2, deltaMinor: null });
  });
});
