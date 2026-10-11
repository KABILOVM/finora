import { afterEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { computeDebtState } from '@/domain/debts';
import { amountField, opsDeps, showApp, storeOf, table, tapAmount, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import EditTransactionSheet from '@/features/transactions/EditTransactionSheet';
import { addDays, todayLocal } from '@/lib/dates';

/**
 * Правка платежа по долгу из журнала: если платежи станут больше долга, перед записью спрашиваем «Это переплата?»
 * (так же, как галочка в шите платежа). Первое нажатие «Сохранить» без вопроса ничего не пишет — это проверено
 * в debtEditGuards.adversarial.test.tsx; здесь — что происходит дальше.
 */

afterEach(() => vi.restoreAllMocks());

/** Долг «Алишер» 500 с.; выдача 500 с. и платёж paymentMinor. */
async function openEditOfPayment(paymentMinor: number) {
  const ids = { debt: '', payment: '' };
  const td = opsDeps([table()], {
    setup: async (s: Store) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      const day = addDays(todayLocal(), -10);
      const debt = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: day });
      ids.debt = debt.id;
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, occurredOn: day, debtId: debt.id });
      ids.payment = (await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: paymentMinor, occurredOn: addDays(todayLocal(), -2), debtId: debt.id })).id;
    },
  });
  const onClose = vi.fn();
  function Edit() {
    return <EditTransactionSheet id={ids.payment} onClose={onClose} />;
  }
  await showApp(<Edit />, td, '/edit/x');
  await findByRole('dialog', { name: 'Правка операции' });
  return { td, ids, onClose };
}

const stateOf = async (td: OpsDeps, debtId: string) => {
  const s = storeOf(td);
  const debt = (await s.db.debts.get(debtId))!;
  const wallets = await s.db.wallets.toArray();
  return computeDebtState(debt, await s.db.transactions.where('debtId').equals(debtId).toArray(), wallets);
};

const save = () => user.click(screen.getByRole('button', { name: 'Сохранить' }));
const askName = 'Платежи больше долга';

describe('правка платежа по долгу: вопрос про переплату', () => {
  it('«Это переплата — сохранить» записывает платёж, переплата видна в расчёте долга', async () => {
    const { td, ids, onClose } = await openEditOfPayment(20_000);
    await user.clear(amountField());
    await tapAmount('2000');
    await save();

    const ask = await findByRole('alertdialog', { name: askName });
    expect(ask.textContent ?? '').toContain('переплата');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Это переплата — сохранить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect((await storeOf(td).db.transactions.get(ids.payment))?.amountMinor).toBe(200_000);
    const state = await stateOf(td, ids.debt);
    expect(state.overpaidMinor).toBe(150_000);
    expect(state.remainingMinor).toBe(0);
  });

  it('«Поправить сумму» ничего не пишет и оставляет шит открытым; с исправленной суммой сохраняется без вопроса', async () => {
    const { td, ids, onClose } = await openEditOfPayment(20_000);
    await user.clear(amountField());
    await tapAmount('2000');
    await save();
    await findByRole('alertdialog', { name: askName });

    await user.click(screen.getByRole('button', { name: 'Поправить сумму' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: askName })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect((await storeOf(td).db.transactions.get(ids.payment))?.amountMinor).toBe(20_000);

    await user.clear(amountField());
    await tapAmount('400');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog', { name: askName })).toBeNull();
    expect((await storeOf(td).db.transactions.get(ids.payment))?.amountMinor).toBe(40_000);
    expect((await stateOf(td, ids.debt)).overpaidMinor).toBe(0);
  });

  it('платёж, который уже был с переплатой: правка заметки сохраняется без вопроса', async () => {
    const { td, ids, onClose } = await openEditOfPayment(80_000);
    // в новой форме заметка скрыта, пока её не откроют
    const noteButton = screen.queryByRole('button', { name: 'Заметка' });
    if (noteButton) await user.click(noteButton);
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'вернул с запасом');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog', { name: askName })).toBeNull();
    const row = await storeOf(td).db.transactions.get(ids.payment);
    expect(row?.note).toBe('вернул с запасом');
    expect(row?.amountMinor).toBe(80_000);
  });
});
