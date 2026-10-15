import { describe, expect, it } from 'vitest';
import { computeDebtState } from '@/domain/debts';
import { ValidationError } from '@/db';
import { basics, makeStore } from './helpers';

const input = { direction: 'borrowed', counterparty: 'Рустам', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' } as const;

async function setup() {
  const store = await makeStore();
  const { cash } = await basics(store);
  const debt = await store.debts.create(input);
  return { store, cash, debt };
}

describe('DebtsRepo.increase: «добавить ещё в долг»', () => {
  it('сумма долга растёт, остальное не меняется, правка помечена к отправке', async () => {
    const { store, debt } = await setup();
    const row = await store.debts.increase(debt.id, 20_000);
    expect(row).toMatchObject({ principalMinor: 70_000, openedOn: '2026-10-01', dueOn: null, counterparty: 'Рустам', dirty: 1 });
    expect(await store.db.debts.get(debt.id)).toMatchObject({ principalMinor: 70_000 });
  });

  it('несколько пополнений складываются', async () => {
    const { store, debt } = await setup();
    await store.debts.increase(debt.id, 1_000);
    await store.debts.increase(debt.id, 2_500);
    expect((await store.db.debts.get(debt.id))!.principalMinor).toBe(53_500);
  });

  it('остаток считается от новой суммы: платежи и выдачи учитываются как раньше', async () => {
    const { store, cash, debt } = await setup();
    await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 50_000, occurredOn: '2026-10-01', debtId: debt.id });
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 10_000, occurredOn: '2026-10-03', debtId: debt.id });
    await store.debts.increase(debt.id, 20_000);
    await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 20_000, occurredOn: '2026-10-10', debtId: debt.id });
    const d = (await store.db.debts.get(debt.id))!;
    const st = computeDebtState(d, await store.db.transactions.toArray(), await store.db.wallets.toArray());
    expect(st).toMatchObject({ principalMinor: 70_000, issuedMinor: 70_000, paidMinor: 10_000, remainingMinor: 60_000 });
    expect(st.entries.map((e) => e.amountMinor)).toEqual([50_000, 20_000]);
  });

  it('закрытый долг после пополнения снова открыт', async () => {
    const { store, debt } = await setup();
    await store.debts.close(debt.id);
    const row = await store.debts.increase(debt.id, 5_000);
    expect(row.closedAt).toBeNull();
    expect(row.principalMinor).toBe(55_000);
  });

  it('новый срок: задан — меняется, не задан — остаётся, null — снимается', async () => {
    const { store, debt } = await setup();
    await store.debts.update(debt.id, { dueOn: '2026-11-01' });
    expect((await store.debts.increase(debt.id, 1_000)).dueOn).toBe('2026-11-01');
    expect((await store.debts.increase(debt.id, 1_000, { dueOn: '2026-12-15' })).dueOn).toBe('2026-12-15');
    expect((await store.debts.increase(debt.id, 1_000, { dueOn: null })).dueOn).toBeNull();
  });

  it('срок раньше даты долга — ошибка, долг не изменился', async () => {
    const { store, debt } = await setup();
    await expect(store.debts.increase(debt.id, 1_000, { dueOn: '2026-09-01' })).rejects.toThrow(/Срок возврата/);
    expect((await store.db.debts.get(debt.id))!.principalMinor).toBe(50_000);
  });

  it.each([0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])('сумма пополнения %s отвергается', async (delta) => {
    const { store, debt } = await setup();
    await expect(store.debts.increase(debt.id, delta)).rejects.toThrow(ValidationError);
    expect((await store.db.debts.get(debt.id))!.principalMinor).toBe(50_000);
  });

  it('больше предела сервера (1e15) — понятная ошибка, ничего не записано', async () => {
    const { store, debt } = await setup();
    await expect(store.debts.increase(debt.id, 1_000_000_000_000_000)).rejects.toThrow(/слишком велика/);
    expect((await store.db.debts.get(debt.id))!.principalMinor).toBe(50_000);
  });

  it('ровно до предела — можно, на единицу больше — нельзя', async () => {
    const { store, debt } = await setup();
    await store.debts.increase(debt.id, 1_000_000_000_000_000 - 50_000);
    expect((await store.db.debts.get(debt.id))!.principalMinor).toBe(1_000_000_000_000_000);
    await expect(store.debts.increase(debt.id, 1)).rejects.toThrow(/слишком велика/);
  });

  it('долг в архиве, удалённый и неизвестный — понятные ошибки', async () => {
    const { store, debt } = await setup();
    await store.debts.archive(debt.id);
    await expect(store.debts.increase(debt.id, 100)).rejects.toThrow(/в архиве/);
    await store.debts.restore(debt.id);
    await store.debts.softDelete(debt.id, 'keep-operations');
    await expect(store.debts.increase(debt.id, 100)).rejects.toThrow(/удалён/);
    await expect(store.debts.increase('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 100)).rejects.toThrow(/Долг не найден/);
  });
});
