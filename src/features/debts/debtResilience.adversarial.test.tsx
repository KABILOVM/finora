import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { write } from '@/app/testkit';
import { fire, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { opsDeps, pinToday, showApp, storeOf, table, tapAmount, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';
import DebtsPage from './DebtsPage';

/**
 * Что бывает, когда что-то идёт не так посреди записи: сбой базы, двойное нажатие, остаток изменился на другом устройстве,
 * пока шит платежа открыт. Здесь всё держится (зелёные проверки против поломки при будущих правках).
 */

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a3333';
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null) => norm(el?.textContent);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openDetail() {
  const td = opsDeps([table()], {
    setup: async (s: Store) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: '2026-09-30' });
      await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' }, { id: DEBT_ID });
    },
  });
  await showApp(
    <Routes>
      <Route path="/debts/:id" element={<DebtDetailPage />} />
    </Routes>,
    td,
    `/debts/${DEBT_ID}`,
  );
  await findByRole('button', { name: 'Добавить платёж' });
  return td;
}
const incomes = async (td: ReturnType<typeof opsDeps>) =>
  (await storeOf(td).db.transactions.toArray()).filter((t) => t.debtId === DEBT_ID && t.kind === 'income' && t.deletedAt === null);

describe('платёж по долгу', () => {
  it('остаток изменился на другом устройстве, пока шит открыт: сумма «весь остаток» становится переплатой и просит подтверждения', async () => {
    const td = await openDetail();
    await user.click(screen.getByRole('button', { name: 'Добавить платёж' }));
    const dlg = await findByRole('dialog', { name: 'Платёж по долгу' });
    const cash = (await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
    await write(async () => void (await storeOf(td).transactions.create({ kind: 'income', walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-05', debtId: DEBT_ID })));
    await waitFor(() => expect(text(dlg)).toContain('Платёж больше остатка на'));
    await user.click(screen.getByRole('button', { name: 'Записать платёж' }));
    await pause(200);
    expect(await incomes(td)).toHaveLength(1); // только чужой платёж 200: наш на 500 без галочки не записан
  });

  it('три быстрых нажатия «Записать платёж» дают один платёж', async () => {
    const td = await openDetail();
    await user.click(screen.getByRole('button', { name: 'Добавить платёж' }));
    await findByRole('dialog', { name: 'Платёж по долгу' });
    const btn = screen.getByRole('button', { name: 'Записать платёж' });
    for (let i = 0; i < 3; i++) fire(btn, new MouseEvent('click', { bubbles: true }));
    await pause(300);
    expect(await incomes(td)).toHaveLength(1);
  });
});

describe('новый долг: сбой базы посреди записи', () => {
  it('операция не записалась: не остаётся ни долга, ни операции; повтор после сбоя записывает ровно один долг и одну операцию', async () => {
    const td = opsDeps([table()]);
    await showApp(<DebtsPage />, td, '/debts');
    await findByRole('heading', { name: 'Долги', level: 1 });
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    const s = storeOf(td);
    vi.spyOn(s.db.transactions, 'add').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'Новый долг' }));
    const dlg = await findByRole('dialog', { name: 'Новый долг' });
    await user.type(screen.getByRole('textbox', { name: 'Кому я дал' }), 'Алишер');
    await tapAmount('500');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(text(dlg)).toContain('Не удалось записать долг. Данные не изменены'));
    expect(await s.db.debts.count()).toBe(0);
    expect(await s.db.transactions.count()).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
    expect(await s.db.debts.count()).toBe(1);
    expect(await s.db.transactions.count()).toBe(1);
  });
});
