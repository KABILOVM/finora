import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import { summarizeMonth, ValidationError } from '@/db';
import { basics, makeStore } from './helpers';

const input = { direction: 'lent', counterparty: 'Али', principalMinor: 40_000, currency: 'TJS', openedOn: '2026-10-01' } as const;

async function setup() {
  const store = await makeStore();
  const { cash } = await basics(store);
  const debt = await store.debts.create(input);
  const issue = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 40_000, occurredOn: '2026-10-01', debtId: debt.id });
  const pay = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 10_000, occurredOn: '2026-10-05', debtId: debt.id });
  const other = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500, occurredOn: '2026-10-06' });
  const rule = await store.recurring.create({ kind: 'income', walletId: cash.id, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-11-01', debtId: debt.id });
  const balance = async () => computeBalances(await store.db.wallets.toArray(), await store.db.transactions.toArray()).get(cash.id);
  return { store, cash, debt, issue, pay, other, rule, balance };
}

describe('DebtsRepo.softDelete: только долг', () => {
  it('долг помечается удалённым, операции теряют debtId и живы, остаток кошелька тот же, правило в архиве', async () => {
    const { store, debt, issue, pay, other, rule, balance } = await setup();
    const before = await balance();
    const res = await store.debts.softDelete(debt.id, 'keep-operations');
    expect(res.txIds.sort()).toEqual([issue.id, pay.id].sort());
    expect(res.ruleIds).toEqual([rule.id]);
    expect(await store.db.debts.get(debt.id)).toMatchObject({ deletedAt: expect.any(String), dirty: 1 });
    for (const t of [issue, pay]) expect(await store.db.transactions.get(t.id)).toMatchObject({ debtId: null, deletedAt: null, dirty: 1 });
    expect(await store.db.transactions.get(other.id)).toEqual(other);
    expect(await balance()).toEqual(before);
    expect(await store.db.recurring_rules.get(rule.id)).toMatchObject({ archivedAt: expect.any(String), deletedAt: null, debtId: debt.id });
    // теперь это обычные расходы/доходы месяца
    const s = summarizeMonth(await store.db.transactions.toArray(), '2026-10', 'TJS');
    expect(s).toMatchObject({ expenseMinor: 40_500, incomeMinor: 10_000, debtFlowMinor: 0 });
  });

  it('повтор безопасен: ничего не меняет', async () => {
    const { store, debt } = await setup();
    await store.debts.softDelete(debt.id, 'keep-operations');
    const snap = JSON.stringify([await store.db.debts.toArray(), await store.db.transactions.toArray(), await store.db.recurring_rules.toArray()]);
    expect(await store.debts.softDelete(debt.id, 'with-operations')).toEqual({ debtId: debt.id, mode: 'with-operations', txIds: [], ruleIds: [] });
    expect(JSON.stringify([await store.db.debts.toArray(), await store.db.transactions.toArray(), await store.db.recurring_rules.toArray()])).toBe(snap);
  });

  it('неизвестный долг и неверный режим — понятная ошибка', async () => {
    const { store, debt } = await setup();
    await expect(store.debts.softDelete('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'keep-operations')).rejects.toThrow(/Долг не найден/);
    await expect(store.debts.softDelete(debt.id, 'x' as never)).rejects.toThrow(ValidationError);
    expect((await store.db.debts.get(debt.id))!.deletedAt).toBeNull();
  });

  it('отмена возвращает долг, связь операций и правило', async () => {
    const { store, debt, issue, pay, rule, balance } = await setup();
    const before = await balance();
    const res = await store.debts.softDelete(debt.id, 'keep-operations');
    await store.debts.undoDelete(res);
    expect((await store.db.debts.get(debt.id))!.deletedAt).toBeNull();
    for (const t of [issue, pay]) expect((await store.db.transactions.get(t.id))!.debtId).toBe(debt.id);
    expect((await store.db.recurring_rules.get(rule.id))!.archivedAt).toBeNull();
    expect(await balance()).toEqual(before);
    const st = computeDebtState(debt, await store.db.transactions.toArray(), await store.db.wallets.toArray());
    expect(st).toMatchObject({ paidMinor: 10_000, remainingMinor: 30_000 });
    await store.debts.undoDelete(res); // повтор
  });

  it('отмена не привязывает назад операцию, которую успели привязать к другому долгу', async () => {
    const { store, debt, pay } = await setup();
    const res = await store.debts.softDelete(debt.id, 'keep-operations');
    const d2 = await store.debts.create(input);
    await store.transactions.update(pay.id, { debtId: d2.id });
    await store.debts.undoDelete(res);
    expect((await store.db.transactions.get(pay.id))!.debtId).toBe(d2.id);
  });
});

describe('DebtsRepo.softDelete: долг и операции', () => {
  it('операции удалены, остаток кошелька как до долга; удалённые раньше операции не трогаются', async () => {
    const { store, cash, debt, issue, pay, other, rule } = await setup();
    const gone = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 7, occurredOn: '2026-10-07', debtId: debt.id });
    await store.transactions.softDelete(gone.id);
    const goneStamp = (await store.db.transactions.get(gone.id))!.clientUpdatedAt;
    const res = await store.debts.softDelete(debt.id, 'with-operations');
    expect(res.txIds.sort()).toEqual([issue.id, pay.id].sort());
    for (const t of [issue, pay]) expect(await store.db.transactions.get(t.id)).toMatchObject({ deletedAt: expect.any(String), debtId: debt.id });
    expect((await store.db.transactions.get(gone.id))!.clientUpdatedAt).toBe(goneStamp);
    const live = (await store.db.transactions.toArray()).filter((t) => t.deletedAt === null);
    expect(live.map((t) => t.id)).toEqual([other.id]);
    expect(computeBalances(await store.db.wallets.toArray(), await store.db.transactions.toArray()).get(cash.id)).toBe(100_000 - 500);
    expect((await store.db.recurring_rules.get(rule.id))!.archivedAt).not.toBeNull();
  });

  it('отмена возвращает долг и его операции (но не те, что были удалены раньше)', async () => {
    const { store, cash, debt, issue, pay, balance } = await setup();
    const gone = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 7, occurredOn: '2026-10-07', debtId: debt.id });
    await store.transactions.softDelete(gone.id);
    const before = await balance();
    const res = await store.debts.softDelete(debt.id, 'with-operations');
    await store.debts.undoDelete(res);
    expect((await store.db.debts.get(debt.id))!.deletedAt).toBeNull();
    for (const t of [issue, pay]) expect((await store.db.transactions.get(t.id))!.deletedAt).toBeNull();
    expect((await store.db.transactions.get(gone.id))!.deletedAt).not.toBeNull();
    expect(await balance()).toEqual(before);
  });

  it('всё или ничего: сбой в середине не оставляет половину', async () => {
    const { store, debt, issue, pay } = await setup();
    const orig = store.db.debts.put.bind(store.db.debts);
    store.db.debts.put = (() => Promise.reject(new Error('boom'))) as never;
    await expect(store.debts.softDelete(debt.id, 'with-operations')).rejects.toThrow('boom');
    store.db.debts.put = orig;
    expect((await store.db.debts.get(debt.id))!.deletedAt).toBeNull();
    for (const t of [issue, pay]) expect((await store.db.transactions.get(t.id))!.deletedAt).toBeNull();
    expect((await store.db.recurring_rules.toArray())[0]!.archivedAt).toBeNull();
  });
});

describe('удалённый долг в остальных местах', () => {
  it('новую операцию на удалённый долг создать нельзя; удалённый долг нельзя править', async () => {
    const { store, cash, debt } = await setup();
    await store.debts.softDelete(debt.id, 'keep-operations');
    await expect(store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 1, occurredOn: '2026-10-09', debtId: debt.id })).rejects.toThrow(/удалён/);
    await expect(store.debts.update(debt.id, { note: 'x' })).rejects.toThrow(/удалён/);
    await expect(store.debts.close(debt.id)).rejects.toThrow(/удалён/);
  });
});
