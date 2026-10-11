import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureSeeded, openStore, type Store } from '@/db';
import { addWalletOnce, editWallet, removeWallet, setBaseCurrency, setCategoryEnabled } from './onboardingActions';

let store: Store;
let n = 0;

beforeEach(async () => {
  n += 1;
  store = await openStore(`onb-user-${n}`, { deviceId: `dev-${n}`, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
});

const live = async () => (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null && w.archivedAt === null);

describe('addWalletOnce', () => {
  it('создаёт кошелёк, а повтор с тем же названием возвращает существующий', async () => {
    const draft = { name: 'Карта', kind: 'card' as const, currency: 'TJS', openingBalanceMinor: 12_000 };
    const a = await addWalletOnce(store, draft);
    const b = await addWalletOnce(store, { ...draft, name: ' карта ' });
    expect(a.status).toBe('created');
    expect(b.status).toBe('exists');
    expect(b.wallet.id).toBe(a.wallet.id);
    expect((await live()).map((w) => w.name).sort()).toEqual(['Карта', 'Наличные']);
  });
  it('двойной тап (два вызова разом) даёт один кошелёк', async () => {
    const draft = { name: 'Накопления', kind: 'savings' as const, currency: 'TJS', openingBalanceMinor: 0 };
    const results = await Promise.allSettled([addWalletOnce(store, draft), addWalletOnce(store, draft)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect((await live()).filter((w) => w.name === 'Накопления')).toHaveLength(1);
  });
  it('пустое название — понятная ошибка, ничего не создаётся', async () => {
    await expect(addWalletOnce(store, { name: '  ', kind: 'cash', currency: 'TJS', openingBalanceMinor: 0 })).rejects.toThrow('Введите название');
    expect(await live()).toHaveLength(1);
  });
});

describe('правка и удаление', () => {
  it('editWallet меняет остаток и не даёт занять чужое название', async () => {
    const [cash] = await live();
    const card = (await addWalletOnce(store, { name: 'Карта', kind: 'card', currency: 'TJS', openingBalanceMinor: 0 })).wallet;
    const edited = await editWallet(store, cash!, { name: 'Наличные', kind: 'cash', currency: 'TJS', openingBalanceMinor: 5_000 });
    expect(edited.openingBalanceMinor).toBe(5_000);
    await expect(editWallet(store, card, { name: 'наличные', kind: 'card', currency: 'TJS', openingBalanceMinor: 0 })).rejects.toThrow('уже есть');
  });
  it('removeWallet убирает в архив и переставляет «по умолчанию» на оставшийся', async () => {
    const [cash] = await live();
    const card = (await addWalletOnce(store, { name: 'Карта', kind: 'card', currency: 'TJS', openingBalanceMinor: 0 })).wallet;
    expect((await store.settings.get())?.defaultWalletId).toBe(cash!.id);
    await removeWallet(store, cash!);
    expect((await live()).map((w) => w.id)).toEqual([card.id]);
    expect((await store.settings.get())?.defaultWalletId).toBe(card.id);
  });
});

describe('setBaseCurrency', () => {
  it('меняет валюту и переводит нетронутый «Наличные» в неё; повтор ничего не ломает', async () => {
    await setBaseCurrency(store, 'USD');
    await setBaseCurrency(store, 'USD');
    expect((await store.settings.get())?.baseCurrency).toBe('USD');
    expect((await live())[0]?.currency).toBe('USD');
  });
  it('если по кошельку уже есть операции, его валюта не трогается', async () => {
    const [cash] = await live();
    await store.transactions.create({ kind: 'income', walletId: cash!.id, amountMinor: 100, occurredOn: '2026-10-11' });
    await setBaseCurrency(store, 'EUR');
    expect((await store.settings.get())?.baseCurrency).toBe('EUR');
    expect((await live())[0]?.currency).toBe('TJS');
  });
});

describe('категории', () => {
  it('снять и вернуть категорию', async () => {
    const [food] = (await store.db.categories.toArray()).filter((c) => c.name === 'Еда');
    await setCategoryEnabled(store, food!.id, false);
    expect((await store.db.categories.get(food!.id))?.archivedAt).not.toBeNull();
    await setCategoryEnabled(store, food!.id, true);
    expect((await store.db.categories.get(food!.id))?.archivedAt).toBeNull();
  });
});
