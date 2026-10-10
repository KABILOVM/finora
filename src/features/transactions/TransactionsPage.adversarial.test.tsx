import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, rowTexts, showApp, storeOf, table, unpinToday } from './__fixtures__/opsKit';
import TransactionsPage, { PAGE_SIZE } from './TransactionsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

async function openList(setup: (s: import('@/db').Store) => Promise<void>) {
  const td = opsDeps([table()], { setup });
  await showApp(<TransactionsPage />, td, '/transactions');
  await findByRole('heading', { name: 'Операции', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

describe('список операций: границы страниц и периодов', () => {
  it('день на 250 операций показан целиком, итог дня полный; «Показать ещё» не теряет и не дублирует строки', async () => {
    let expectedNet = 0;
    const td = await openList(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]?.id ?? '';
      for (let i = 0; i < PAGE_SIZE + 50; i++) {
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 100 + i, occurredOn: '2026-10-15', note: `big-${i}` });
        expectedNet -= 100 + i;
      }
      for (let i = 0; i < 10; i++) {
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 7, occurredOn: '2026-10-14', note: `old-${i}` });
      }
    });
    void td;
    await waitFor(() => expect(rowTexts().length).toBe(PAGE_SIZE + 50));
    const header = document.querySelector('section[aria-label="Сегодня"] header')?.textContent ?? '';
    expect(header.replace(/\s/g, '')).toContain(formatMinor(expectedNet, 'TJS', { sign: 'always' }).replace(/\s/g, ''));
    await user.click(screen.getByRole('button', { name: 'Показать ещё' }));
    await waitFor(() => expect(rowTexts().length).toBe(PAGE_SIZE + 60));
    const texts = rowTexts();
    expect(new Set(texts.map((t) => t.match(/(big|old)-\d+/)?.[0])).size).toBe(PAGE_SIZE + 60);
  });

  it('операция последнего дня месяца и 29 февраля попадают в свой месяц, а не в соседний', async () => {
    await openList(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]?.id ?? '';
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 100, occurredOn: '2026-10-31', note: 'last-oct' });
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 100, occurredOn: '2026-09-30', note: 'last-sep' });
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 100, occurredOn: '2026-11-01', note: 'first-nov' });
    });
    await waitFor(() => expect(rowTexts().some((t) => t.includes('last-oct'))).toBe(true));
    expect(rowTexts().some((t) => t.includes('last-sep'))).toBe(false);
    expect(rowTexts().some((t) => t.includes('first-nov'))).toBe(false);
  });

  it('операция, удалённая в другой вкладке/синхронизацией, пока список открыт, пропадает вместе с итогом дня', async () => {
    const ids: string[] = [];
    const td = await openList(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]?.id ?? '';
      ids.push((await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 500, occurredOn: '2026-10-15', note: 'one' })).id);
      ids.push((await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 300, occurredOn: '2026-10-15', note: 'two' })).id);
    });
    await waitFor(() => expect(rowTexts().length).toBe(2));
    await write(() => storeOf(td).transactions.softDelete(ids[0] ?? ''));
    await waitFor(() => expect(rowTexts().length).toBe(1));
    const header = document.querySelector('section[aria-label="Сегодня"] header')?.textContent ?? '';
    expect(header.replace(/\s/g, '')).toContain(formatMinor(-300, 'TJS', { sign: 'always' }).replace(/\s/g, ''));
  });
});
