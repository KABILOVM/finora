import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { debtTagText, txTags } from '@/features/transactions/txDisplay';
import { opsDeps, pinToday, rowTexts, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import TransactionsPage from '@/features/transactions/TransactionsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

describe('txTags / debtTagText: чистые функции', () => {
  it('обычная операция — без меток', () => {
    expect(txTags({ debtId: null, recurringRuleId: null }, null)).toEqual([]);
    expect(txTags({}, undefined)).toEqual([]);
  });
  it('по долгу: «Долг: имя»; имя неизвестно — просто «Долг»', () => {
    expect(txTags({ debtId: 'd' }, 'Алишер')).toEqual([{ key: 'debt', text: 'Долг: Алишер' }]);
    expect(txTags({ debtId: 'd' }, undefined)).toEqual([{ key: 'debt', text: 'Долг' }]);
    expect(txTags({ debtId: 'd' }, '   ')).toEqual([{ key: 'debt', text: 'Долг' }]);
    expect(debtTagText(null)).toBe('Долг');
  });
  it('по расписанию: «Регулярный платёж»; обе связи — обе метки, долг первым', () => {
    expect(txTags({ recurringRuleId: 'r' }, null)).toEqual([{ key: 'recurring', text: 'Регулярный платёж' }]);
    expect(txTags({ debtId: 'd', recurringRuleId: 'r' }, 'Банк').map((t) => t.text)).toEqual(['Долг: Банк', 'Регулярный платёж']);
  });
});

describe('журнал операций: метки', () => {
  async function open(setup: (s: Store) => Promise<void>) {
    const td = opsDeps([table()], { setup });
    await showApp(<TransactionsPage />, td, '/transactions');
    await findByRole('heading', { name: 'Операции', level: 1 });
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    return td;
  }

  it('операция по долгу — «Долг: <имя>» (и для закрытого, и для архивного долга), по расписанию — «Регулярный платёж», обычная — без меток', async () => {
    await open(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!.id;
      const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда')!.id;
      const lent = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' });
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, occurredOn: '2026-10-14', debtId: lent.id });
      const old = await s.debts.create({ direction: 'borrowed', counterparty: 'Старый', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-09-01' });
      await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 10_000, occurredOn: '2026-10-13', debtId: old.id });
      await s.debts.close(old.id);
      await s.debts.archive(old.id);
      const rule = await s.recurring.create({ kind: 'expense', walletId: cash, amountMinor: 3_000, frequency: 'monthly', startOn: '2026-10-12', categoryId: food });
      await s.transactions.createFromRule(rule.id, '2026-10-12');
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_250, categoryId: food, occurredOn: '2026-10-11', note: 'обед' });
    });
    await waitFor(() => expect(rowTexts().join('|')).toContain('Долг: Алишер'));
    const rows = rowTexts();
    expect(rows).toHaveLength(4);
    const byTag = (s: string) => rows.filter((r) => r.includes(s));
    // выдача долга: без «Без категории» — там «Долг»
    expect(byTag('Долг: Алишер')[0]).toContain('ДолгНаличные'); // название строки — «Долг», затем кошелёк
    expect(byTag('Долг: Алишер')[0]).not.toContain('Без категории');
    expect(byTag('Долг: Старый')).toHaveLength(1); // архивный и закрытый долг: метка не пропала
    expect(byTag('Регулярный платёж')).toHaveLength(1);
    expect(byTag('Регулярный платёж')[0]).toContain('Еда'); // у платежа с категорией название категории остаётся
    const plain = rows.find((r) => r.includes('обед'))!;
    expect(plain).not.toContain('Долг');
    expect(plain).not.toContain('Регулярный');
  });

  it('долг операции не найден в базе — метка «Долг» без имени, экран не падает', async () => {
    await open(async (s) => {
      const cash = (await s.db.wallets.toArray())[0]!.id;
      const d = await s.debts.create({ direction: 'lent', counterparty: 'Исчез', principalMinor: 5_000, currency: 'TJS', openedOn: '2026-10-01' });
      const tx = await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 5_000, occurredOn: '2026-10-14', debtId: d.id });
      await s.db.debts.delete(d.id); // долги не удаляются, но чужая/битая запись не должна ронять журнал
      void tx;
    });
    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    expect(rowTexts()[0]).toContain('Долг');
    expect(rowTexts()[0]).not.toContain('Долг:');
  });
});
