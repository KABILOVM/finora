import { afterEach, describe, expect, it, vi } from 'vitest';
import { write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { todayLocal } from '@/lib/dates';
import { opsDeps, showApp, storeOf, table, tapAmount, type OpsDeps } from './__fixtures__/opsKit';
import EditTransactionSheet from './EditTransactionSheet';

afterEach(() => vi.restoreAllMocks());

interface Ids {
  tx: string;
  cash: string;
  usd: string;
  card: string;
  food: string;
}

async function baseSetup(s: Store, ids: Ids): Promise<void> {
  const wallets = await s.db.wallets.toArray();
  ids.cash = wallets.find((w) => w.name === 'Наличные')?.id ?? '';
  ids.card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  ids.usd = (await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 100_000, color: '#2563eb', icon: '💲' })).id;
  const cats = await s.db.categories.toArray();
  ids.food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')?.id ?? '';
}

type Maker = (s: Store, ids: Ids) => Promise<string>;

async function openEdit(make: Maker) {
  const ids: Ids = { tx: '', cash: '', usd: '', card: '', food: '' };
  const td = opsDeps([table()], {
    setup: async (s) => {
      await baseSetup(s, ids);
      ids.tx = await make(s, ids);
    },
  });
  const onClose = vi.fn();
  function Edit() {
    return <EditTransactionSheet id={ids.tx} onClose={onClose} />;
  }
  await showApp(<Edit />, td, '/edit/x');
  await findByRole('dialog', { name: 'Правка операции' });
  return { td, ids, onClose };
}

const save = () => user.click(screen.getByRole('button', { name: 'Сохранить' }));
const row = async (td: OpsDeps, id: string) => storeOf(td).db.transactions.get(id);

describe('правка: чужая правка, пришедшая пока шит открыт (две копии на двух устройствах)', () => {
  it('человек меняет ТОЛЬКО заметку; сумма, исправленная с другого устройства, не должна откатиться', async () => {
    const { td, ids, onClose } = await openEdit(async (s, i) =>
      (
        await s.transactions.create({
          kind: 'expense',
          walletId: i.cash,
          amountMinor: 1000,
          categoryId: i.food,
          occurredOn: todayLocal(),
          note: 'обед',
        })
      ).id,
    );
    // синхронизация принесла исправленную сумму 1000 → 15000, пока шит открыт
    await write(() => storeOf(td).transactions.update(ids.tx, { amountMinor: 15_000 }));

    const note = screen.getByRole('textbox', { name: /^Заметка/ });
    await user.type(note, ' с коллегой');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const after = await row(td, ids.tx);
    expect(after?.note).toBe('обед с коллегой');
    // человек сумму не трогал — чужая правка суммы должна остаться
    expect(after?.amountMinor).toBe(15_000);
  });
});

describe('правка перевода между валютами', () => {
  it('сумму списания поменяли, а «Получено» осталось старым: нельзя молча сохранить рассогласованную пару', async () => {
    const { td, ids, onClose } = await openEdit(async (s, i) =>
      (
        await s.transactions.create({
          kind: 'transfer',
          walletId: i.cash,
          toWalletId: i.usd,
          amountMinor: 10_900, // 109 с.
          toAmountMinor: 1000, // 10 $ по курсу 10,9
          occurredOn: todayLocal(),
        })
      ).id,
    );
    // человек исправляет опечатку: списано было не 109, а 218 с.
    const amount = screen.getByRole('textbox', { name: /^Сумма списания/ }) as HTMLInputElement;
    await user.click(amount);
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole('button', { name: 'Стереть' }));
    await tapAmount('218');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const after = await row(td, ids.tx);
    expect(after?.amountMinor).toBe(21_800);
    // 218 с. по курсу 10,9 — это 20 $ (или экран обязан был потребовать новую сумму зачисления)
    expect(after?.toAmountMinor).toBe(2000);
  });
});
