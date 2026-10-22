import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import DebtsPage from './DebtsPage';

beforeEach(pinToday); // 15.10.2026
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));

async function open() {
  const td = opsDeps([table()]);
  await showApp(<DebtsPage />, td, '/debts');
  await findByRole('heading', { name: 'Долги', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Разделить счёт' }));
  const dialog = await findByRole('dialog', { name: 'Разделить счёт' });
  // кошельки читаются из базы: пока их нет, «Записать» недоступна
  await waitFor(() => expect(screen.getByRole('button', { name: 'Записать' })).toBeEnabled());
  return { td, dialog };
}

const amount = () => screen.getByRole('textbox', { name: /^Сумма счёта/ });
const friend = (n: number) => screen.getByRole('textbox', { name: `Друг ${n}` });

describe('«Разделить счёт»', () => {
  it('сумма и имена → доли видны сразу; «Записать» заводит расход на вашу долю и долги на друзей', async () => {
    const { td, dialog } = await open();
    await user.type(amount(), '100');
    await user.type(friend(1), 'Алишер');
    await user.click(screen.getByRole('button', { name: 'Добавить человека' }));
    await user.type(friend(2), 'Фарход');
    await waitFor(() => expect(norm(document.querySelector('[data-testid="split-preview"]')?.textContent)).toContain(`Каждый друг: ${fmt(3_333)}`));
    expect(norm(document.querySelector('[data-testid="split-preview"]')?.textContent)).toContain(`ваша доля: ${fmt(3_334)}`);

    await user.type(screen.getByRole('textbox', { name: 'На что' }), 'ужин');
    await user.click(screen.getByRole('button', { name: 'Записать' }));
    const s = storeOf(td);
    await eventually(async () => expect((await s.db.debts.toArray()).filter((d) => d.deletedAt === null)).toHaveLength(2));
    const debts = (await s.db.debts.toArray()).filter((d) => d.deletedAt === null).sort((a, b) => a.counterparty.localeCompare(b.counterparty, 'ru'));
    expect(debts.map((d) => [d.counterparty, d.direction, d.principalMinor, d.note])).toEqual([
      ['Алишер', 'lent', 3_333, 'Счёт: ужин'],
      ['Фарход', 'lent', 3_333, 'Счёт: ужин'],
    ]);
    const mine = (await s.db.transactions.toArray()).find((t) => t.debtId === null && t.deletedAt === null)!;
    expect(mine).toMatchObject({ kind: 'expense', amountMinor: 3_334, note: 'ужин' });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    // «Отменить» убирает всё
    await user.click(await findByRole('button', { name: 'Отменить' }));
    await eventually(async () => expect((await s.db.transactions.toArray()).filter((t) => t.deletedAt === null)).toHaveLength(0));
    expect((await s.db.debts.toArray()).filter((d) => d.deletedAt === null)).toHaveLength(0);
  });

  it('без имени и без суммы — ошибки под полями, в базу ничего не пишется', async () => {
    const { td } = await open();
    await user.click(screen.getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(screen.getByText('Введите сумму счёта')).toBeInTheDocument());
    expect(screen.getByText('Введите имя')).toBeInTheDocument();
    expect(await storeOf(td).db.debts.count()).toBe(0);
    expect(await storeOf(td).db.transactions.count()).toBe(0);
  });

  it('одинаковые имена не пропускает; «Убрать» убирает лишнюю строку; больше девяти друзей нельзя', async () => {
    await open();
    await user.type(amount(), '100');
    await user.type(friend(1), 'Алишер');
    await user.click(screen.getByRole('button', { name: 'Добавить человека' }));
    await user.type(friend(2), 'алишер');
    await user.click(screen.getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(screen.getByText(/двух одинаковых людей/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Убрать: алишер' }));
    expect(screen.queryByRole('textbox', { name: 'Друг 2' })).toBeNull();
    for (let i = 0; i < 8; i++) await user.click(screen.getByRole('button', { name: 'Добавить человека' }));
    expect(screen.getByRole('button', { name: 'Добавить человека' })).toBeDisabled();
  });
});
