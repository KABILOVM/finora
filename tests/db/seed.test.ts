import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { ensureSeeded, exportBackup, importBackup, openStore, ValidationError } from '@/db';
import { makeStore, USER_A, USER_B } from './helpers';

const EXPENSE = ['Еда', 'Продукты', 'Транспорт', 'Жильё', 'Связь', 'Здоровье', 'Покупки', 'Развлечения', 'Подписки', 'Образование', 'Долги', 'Прочее'];
const INCOME = ['Зарплата', 'Подработка', 'Бонус', 'Подарки', 'Прочее'];

describe('ensureSeeded', () => {
  it('создаёт настройки TJS, кошелёк «Наличные» и нужный набор категорий', async () => {
    const store = await makeStore();
    expect(await ensureSeeded(store)).toBe(true);

    const settings = await store.settings.get();
    const wallets = await store.db.wallets.toArray();
    const categories = await store.db.categories.orderBy('sortOrder').toArray();
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ name: 'Наличные', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, dirty: 1 });
    expect(settings).toMatchObject({ id: store.userId, baseCurrency: 'TJS', locale: 'ru', defaultWalletId: wallets[0]!.id, dirty: 1 });
    expect(categories.filter((c) => c.kind === 'expense').map((c) => c.name)).toEqual(EXPENSE);
    expect(categories.filter((c) => c.kind === 'income').map((c) => c.name)).toEqual(INCOME);
    expect(categories.every((c) => c.parentId === null && c.archivedAt === null && c.dirty === 1)).toBe(true);
  });

  it('идемпотентна: повторный вызов ничего не меняет и не дублирует', async () => {
    const store = await makeStore();
    await ensureSeeded(store);
    const before = JSON.stringify([await store.db.settings.toArray(), await store.db.wallets.toArray(), await store.db.categories.toArray()]);
    expect(await ensureSeeded(store)).toBe(false);
    expect(JSON.stringify([await store.db.settings.toArray(), await store.db.wallets.toArray(), await store.db.categories.toArray()])).toBe(before);
  });

  it('параллельные вызовы не создают дублей', async () => {
    const store = await makeStore();
    const results = await Promise.all([ensureSeeded(store), ensureSeeded(store), ensureSeeded(store)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.db.wallets.count()).toBe(1);
    expect(await store.db.categories.count()).toBe(EXPENSE.length + INCOME.length);
    expect(await store.db.settings.count()).toBe(1);
  });

  it('два «устройства» одного пользователя получают одинаковые id', async () => {
    const phone = await makeStore({ userId: USER_A, factory: new IDBFactory(), deviceId: 'device-phone-1' });
    const laptop = await makeStore({ userId: USER_A, factory: new IDBFactory(), deviceId: 'device-laptop-1' });
    await ensureSeeded(phone);
    await ensureSeeded(laptop);
    const ids = async (s: typeof phone) => ({
      wallets: (await s.db.wallets.toArray()).map((r) => r.id).sort(),
      categories: (await s.db.categories.toArray()).map((r) => r.id).sort(),
      settings: (await s.db.settings.toArray()).map((r) => r.id),
    });
    expect(await ids(phone)).toEqual(await ids(laptop));
    expect((await phone.settings.get())?.defaultWalletId).toBe((await laptop.settings.get())?.defaultWalletId);
  });

  it('у разных пользователей id разные', async () => {
    const a = await makeStore({ userId: USER_A, factory: new IDBFactory() });
    const b = await makeStore({ userId: USER_B, factory: new IDBFactory() });
    await ensureSeeded(a);
    await ensureSeeded(b);
    const idsA = new Set((await a.db.categories.toArray()).map((r) => r.id));
    for (const row of await b.db.categories.toArray()) expect(idsA.has(row.id)).toBe(false);
  });

  it('когда оба устройства потом обменялись данными, дублей нет', async () => {
    const phone = await makeStore({ userId: USER_A, factory: new IDBFactory(), deviceId: 'device-phone-1' });
    const laptop = await makeStore({ userId: USER_A, factory: new IDBFactory(), deviceId: 'device-laptop-1' });
    await ensureSeeded(phone);
    await ensureSeeded(laptop);
    // «сервер»: телефон отправил свои строки, ноутбук получает их
    let seq = 0;
    for (const table of ['settings', 'wallets', 'categories'] as const) {
      const rows = await phone.sync.listDirty(table, 100);
      await laptop.sync.applyRemotePage(table, rows.map((r) => ({ entity: r as never, serverSeq: ++seq })), seq);
    }
    expect(await laptop.db.wallets.count()).toBe(1);
    expect(await laptop.db.categories.count()).toBe(EXPENSE.length + INCOME.length);
    expect(await laptop.db.settings.count()).toBe(1);
  });

  it('если сбой посреди затравки — не остаётся ни настроек, ни полуготовых категорий; повтор доводит дело до конца', async () => {
    const store = await makeStore();
    let calls = 0;
    const real = store.categories.create.bind(store.categories);
    const spy = vi.spyOn(store.categories, 'create').mockImplementation(async (...args) => {
      if (++calls === 6) throw new ValidationError('сбой посреди затравки');
      return real(...args);
    });
    await expect(ensureSeeded(store)).rejects.toThrow(/сбой посреди/);
    spy.mockRestore();
    expect(await store.db.settings.count()).toBe(0);
    expect(await store.db.wallets.count()).toBe(0);
    expect(await store.db.categories.count()).toBe(0);
    expect(await ensureSeeded(store)).toBe(true);
    expect(await store.db.categories.count()).toBe(EXPENSE.length + INCOME.length);
  });

  it('если уже есть настройки (данные пришли с сервера) — не трогает ничего', async () => {
    const store = await makeStore();
    await store.settings.ensure({ baseCurrency: 'USD' });
    expect(await ensureSeeded(store)).toBe(false);
    expect(await store.db.wallets.count()).toBe(0);
    expect((await store.settings.get())?.baseCurrency).toBe('USD');
  });

  it('сообщает локальное изменение (чтобы синхронизатор отправил затравку)', async () => {
    const store = await makeStore();
    const seen = vi.fn();
    store.onLocalChange(seen);
    await ensureSeeded(store);
    expect(seen).toHaveBeenCalled();
    seen.mockClear();
    await ensureSeeded(store);
    expect(seen).not.toHaveBeenCalled();
  });

  it('затравка переживает экспорт → импорт на другом устройстве без дублей', async () => {
    const a = await makeStore({ factory: new IDBFactory() });
    await ensureSeeded(a);
    const file = await exportBackup(a);
    const b = await makeStore({ factory: new IDBFactory() });
    await ensureSeeded(b);
    const res = await importBackup(b, file);
    expect(res.added).toBe(0); // все id уже есть (детерминированные)
    expect(await b.db.categories.count()).toBe(EXPENSE.length + INCOME.length);
  });
});

describe('openStore: изоляция и открытие', () => {
  it('у каждого пользователя своя база с именем finora-v1-<userId>; данные не пересекаются', async () => {
    const factory = new IDBFactory();
    const a = await makeStore({ userId: USER_A, factory });
    const b = await makeStore({ userId: USER_B, factory });
    expect(a.db.name).toBe(`finora-v1-${USER_A}`);
    expect(b.db.name).toBe(`finora-v1-${USER_B}`);

    const w = await a.wallets.create({ name: 'Только мой', currency: 'TJS', kind: 'cash', openingBalanceMinor: 1, color: '#000000', icon: 'x' });
    await a.settings.ensure();
    expect(await b.db.wallets.count()).toBe(0);
    expect(await b.settings.get()).toBeNull();
    expect(await b.db.wallets.get(w.id)).toBeUndefined();
    expect((await factory.databases()).map((d) => d.name).sort()).toEqual([`finora-v1-${USER_A}`, `finora-v1-${USER_B}`].sort());

    await b.wallets.create({ name: 'Чужой кошелёк', currency: 'USD', kind: 'cash', openingBalanceMinor: 2, color: '#000000', icon: 'x' });
    expect((await a.db.wallets.toArray()).map((r) => r.name)).toEqual(['Только мой']);
  });

  it('курсоры и метки часов у разных пользователей независимы', async () => {
    const factory = new IDBFactory();
    const a = await makeStore({ userId: USER_A, factory });
    const b = await makeStore({ userId: USER_B, factory });
    await a.sync.applyRemotePage('wallets', [{ entity: { id: 'w-1', name: 'x', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x', sortOrder: 0, archivedAt: null, createdAt: '2026-10-01T00:00:00.000Z', clientUpdatedAt: '2026-10-01T00:00:00.000Z', deviceId: 'device-r-0001', deletedAt: null }, serverSeq: 9 }], 9);
    expect(await a.sync.getCursor('wallets')).toBe(9);
    expect(await b.sync.getCursor('wallets')).toBe(0);
  });

  it('данные переживают закрытие и повторное открытие', async () => {
    const factory = new IDBFactory();
    const first = await makeStore({ factory });
    const w = await first.wallets.create({ name: 'Останется', currency: 'TJS', kind: 'cash', openingBalanceMinor: 5, color: '#000000', icon: 'x' });
    first.close();
    const second = await makeStore({ factory });
    expect(await second.db.wallets.get(w.id)).toEqual(w);
  });

  it('некорректный userId отвергается', async () => {
    for (const bad of ['', '   ', 'a\nb', 'x'.repeat(129), 5 as never, null as never]) {
      await expect(openStore(bad, { dexie: { indexedDB: new IDBFactory() } })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('просит постоянное хранилище; отказ или исключение не мешают открытию', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist } });
    try {
      await makeStore();
      expect(persist).toHaveBeenCalledTimes(1);
      persist.mockRejectedValueOnce(new Error('нет'));
      await makeStore();
      persist.mockImplementationOnce(() => {
        throw new Error('сломано');
      });
      await expect(makeStore()).resolves.toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('deviceId берётся из localStorage, если не передан', async () => {
    const store = await openStore(USER_A, { dexie: { indexedDB: new IDBFactory() } });
    expect(store.deviceId).toBe(localStorage.getItem('finora:deviceId'));
    store.close();
  });
});
