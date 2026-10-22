import { describe, expect, it } from 'vitest';
import { makeStore } from '../../../tests/db/helpers';
import { computeBalances } from '@/domain/balances';
import { MAX_FRIENDS, saveSplitBill, freshSplitIds, splitEven, undoSplitBill, validateSplit, debtNote } from './splitBill';

describe('splitEven: поровну на вас и друзей', () => {
  it('делится нацело — у всех по равной доле', () => {
    expect(splitEven(30_000, 2)).toEqual({ shareMinor: 10_000, mineMinor: 10_000 });
    expect(splitEven(10_000, 1)).toEqual({ shareMinor: 5_000, mineMinor: 5_000 });
  });

  it('копейки, которые не делятся, остаются на вас; в сумме всегда весь счёт', () => {
    expect(splitEven(10_000, 2)).toEqual({ shareMinor: 3_333, mineMinor: 3_334 });
    for (const [total, friends] of [[1, 1], [7, 3], [99_999, 9], [100, 4]] as const) {
      const s = splitEven(total, friends);
      expect(s.shareMinor * friends + s.mineMinor).toBe(total);
      expect(s.mineMinor).toBeGreaterThanOrEqual(s.shareMinor);
    }
  });
});

describe('validateSplit', () => {
  const ok = { totalMinor: 30_000, names: ['Алишер', 'Фарход'], note: 'ужин' };

  it('верный счёт — значение с долями и очищенными именами', () => {
    const r = validateSplit({ ...ok, names: ['  Алишер ', 'Фарход'] });
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({ totalMinor: 30_000, names: ['Алишер', 'Фарход'], shareMinor: 10_000, mineMinor: 10_000, note: 'ужин' });
  });

  it('нужна сумма и хотя бы один друг', () => {
    expect(validateSplit({ ...ok, totalMinor: null }).errors.amount).toBe('Введите сумму счёта');
    expect(validateSplit({ ...ok, totalMinor: 0 }).errors.amount).toBe('Сумма счёта должна быть больше нуля');
    expect(validateSplit({ ...ok, names: [] }).errors.form).toBe('Добавьте хотя бы одного человека, с кем делите счёт');
  });

  it('сумма меньше числа участников — не делится', () => {
    expect(validateSplit({ ...ok, totalMinor: 2 }).errors.amount).toBe('Сумма слишком мала, чтобы разделить её на всех');
    expect(validateSplit({ ...ok, totalMinor: 3 }).value).not.toBeNull();
  });

  it('пустые, слишком длинные и повторяющиеся имена (без регистра и «ё/е») — ошибки по строкам', () => {
    const r = validateSplit({ ...ok, names: ['Алишер', '  ', 'алишер', 'Ёж', 'еж'] });
    expect(r.value).toBeNull();
    expect(r.errors.names).toEqual([null, 'Введите имя', 'Это имя уже есть: двух одинаковых людей в счёте быть не может', null, 'Это имя уже есть: двух одинаковых людей в счёте быть не может']);
    expect(validateSplit({ ...ok, names: ['а'.repeat(500)] }).errors.names?.[0]).toMatch(/^Имя не длиннее/);
  });

  it('друзей не больше девяти', () => {
    expect(MAX_FRIENDS).toBe(9);
    const names = Array.from({ length: 10 }, (_, i) => `Друг ${i}`);
    expect(validateSplit({ totalMinor: 100_000, names, note: '' }).errors.form).toBe('Не больше 9 человек');
  });

  it('слишком длинная заметка — ошибка', () => {
    expect(validateSplit({ ...ok, note: 'я'.repeat(501) }).errors.note).toMatch(/^Заметка не длиннее/);
  });
});

describe('debtNote', () => {
  it('«Счёт: ужин»; без заметки — «Счёт на всех»', () => {
    expect(debtNote(' ужин ')).toBe('Счёт: ужин');
    expect(debtNote('  ')).toBe('Счёт на всех');
  });
});

async function setup() {
  const store = await makeStore();
  await store.settings.ensure({ baseCurrency: 'TJS' });
  const wallet = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 100_000, color: '#2563eb', icon: '💳' });
  const category = await store.categories.create({ name: 'Рестораны', kind: 'expense', color: '#f97316', icon: '🍽️' });
  return { store, wallet, category };
}

describe('saveSplitBill', () => {
  it('ваша доля — расход с категорией; за каждого друга — долг «мне должны» и выдача; кошелёк уменьшился на весь счёт', async () => {
    const { store, wallet, category } = await setup();
    const value = validateSplit({ totalMinor: 30_000, names: ['Алишер', 'Фарход'], note: 'ужин' }).value!;
    const ids = freshSplitIds(2);
    const res = await saveSplitBill(store, { walletId: wallet.id, currency: 'TJS', categoryId: category.id, occurredOn: '2026-10-15', value }, ids);

    expect(res.expense).toMatchObject({ kind: 'expense', amountMinor: 10_000, categoryId: category.id, note: 'ужин', debtId: null });
    expect(res.debts.map((d) => [d.counterparty, d.direction, d.principalMinor, d.note])).toEqual([
      ['Алишер', 'lent', 10_000, 'Счёт: ужин'],
      ['Фарход', 'lent', 10_000, 'Счёт: ужин'],
    ]);
    const txs = (await store.db.transactions.toArray()).filter((t) => t.deletedAt === null);
    expect(txs).toHaveLength(3); // расход + две выдачи
    const issues = txs.filter((t) => t.debtId !== null);
    expect(issues.map((t) => [t.kind, t.amountMinor, t.categoryId])).toEqual([['expense', 10_000, null], ['expense', 10_000, null]]);
    const wallets = (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null);
    expect(computeBalances(wallets, txs).get(wallet.id)).toBe(100_000 - 30_000);
  });

  it('в расходы месяца попадает только ваша доля: выдачи друзьям — не траты', async () => {
    const { store, wallet, category } = await setup();
    const value = validateSplit({ totalMinor: 10_000, names: ['Алишер', 'Фарход'], note: '' }).value!;
    await saveSplitBill(store, { walletId: wallet.id, currency: 'TJS', categoryId: category.id, occurredOn: '2026-10-15', value }, freshSplitIds(2));
    const { summarizeMonth } = await import('@/db');
    const s = summarizeMonth(await store.db.transactions.toArray(), '2026-10', 'TJS');
    expect(s.expenseMinor).toBe(3_334); // 100,00 ÷ 3: копейка остаётся на вас
  });

  it('повтор с теми же id (двойное нажатие) ничего не задваивает', async () => {
    const { store, wallet } = await setup();
    const value = validateSplit({ totalMinor: 30_000, names: ['Алишер'], note: '' }).value!;
    const ids = freshSplitIds(1);
    const plan = { walletId: wallet.id, currency: 'TJS' as const, categoryId: null, occurredOn: '2026-10-15', value };
    await saveSplitBill(store, plan, ids);
    await saveSplitBill(store, plan, ids);
    expect((await store.db.transactions.toArray()).filter((t) => t.deletedAt === null)).toHaveLength(2);
    expect((await store.db.debts.toArray()).filter((d) => d.deletedAt === null)).toHaveLength(1);
  });

  it('не вышло (кошелёк в архиве) — не записано ничего', async () => {
    const { store, wallet } = await setup();
    await store.wallets.archive(wallet.id);
    const value = validateSplit({ totalMinor: 30_000, names: ['Алишер', 'Фарход'], note: '' }).value!;
    await expect(saveSplitBill(store, { walletId: wallet.id, currency: 'TJS', categoryId: null, occurredOn: '2026-10-15', value }, freshSplitIds(2))).rejects.toBeInstanceOf(Error);
    expect(await store.db.transactions.count()).toBe(0);
    expect(await store.db.debts.count()).toBe(0);
  });

  it('«Отменить» убирает расход, долги и их выдачи; остаток кошелька прежний', async () => {
    const { store, wallet } = await setup();
    const value = validateSplit({ totalMinor: 30_000, names: ['Алишер', 'Фарход'], note: '' }).value!;
    const res = await saveSplitBill(store, { walletId: wallet.id, currency: 'TJS', categoryId: null, occurredOn: '2026-10-15', value }, freshSplitIds(2));
    await undoSplitBill(store, res);
    const live = (await store.db.transactions.toArray()).filter((t) => t.deletedAt === null);
    expect(live).toHaveLength(0);
    expect((await store.db.debts.toArray()).filter((d) => d.deletedAt === null)).toHaveLength(0);
    const wallets = (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null);
    expect(computeBalances(wallets, live).get(wallet.id)).toBe(100_000);
  });
});
