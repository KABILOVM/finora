import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureSeeded, openStore, type Store } from '@/db';
import { checkReceipt, emptyLine, type ReceiptDraft, type ReceiptLineDraft } from './receiptAi';
import { receiptNote, saveReceipt, undoReceipt, type SaveReceiptContext } from './saveReceipt';

let store: Store;
let n = 0;
beforeEach(async () => {
  n += 1;
  store = await openStore(`receipt-user-${n}`, { deviceId: `dev-${n}`, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
});

const line = (over: Partial<ReceiptLineDraft>): ReceiptLineDraft => ({ ...emptyLine(1), name: 'Хлеб', priceText: '10', ...over });
const draft = (lines: ReceiptLineDraft[], over: Partial<ReceiptDraft> = {}): ReceiptDraft => ({ merchant: 'Корзинка', date: '2026-10-14', totalText: '', lines, ...over });

async function setup(): Promise<SaveReceiptContext & { food: string; home: string }> {
  const wallet = (await store.db.wallets.toArray()).find((w) => w.deletedAt === null)!;
  const cats = (await store.db.categories.toArray()).filter((c) => c.kind === 'expense' && c.deletedAt === null);
  const food = cats.find((c) => c.name === 'Продукты')!;
  const home = cats.find((c) => c.name !== 'Продукты')!;
  return { store, walletId: wallet.id, categories: cats.map((c) => ({ id: c.id, name: c.name })), txIds: new Map(), food: food.id, home: home.id };
}

describe('receiptNote', () => {
  it('магазин или «Чек»; при нескольких группах — с названием категории', () => {
    expect(receiptNote(' Корзинка ', null)).toBe('Корзинка');
    expect(receiptNote('', null)).toBe('Чек');
    expect(receiptNote('Корзинка', 'Продукты')).toBe('Корзинка · Продукты');
  });
});

describe('saveReceipt', () => {
  it('на каждую категорию — один расход со своими позициями; позиции в «Чеке»; кошелёк уменьшился на весь чек', async () => {
    const ctx = await setup();
    const d = draft([
      line({ rid: 1, name: 'Молоко', priceText: '26', categoryId: ctx.food }),
      line({ rid: 2, name: 'Порошок', priceText: '12,5', categoryId: ctx.home }),
      line({ rid: 3, name: 'Хлеб', priceText: '10,5', categoryId: ctx.food }),
    ]);
    const created = await saveReceipt(d, checkReceipt(d, 'TJS'), ctx);
    expect(created).toHaveLength(2);
    const byCat = new Map(created.map((t) => [t.categoryId, t]));
    expect(byCat.get(ctx.food)).toMatchObject({ kind: 'expense', amountMinor: 3650, occurredOn: '2026-10-14', walletId: ctx.walletId });
    expect(byCat.get(ctx.home)).toMatchObject({ amountMinor: 1250 });
    expect(byCat.get(ctx.food)!.note).toMatch(/^Корзинка · /);
    const items = await store.db.shopping_items.where('transactionId').equals(byCat.get(ctx.food)!.id).toArray();
    expect(items.map((i) => i.name).sort()).toEqual(['Молоко', 'Хлеб']);
    const { computeBalances } = await import('@/domain/balances');
    const wallets = (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null);
    const before = computeBalances(wallets, []).get(ctx.walletId)!;
    expect(computeBalances(wallets, await store.db.transactions.toArray()).get(ctx.walletId)).toBe(before - 4900);
  });

  it('режим поездки: метка поездки дописывается в заметку каждого расхода чека', async () => {
    const ctx = await setup();
    const d = draft([line({ rid: 1, categoryId: ctx.food }), line({ rid: 2, name: 'Порошок', categoryId: ctx.home })]);
    const created = await saveReceipt(d, checkReceipt(d, 'TJS'), { ...ctx, tripTag: 'Самарканд' });
    expect(created).toHaveLength(2);
    for (const t of created) expect(t.note).toMatch(/^Корзинка · .+ #Самарканд$/);
  });

  it('одна категория — один расход с заметкой «Магазин» (без названия категории)', async () => {
    const ctx = await setup();
    const d = draft([line({ rid: 1, categoryId: ctx.food }), line({ rid: 2, name: 'Сыр', categoryId: ctx.food })]);
    const [t] = await saveReceipt(d, checkReceipt(d, 'TJS'), ctx);
    expect(t!.note).toBe('Корзинка');
  });

  it('новая категория создаётся один раз и переиспользуется; существующая по имени выбирается, а не дублируется', async () => {
    const ctx = await setup();
    const d = draft([line({ rid: 1, newCategory: 'Фрукты' }), line({ rid: 2, name: 'Груши', newCategory: 'фрукты' }), line({ rid: 3, name: 'Чай', newCategory: 'Продукты' })]);
    const created = await saveReceipt(d, checkReceipt(d, 'TJS'), ctx);
    expect(created).toHaveLength(2);
    const fruit = (await store.db.categories.toArray()).filter((c) => c.name.toLocaleLowerCase('ru') === 'фрукты' && c.deletedAt === null);
    expect(fruit).toHaveLength(1);
    expect(fruit[0]!.kind).toBe('expense');
    expect((await store.db.categories.toArray()).filter((c) => c.name === 'Продукты' && c.deletedAt === null)).toHaveLength(1);
    expect(created.some((t) => t.categoryId === ctx.food)).toBe(true);
  });

  it('повтор с теми же номерами (двойное нажатие, повтор после сбоя) ничего не задваивает', async () => {
    const ctx = await setup();
    const d = draft([line({ rid: 1, categoryId: ctx.food }), line({ rid: 2, name: 'Мыло', categoryId: ctx.home })]);
    const check = checkReceipt(d, 'TJS');
    await saveReceipt(d, check, ctx);
    await saveReceipt(d, check, ctx);
    expect((await store.db.transactions.toArray()).filter((t) => t.deletedAt === null)).toHaveLength(2);
    expect(await store.db.shopping_items.count()).toBe(2);
  });

  it('не вышло (кошелёк в архиве) — ни расходов, ни позиций', async () => {
    const ctx = await setup();
    await store.wallets.archive(ctx.walletId);
    const d = draft([line({ rid: 1, categoryId: ctx.food }), line({ rid: 2, name: 'Мыло', categoryId: ctx.home })]);
    await expect(saveReceipt(d, checkReceipt(d, 'TJS'), ctx)).rejects.toBeInstanceOf(Error);
    expect(await store.db.transactions.count()).toBe(0);
    expect(await store.db.shopping_items.count()).toBe(0);
  });

  it('«Отменить» убирает расходы чека', async () => {
    const ctx = await setup();
    const d = draft([line({ rid: 1, categoryId: ctx.food }), line({ rid: 2, name: 'Мыло', categoryId: ctx.home })]);
    const created = await saveReceipt(d, checkReceipt(d, 'TJS'), ctx);
    await undoReceipt(store, created);
    expect((await store.db.transactions.toArray()).filter((t) => t.deletedAt === null)).toHaveLength(0);
  });
});
