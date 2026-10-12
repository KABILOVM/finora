// @vitest-environment node
/**
 * Два устройства одного пользователя + сервер в памяти: список покупок.
 * Главное: правки разных частей позиции складываются, купленное с чеком доезжает целиком (позиции + расход),
 * а гонка «куплено / достали из корзины» не ломает правила сервера и не уводит ничего в карантин.
 */
import { describe, expect, it } from 'vitest';
import { exportBackup, type Store } from '@/db';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { USER, openDevice, type Device } from '../sync/engineHarness';

const BASE = Date.UTC(2026, 9, 10, 12, 0, 0);

async function pair(server: MemoryServer) {
  const clock = { a: BASE, b: BASE };
  const a = await openDevice(server, 'dev-a', { seed: true, now: () => clock.a });
  await a.engine.syncNow();
  const b = await openDevice(server, 'dev-b', { seed: true, now: () => clock.b });
  await b.engine.syncNow();
  return { a, b, clock };
}
async function converge(...devices: Device[]) {
  for (let i = 0; i < 4; i++) for (const d of devices) await d.engine.syncNow();
}
const state = async (s: Store) => ({ ...(await exportBackup(s)), exportedAt: '' });
const cash = async (s: Store) => (await s.db.wallets.orderBy('sortOrder').first())!;
const noTrouble = (d: Device) => expect(d.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });

describe('список покупок на двух устройствах', () => {
  it('позиции и покупка с чеком доезжают до второго устройства; состояние одинаковое', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const milk = await a.store.shopping.add({ name: 'Молоко', qtyMilli: 2000, unit: 'l' });
    const bread = await a.store.shopping.add({ name: 'Хлеб', qtyMilli: 3000, unit: 'pcs' });
    await a.store.shopping.check(milk.id, 2600);
    clock.a = BASE + 1_000;
    const res = await a.store.shopping.purchase({ walletId: (await cash(a.store)).id, categoryId: null, occurredOn: '2026-10-10' });
    await converge(a, b);

    expect(server.dump(USER, 'shopping_items')).toHaveLength(2);
    const onB = await b.store.db.shopping_items.toArray();
    expect(onB.find((i) => i.id === milk.id)).toMatchObject({ transactionId: res.transaction.id, priceMinor: 2600, dirty: 0 });
    expect(onB.find((i) => i.id === bread.id)).toMatchObject({ purchasedAt: null, transactionId: null });
    expect(await b.store.db.transactions.get(res.transaction.id)).toMatchObject({ amountMinor: 2600 });
    expect(await state(a.store)).toEqual(await state(b.store));
    noTrouble(a);
    noTrouble(b);
  });

  it('офлайн: название меняют на одном, отмечают на другом — обе правки сохраняются', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const it1 = await a.store.shopping.add({ name: 'Молоко', qtyMilli: 2000, unit: 'l' });
    await converge(a, b);
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.shopping.update(it1.id, { name: 'Молоко 3,2%', qtyMilli: 1000 });
    clock.b = BASE + 2_000;
    await b.store.shopping.check(it1.id, 1300);
    server.setOnline(true);
    await converge(a, b);
    for (const d of [a, b]) {
      expect(await d.store.db.shopping_items.get(it1.id)).toMatchObject({ name: 'Молоко 3,2%', qtyMilli: 1000, priceMinor: 1300, dirty: 0 });
      noTrouble(d);
    }
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('гонка: одно устройство подтвердило покупку, другое достало позицию из корзины — сходится без отказов сервера', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const it1 = await a.store.shopping.add({ name: 'Молоко', qtyMilli: 2000, unit: 'l' });
    await a.store.shopping.check(it1.id, 2600);
    await converge(a, b);
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.shopping.purchase({ walletId: (await cash(a.store)).id, categoryId: null, occurredOn: '2026-10-10' });
    clock.b = BASE + 2_000;
    await b.store.shopping.uncheck(it1.id);
    server.setOnline(true);
    await converge(a, b);
    // позиция целиком в одном из двух согласованных состояний (отмечена+цена+чек либо ничего): иначе сервер отверг бы строку
    const rows = server.dump(USER, 'shopping_items');
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    const bought = r['purchased_at'] !== null;
    expect([r['checked_at'] !== null, r['price_minor'] !== null, r['transaction_id'] !== null]).toEqual(bought ? [true, true, true] : [false, false, false]);
    for (const d of [a, b]) noTrouble(d);
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('удаление позиции на одном устройстве доезжает на другое (мягко, строка остаётся)', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const it1 = await a.store.shopping.add({ name: 'Сыр', qtyMilli: 500, unit: 'kg' });
    await converge(a, b);
    clock.b = BASE + 1_000;
    await b.store.shopping.remove(it1.id);
    await converge(a, b);
    expect((await a.store.db.shopping_items.get(it1.id))?.deletedAt).not.toBeNull();
    expect(server.dump(USER, 'shopping_items')).toHaveLength(1);
    noTrouble(a);
    noTrouble(b);
  });
});
