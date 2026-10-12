import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, ValidationError } from '@/db';
import { priceKey, priceMemory } from '@/domain/shopping';
import { basics, makeStore } from './helpers';

const milk = { name: 'Молоко', qtyMilli: 2000, unit: 'l' } as const;

describe('ShoppingRepo: позиции', () => {
  it('add: позиция без отметки, ждёт отправки, количество — целое в тысячных', async () => {
    const store = await makeStore({ deviceId: 'dev-s1' });
    const it1 = await store.shopping.add({ name: '  Яблоки ', qtyMilli: 1400, unit: 'kg' });
    expect(it1).toMatchObject({
      name: 'Яблоки', qtyMilli: 1400, unit: 'kg', priceMinor: null, checkedAt: null, purchasedAt: null, transactionId: null,
      deletedAt: null, dirty: 1, serverSeq: null, deviceId: 'dev-s1', dirtyGroups: [],
    });
    expect(await store.db.shopping_items.get(it1.id)).toEqual(it1);
  });

  it('add с тем же id дважды (двойное нажатие) не плодит дубль', async () => {
    const store = await makeStore();
    const id = '33333333-3333-4333-8333-333333333333';
    const a = await store.shopping.add(milk, { id });
    const b = await store.shopping.add({ ...milk, name: 'Другое' }, { id });
    expect(b).toEqual(a);
    expect(await store.db.shopping_items.count()).toBe(1);
  });

  it.each([
    ['пустое название', { ...milk, name: '   ' }, /Название/],
    ['название 81 символ', { ...milk, name: 'я'.repeat(81) }, /Название/],
    ['количество 0', { ...milk, qtyMilli: 0 }, /Количество/],
    ['количество больше предела', { ...milk, qtyMilli: 1_000_000_001 }, /Количество/],
    ['дробное количество (число с плавающей точкой)', { ...milk, qtyMilli: 1.5 }, /Количество/],
    ['неизвестная единица', { ...milk, unit: 'box' }, /Единица/],
  ])('add отвергает: %s', async (_n, input, msg) => {
    const store = await makeStore();
    await expect(store.shopping.add(input as never)).rejects.toThrow(msg);
    expect(await store.db.shopping_items.count()).toBe(0);
  });

  it('add не принимает служебные поля (цену, отметку, покупку)', async () => {
    const store = await makeStore();
    await expect(store.shopping.add({ ...milk, priceMinor: 5, purchasedAt: '2026-10-10T10:00:00.000Z' } as never)).rejects.toThrow(/менять нельзя/);
  });

  it('update меняет название, количество и единицу; без изменений — не пишет', async () => {
    const store = await makeStore();
    const i = await store.shopping.add(milk);
    const u = await store.shopping.update(i.id, { name: 'Молоко 3,2%', qtyMilli: 1000 });
    expect(u).toMatchObject({ name: 'Молоко 3,2%', qtyMilli: 1000, unit: 'l' });
    expect(u.clientUpdatedAt > i.clientUpdatedAt).toBe(true);
    const same = await store.shopping.update(i.id, { qtyMilli: 1000 });
    expect(same.clientUpdatedAt).toBe(u.clientUpdatedAt);
  });

  it('check / uncheck: цена за всю позицию ≥ 0 ставится вместе с отметкой, uncheck стирает оба', async () => {
    const store = await makeStore();
    const i = await store.shopping.add(milk);
    const c = await store.shopping.check(i.id, 2600);
    expect(c).toMatchObject({ priceMinor: 2600, checkedAt: expect.any(String) });
    const c2 = await store.shopping.check(i.id, 2700);
    expect(c2).toMatchObject({ priceMinor: 2700, checkedAt: c.checkedAt });
    const free = await store.shopping.check(i.id, 0);
    expect(free.priceMinor).toBe(0);
    const u = await store.shopping.uncheck(i.id);
    expect(u).toMatchObject({ priceMinor: null, checkedAt: null });
    expect(await store.shopping.uncheck(i.id)).toEqual(u);
  });

  it.each([[-1], [1.5], [Number.NaN], [1_000_000_000_000_001]])('check отвергает цену %s', async (price) => {
    const store = await makeStore();
    const i = await store.shopping.add(milk);
    await expect(store.shopping.check(i.id, price)).rejects.toThrow(ValidationError);
    expect((await store.db.shopping_items.get(i.id))?.checkedAt).toBeNull();
  });

  it('мягкое удаление: строка остаётся с deletedAt, повтор безопасен, можно вернуть', async () => {
    const store = await makeStore();
    const i = await store.shopping.add(milk);
    const d = await store.shopping.remove(i.id);
    expect(d.deletedAt).not.toBeNull();
    expect(await store.db.shopping_items.get(i.id)).toBeDefined();
    expect((await store.shopping.remove(i.id)).clientUpdatedAt).toBe(d.clientUpdatedAt);
    await expect(store.shopping.update(i.id, { name: 'x' })).rejects.toThrow(/удалена/);
    const r = await store.shopping.restore(i.id);
    expect(r.deletedAt).toBeNull();
  });

  it('несуществующая позиция — понятная ошибка', async () => {
    const store = await makeStore();
    await expect(store.shopping.check('44444444-4444-4444-8444-444444444444', 100)).rejects.toThrow(/не найдена/);
  });
});

describe('ShoppingRepo.purchase: один расход с чеком', () => {
  async function setup() {
    const store = await makeStore();
    const b = await basics(store);
    const m = await store.shopping.add(milk);
    const a = await store.shopping.add({ name: 'Яблоки', qtyMilli: 1400, unit: 'kg' });
    const br = await store.shopping.add({ name: 'Хлеб', qtyMilli: 3000, unit: 'pcs' });
    await store.shopping.check(m.id, 2600);
    await store.shopping.check(br.id, 1050);
    return { store, ...b, m, a, br };
  }

  it('создаёт ОДИН расход на сумму отмеченных; отмеченные куплены и входят в чек; неотмеченные остаются', async () => {
    const { store, cash, food, m, a, br } = await setup();
    const res = await store.shopping.purchase({ walletId: cash.id, categoryId: food.id, occurredOn: '2026-10-10' });
    expect(res.transaction).toMatchObject({ kind: 'expense', walletId: cash.id, categoryId: food.id, amountMinor: 3650, baseAmountMinor: 3650, occurredOn: '2026-10-10', note: 'Покупки', deletedAt: null });
    expect(res.items.map((i) => i.id).sort()).toEqual([m.id, br.id].sort());
    expect(await store.db.transactions.count()).toBe(1);
    for (const id of [m.id, br.id]) {
      expect(await store.db.shopping_items.get(id)).toMatchObject({ transactionId: res.transaction.id, purchasedAt: expect.any(String), dirty: 1 });
    }
    expect(await store.db.shopping_items.get(a.id)).toMatchObject({ purchasedAt: null, transactionId: null });
    // чек находится по индексу
    expect(await store.db.shopping_items.where('transactionId').equals(res.transaction.id).count()).toBe(2);
  });

  it('купленная позиция больше не меняется: ни название, ни отметка, ни удаление', async () => {
    const { store, cash, m } = await setup();
    await store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' });
    await expect(store.shopping.update(m.id, { name: 'x' })).rejects.toThrow(/уже куплена/);
    await expect(store.shopping.uncheck(m.id)).rejects.toThrow(/уже куплена/);
    await expect(store.shopping.check(m.id, 1)).rejects.toThrow(/уже куплена/);
    await expect(store.shopping.remove(m.id)).rejects.toThrow(/уже куплена/);
  });

  it('повтор с тем же id расхода (двойное нажатие) возвращает тот же расход и ничего не создаёт', async () => {
    const { store, cash } = await setup();
    const txId = '55555555-5555-4555-8555-555555555555';
    const first = await store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', txId });
    const again = await store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10', txId });
    expect(again.transaction.id).toBe(first.transaction.id);
    expect(again.items.map((i) => i.id).sort()).toEqual(first.items.map((i) => i.id).sort());
    expect(await store.db.transactions.count()).toBe(1);
  });

  it('второй вызов с другим id, когда корзина пуста: ошибка, расхода нет', async () => {
    const { store, cash } = await setup();
    await store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' });
    await expect(store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' })).rejects.toThrow(/В корзине пусто/);
    expect(await store.db.transactions.count()).toBe(1);
  });

  it('удалённая позиция в корзине в покупку не попадает', async () => {
    const { store, cash, m, br } = await setup();
    await store.shopping.remove(br.id);
    const res = await store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' });
    expect(res.transaction.amountMinor).toBe(2600);
    expect(res.items.map((i) => i.id)).toEqual([m.id]);
  });

  it('пустая корзина — ошибка, ничего не пишется', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    await store.shopping.add(milk);
    await expect(store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' })).rejects.toThrow(/В корзине пусто/);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('все цены 0 — расход на 0 невозможен: ошибка, позиции не куплены', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const i = await store.shopping.add(milk);
    await store.shopping.check(i.id, 0);
    await expect(store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' })).rejects.toThrow(/больше нуля/);
    expect(await store.db.transactions.count()).toBe(0);
    expect((await store.db.shopping_items.get(i.id))?.purchasedAt).toBeNull();
  });

  it('кошелёк в чужой валюте отвергается: цены списка — в основной; всё откатывается целиком', async () => {
    const { store, usd, m } = await setup();
    await expect(store.shopping.purchase({ walletId: usd.id, categoryId: null, occurredOn: '2026-10-10' })).rejects.toThrow(/выберите кошелёк в этой валюте/);
    expect(await store.db.transactions.count()).toBe(0);
    expect((await store.db.shopping_items.get(m.id))?.purchasedAt).toBeNull();
  });

  it('категория дохода и несуществующий кошелёк отвергаются без записи', async () => {
    const { store, cash, salary } = await setup();
    await expect(store.shopping.purchase({ walletId: cash.id, categoryId: salary.id, occurredOn: '2026-10-10' })).rejects.toThrow(/категория расходов/);
    await expect(store.shopping.purchase({ walletId: '66666666-6666-4666-8666-666666666666', categoryId: null, occurredOn: '2026-10-10' })).rejects.toThrow(/не найден/);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('удалённый кошелёк и неверная дата — отказ', async () => {
    const { store, cash } = await setup();
    await expect(store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-02-30' })).rejects.toThrow(/Дата/);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('после покупки цена запоминается: следующий раз ожидаемая цена = цена за единицу × количество', async () => {
    const { store, cash } = await setup();
    await store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' });
    const memory = priceMemory(await store.db.shopping_items.toArray());
    expect(memory.get(priceKey('Молоко', 'l'))).toBe(1300);
    expect(memory.get(priceKey('Хлеб', 'pcs'))).toBe(350);
    expect(memory.get(priceKey('Яблоки', 'kg'))).toBeUndefined();
  });

  it('удаление расхода не ломает чек: позиции остаются купленными, цены помнятся', async () => {
    const { store, cash, m } = await setup();
    const res = await store.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' });
    await store.transactions.softDelete(res.transaction.id);
    expect(await store.db.shopping_items.get(m.id)).toMatchObject({ purchasedAt: expect.any(String), transactionId: res.transaction.id });
  });
});

describe('резервная копия: список покупок', () => {
  it('экспорт содержит позиции, импорт в чистую базу возвращает их с чеком', async () => {
    const a = await makeStore({ userId: '11111111-1111-4111-8111-111111111111' });
    const { cash } = await basics(a);
    const i = await a.shopping.add(milk);
    await a.shopping.add({ name: 'Хлеб', qtyMilli: 1000, unit: 'pcs' });
    await a.shopping.check(i.id, 2600);
    const res = await a.shopping.purchase({ walletId: cash.id, categoryId: null, occurredOn: '2026-10-10' });
    const file = await exportBackup(a);
    expect(file.shoppingItems).toHaveLength(2);

    const b = await makeStore({ userId: '11111111-1111-4111-8111-111111111111' });
    const r = await importBackup(b, JSON.parse(JSON.stringify(file)));
    expect(r.added).toBeGreaterThan(0);
    const got = await b.db.shopping_items.get(i.id);
    expect(got).toMatchObject({ name: 'Молоко', priceMinor: 2600, transactionId: res.transaction.id, dirty: 1 });
    // повтор импорта ничего не меняет
    const again = await importBackup(b, JSON.parse(JSON.stringify(file)));
    expect(again.added + again.replaced).toBe(0);
  });

  it('старая копия без блока shoppingItems читается: список пуст', async () => {
    const a = await makeStore();
    await basics(a);
    const file = JSON.parse(JSON.stringify(await exportBackup(a))) as Record<string, unknown>;
    delete file['shoppingItems'];
    const b = await makeStore();
    await expect(importBackup(b, file)).resolves.toBeDefined();
    expect(await b.db.shopping_items.count()).toBe(0);
  });

  it('позиция с неверным количеством в файле — файл отвергается целиком', async () => {
    const a = await makeStore();
    await basics(a);
    await a.shopping.add(milk);
    const file = JSON.parse(JSON.stringify(await exportBackup(a))) as { shoppingItems: Array<Record<string, unknown>> };
    file.shoppingItems[0]!['qtyMilli'] = 0.5;
    const b = await makeStore();
    await expect(importBackup(b, file)).rejects.toThrow(/Количество/);
    expect(await b.db.shopping_items.count()).toBe(0);
  });
});
