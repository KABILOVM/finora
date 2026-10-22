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
  rid: 1, kind: 'expense', toWalletId: '', title: 'Такси', amountText: '25', feeText: '', walletId: '', categoryId: '', newCategory: '', date: '2026-10-11', note: '', walletGuessed: false, ...over,
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

describe('saveExpenses: режим поездки', () => {
  it('метка поездки дописывается в заметку расхода, дохода и перевода; без неё заметки прежние', async () => {
    const ctx = await setup();
    const [cash] = ctx.wallets;
    const card = await store.wallets.create({ name: 'Карта', kind: 'card', currency: 'TJS', openingBalanceMinor: 0, color: '#2563eb', icon: 'card' });
    const drafts = [
      draft({ rid: 1, walletId: cash!.id }),
      draft({ rid: 2, kind: 'income', title: 'Возврат', walletId: cash!.id }),
      draft({ rid: 3, kind: 'transfer', title: 'Снял', walletId: cash!.id, toWalletId: card.id }),
    ];
    await saveExpenses(drafts, { ...ctx, wallets: [cash!, card], tripTag: 'Самарканд' });
    const notes = (await store.db.transactions.toArray()).map((t) => t.note).sort();
    expect(notes).toEqual(['Возврат #Самарканд', 'Снял #Самарканд', 'Такси #Самарканд']);
    await saveExpenses([draft({ rid: 9, walletId: cash!.id, title: 'Кофе' })], { ...ctx, wallets: [cash!, card], tripTag: null });
    expect((await store.db.transactions.toArray()).find((t) => t.note.startsWith('Кофе'))!.note).toBe('Кофе');
  });
});

describe('saveExpenses: доходы и переводы', () => {
  it('доход: категория доходов создаётся один раз, сумма зачисляется на счёт; комиссия не прибавляется', async () => {
    const ctx = await setup();
    // известные приложению категории доходов (из базы): «Зарплата» уже есть, «Фриланс» — новая
    ctx.incomeCategories = (await store.db.categories.toArray()).filter((c) => c.kind === 'income' && c.deletedAt === null).map((c) => ({ id: c.id, name: c.name }));
    const tjs = ctx.wallets[0]!;
    const r = await saveExpenses(
      [
        draft({ rid: 1, kind: 'income', title: 'Проект', amountText: '5000', feeText: '9', walletId: tjs.id, newCategory: 'Фриланс' }),
        draft({ rid: 2, kind: 'income', title: 'Ещё проект', amountText: '1000', walletId: tjs.id, newCategory: 'Фриланс' }),
        draft({ rid: 3, kind: 'income', title: 'Аванс', amountText: '700', walletId: tjs.id, newCategory: 'Зарплата' }),
      ],
      ctx,
    );
    expect(r.saved).toEqual([1, 2, 3]);
    const rows = (await store.db.transactions.toArray()).filter((t) => t.kind === 'income').sort((a, b) => b.amountMinor - a.amountMinor);
    expect(rows.map((t) => [t.amountMinor, t.note])).toEqual([[500_000, 'Проект'], [100_000, 'Ещё проект'], [70_000, 'Аванс']]);
    const income = (await store.db.categories.toArray()).filter((c) => c.kind === 'income' && c.deletedAt === null);
    expect(income.filter((c) => c.name === 'Фриланс')).toHaveLength(1); // создана один раз
    expect(income.filter((c) => c.name === 'Зарплата')).toHaveLength(1); // существующая выбрана, не продублирована
    expect(rows[0]!.categoryId).toBe(rows[1]!.categoryId);
    expect(rows[2]!.categoryId).toBe(income.find((c) => c.name === 'Зарплата')!.id);
  });

  it('перевод между своими счетами одной валюты: списано сумма + комиссия, получено сумма', async () => {
    const ctx = await setup();
    const [tjs] = ctx.wallets;
    const card = await store.wallets.create({ name: 'Карта', kind: 'card', currency: 'TJS', openingBalanceMinor: 0, color: '#2563eb', icon: 'wallet' });
    ctx.wallets = [tjs!, card];
    const r = await saveExpenses([draft({ rid: 1, kind: 'transfer', title: 'Снял наличные', amountText: '1000', feeText: '5', walletId: card.id, toWalletId: tjs!.id })], ctx);
    expect(r.saved).toEqual([1]);
    const t = (await store.db.transactions.toArray()).find((x) => x.kind === 'transfer')!;
    expect(t).toMatchObject({ walletId: card.id, toWalletId: tjs!.id, amountMinor: 100_500, toAmountMinor: 100_000, baseAmountMinor: 500, categoryId: null });
  });

  it('перевод в валютном кошельке без комиссии записывается без курса; с комиссией курс нужен', async () => {
    const ctx = await setup(null); // курса USD нет
    const usd = ctx.wallets[1]!;
    const usd2 = await store.wallets.create({ name: 'Доллары 2', kind: 'cash', currency: 'USD', openingBalanceMinor: 0, color: '#16a34a', icon: 'wallet' });
    ctx.wallets = [...ctx.wallets, usd2];
    const free = draft({ rid: 1, kind: 'transfer', amountText: '10', walletId: usd.id, toWalletId: usd2.id });
    const withFee = draft({ rid: 2, kind: 'transfer', amountText: '10', feeText: '1', walletId: usd.id, toWalletId: usd2.id });
    expect([...validateAll([free, withFee], ctx).keys()]).toEqual([2]);
    expect((await saveExpenses([free], ctx)).saved).toEqual([1]);
  });

  it('перевод без счёта назначения или между валютами не проходит проверку', async () => {
    const ctx = await setup();
    const [tjs, usd] = ctx.wallets;
    const errs = validateAll(
      [draft({ rid: 1, kind: 'transfer', walletId: tjs!.id, toWalletId: '' }), draft({ rid: 2, kind: 'transfer', walletId: tjs!.id, toWalletId: usd!.id })],
      ctx,
    );
    expect(errs.get(1)).toMatch(/Выберите счёт, куда/);
    expect(errs.get(2)).toMatch(/разных валютах/);
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
