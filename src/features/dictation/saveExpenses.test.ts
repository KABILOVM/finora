import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureSeeded, openStore, type Store } from '@/db';
import type { DraftExpense } from '@/domain/expensesAi';
import { noteOf, saveExpenses, validateAll, type SaveContext } from './saveExpenses';

let store: Store;
let n = 0;
beforeEach(async () => {
  n += 1;
  store = await openStore(`dict-user-${n}`, { deviceId: `dev-${n}`, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
});

const draft = (over: Partial<DraftExpense>): DraftExpense => ({
  rid: 1, title: 'Такси', amountText: '25', feeText: '', walletId: '', categoryId: '', newCategory: '', date: '2026-10-11', note: '', walletGuessed: false, ...over,
});

async function setup(rate: number | null = 10.9): Promise<SaveContext> {
  const tjs = (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null)[0]!;
  const usd = await store.wallets.create({ name: 'Доллары', kind: 'cash', currency: 'USD', openingBalanceMinor: 0, color: '#16a34a', icon: 'wallet' });
  return {
    store,
    wallets: [tjs, usd],
    categories: [],
    base: 'TJS',
    getRate: (from) => (from === 'USD' && rate ? { rate, source: 'nbt', asOf: '2026-10-10', stale: false, manual: false } : null),
    txIds: new Map(),
  };
}

describe('noteOf', () => {
  it('склеивает название, заметку и комиссию', () => {
    expect(noteOf(draft({ note: 'с Умаром' }), '5')).toBe('Такси — с Умаром (комиссия 5)');
    expect(noteOf(draft({ title: '' }), '5')).toBe('комиссия 5');
    expect(noteOf(draft({}), '')).toBe('Такси');
  });
});

describe('saveExpenses', () => {
  it('сохраняет расход с комиссией в сумме, новой категорией и курсом валютного счёта', async () => {
    const ctx = await setup();
    const [tjs, usd] = ctx.wallets;
    const r = await saveExpenses(
      [draft({ rid: 1, walletId: tjs!.id, feeText: '5', newCategory: 'Такси' }), draft({ rid: 2, title: 'Кофе', amountText: '6', walletId: usd!.id, newCategory: 'Такси' })],
      ctx,
    );
    expect(r.saved).toEqual([1, 2]);
    const rows = (await store.db.transactions.toArray()).filter((t) => t.kind === 'expense').sort((a, b) => a.amountMinor - b.amountMinor);
    const [coffee, taxi] = [rows.find((t) => t.walletId === usd!.id)!, rows.find((t) => t.walletId === tjs!.id)!];
    expect(taxi).toMatchObject({ amountMinor: 3000, occurredOn: '2026-10-11', note: 'Такси (комиссия 5)', baseAmountMinor: 3000 });
    expect(coffee).toMatchObject({ amountMinor: 600, fxRate: 10.9, fxSource: 'nbt', baseAmountMinor: 6540 });
    expect(coffee.categoryId).toBe(taxi.categoryId);
    expect((await store.db.categories.toArray()).filter((c) => c.name === 'Такси')).toHaveLength(1);
  });
  it('повтор после сбоя не создаёт дублей', async () => {
    const ctx = await setup();
    const d = draft({ walletId: ctx.wallets[0]!.id });
    await saveExpenses([d], ctx);
    await saveExpenses([d], ctx);
    expect((await store.db.transactions.toArray()).filter((t) => t.kind === 'expense')).toHaveLength(1);
  });
});

describe('validateAll', () => {
  it('нет курса валютного счёта — ошибка строки до записи', async () => {
    const ctx = await setup(null);
    const errs = validateAll([draft({ rid: 7, walletId: ctx.wallets[1]!.id }), draft({ rid: 8, walletId: ctx.wallets[0]!.id })], ctx);
    expect([...errs.keys()]).toEqual([7]);
    expect(errs.get(7)).toMatch(/Нет курса USD → TJS/);
  });
});
