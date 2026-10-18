import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/db';
import { basics, makeStore } from '../../tests/db/helpers';

const lent = { direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' } as const;

/** Долг «я дал 1 000 с.»: выдача (расход) и платёж (доход) с «Нал». */
async function seed() {
  const store = await makeStore();
  const { cash, food, salary } = await basics(store);
  const debt = await store.debts.create(lent);
  const issue = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100_000, occurredOn: '2026-10-01', debtId: debt.id });
  const payment = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 40_000, occurredOn: '2026-10-05', debtId: debt.id });
  return { store, cash, food, salary, debt, issue, payment };
}

describe('TransactionsRepo.update: вид операции по долгу', () => {
  it('выдачу нельзя превратить в доход (это стал бы платёж): понятная ошибка, строка не меняется', async () => {
    const { store, issue } = await seed();
    const before = await store.db.transactions.get(issue.id);
    const err = await store.transactions.update(issue.id, { kind: 'income' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/Вид операции по долгу менять нельзя/);
    expect((err as Error).message).toMatch(/со страницы долга/);
    expect(await store.db.transactions.get(issue.id)).toEqual(before);
  });

  it('со связью, переданной явно (как делает окно правки), — та же ошибка; платёж в расход тоже нельзя', async () => {
    const { store, debt, issue, payment, salary, food } = await seed();
    await expect(store.transactions.update(issue.id, { kind: 'income', debtId: debt.id, categoryId: salary.id })).rejects.toThrow(
      /Вид операции по долгу менять нельзя/,
    );
    await expect(store.transactions.update(payment.id, { kind: 'expense', debtId: debt.id, categoryId: food.id })).rejects.toThrow(
      /Вид операции по долгу менять нельзя/,
    );
    expect((await store.db.transactions.get(payment.id))?.kind).toBe('income');
  });

  it('явно снять связь и сменить вид одной правкой можно: операция больше не по долгу', async () => {
    const { store, issue } = await seed();
    const row = await store.transactions.update(issue.id, { kind: 'income', debtId: null });
    expect(row).toMatchObject({ kind: 'income', debtId: null });
  });

  it('прочие правки операции по долгу и смена вида у обычной операции работают как раньше', async () => {
    const { store, cash, payment } = await seed();
    expect(await store.transactions.update(payment.id, { amountMinor: 30_000, note: 'наличными' })).toMatchObject({
      kind: 'income',
      amountMinor: 30_000,
      debtId: payment.debtId,
    });
    const plain = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500, occurredOn: '2026-10-02' });
    expect((await store.transactions.update(plain.id, { kind: 'income' })).kind).toBe('income');
  });
});
