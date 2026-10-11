import { afterEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { computeDebtState } from '@/domain/debts';
import { amountField, opsDeps, showApp, storeOf, table, tapAmount, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import EditTransactionSheet from '@/features/transactions/EditTransactionSheet';
import { addDays, todayLocal } from '@/lib/dates';

/**
 * Защита от опечатки в сумме платежа. В шите «Платёж по долгу» сумма больше остатка проходит только после галочки «Это переплата»
 * (автор прямо пишет: опечатка «6000» не должна пройти). Эти тесты проверяют, что тот же платёж нельзя тихо раздуть другой дорогой:
 * через правку операции в журнале.
 */

afterEach(() => vi.restoreAllMocks());

interface Ids {
  debt: string;
  payment: string;
}

/** Долг «Алишер» 500 с.; выдача 500 с. и платёж 200 с. — остаток 300 с. */
async function openEditOfPayment() {
  const ids: Ids = { debt: '', payment: '' };
  const td = opsDeps([table()], {
    setup: async (s: Store) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      const debt = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: addDays(todayLocal(), -10) });
      ids.debt = debt.id;
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, occurredOn: addDays(todayLocal(), -10), debtId: debt.id });
      ids.payment = (await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 20_000, occurredOn: addDays(todayLocal(), -2), debtId: debt.id })).id;
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
  return computeDebtState(debt, await s.db.transactions.where('debtId').equals(debtId).toArray(), new Map(wallets.map((w) => [w.id, w])));
};

describe('правка платежа по долгу: та же защита от опечатки, что в шите платежа', () => {
  it('контроль: правка суммы платежа, которая не выходит за остаток, сохраняется сразу', async () => {
    const { td, ids, onClose } = await openEditOfPayment();
    await user.clear(amountField());
    await tapAmount('300'); // 200 → 300: ровно весь остаток долга, переплаты нет
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await stateOf(td, ids.debt)).remainingMinor).toBe(20_000);
  });

  it('«200» превратили в «2000» при остатке 300: одним нажатием «Сохранить» это не проходит (нужно подтверждение или отказ)', async () => {
    const { td, ids, onClose } = await openEditOfPayment();
    await user.clear(amountField());
    await tapAmount('2000');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await new Promise((r) => setTimeout(r, 300));

    const row = await storeOf(td).db.transactions.get(ids.payment);
    const state = await stateOf(td, ids.debt);
    // сейчас платёж 2000 при долге 500 записан молча: оплачено 2000, «переплата» 1500, долг «погашен»
    expect(row?.amountMinor, 'платёж с переплатой записан без подтверждения').toBe(20_000);
    expect(state.overpaidMinor).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
    // и человеку сказано, в чём дело
    expect(document.body.textContent ?? '').toMatch(/переплат|больше остатка/i);
  });
});
