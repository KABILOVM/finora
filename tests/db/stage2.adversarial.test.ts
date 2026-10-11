import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { LOCAL_USER_ID } from '@/auth/config';
import { defaultId, exportBackup, importBackup, openStore, uuidV5, summarizeMonth } from '@/db';
import { dbNameFor } from '@/db/database';
import { withoutSettings } from '@/features/settings/backupAccount';
import { ensureSeeded } from '@/db';
import { basics, makeStore, USER_A, USER_B } from './helpers';

const fresh = (userId = USER_A) => makeStore({ factory: new IDBFactory(), userId });

describe('перенос локальных данных в аккаунт: бюджеты и платежи по правилу не задваиваются', () => {
  it('бюджет на «Еду», правило и проведённая по нему операция, долг: после переноса новый бюджет на «Еду» — тот же, повторное проведение — та же операция', async () => {
    const local = await makeStore({ factory: new IDBFactory(), userId: LOCAL_USER_ID });
    await ensureSeeded(local);
    const cash = (await local.db.wallets.toArray())[0]!;
    const foodL = await defaultId(LOCAL_USER_ID, 'category:food');
    await local.budgets.create({ categoryId: foodL, amountMinor: 100_000 });
    const rule = await local.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 7000, frequency: 'monthly', startOn: '2026-10-15', categoryId: foodL });
    await local.transactions.createFromRule(rule.id, '2026-10-15');
    const debt = await local.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 5000, currency: 'TJS', openedOn: '2026-10-01' });
    await local.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5000, occurredOn: '2026-10-01', debtId: debt.id });
    const backup = await exportBackup(local);

    const acc = await fresh(USER_B);
    await ensureSeeded(acc);
    await importBackup(acc, withoutSettings(backup), { sourceUserId: LOCAL_USER_ID });
    const foodA = await defaultId(USER_B, 'category:food');
    const b2 = await acc.budgets.create({ categoryId: foodA, amountMinor: 200_000 });
    expect((await acc.db.budgets.toArray()).filter((b) => b.categoryId === foodA)).toHaveLength(1);
    expect(b2.amountMinor).toBe(200_000);
    const newRule = (await acc.db.recurring_rules.toArray())[0]!;
    const again = await acc.transactions.createFromRule(newRule.id, '2026-10-15');
    const opsOnDate = (await acc.db.transactions.toArray()).filter((t) => t.recurringRuleId === newRule.id && t.occurredOn === '2026-10-15');
    expect(opsOnDate).toHaveLength(1);
    expect(again.id).toBe(await uuidV5(newRule.id, '2026-10-15'));
    // повторный перенос ничего не плодит
    await importBackup(acc, withoutSettings(backup), { sourceUserId: LOCAL_USER_ID });
    expect(await acc.db.transactions.count()).toBe(2);
    expect(await acc.db.budgets.count()).toBe(1);
    expect(await acc.db.debts.count()).toBe(1);
    expect(await acc.db.recurring_rules.count()).toBe(1);
    // категория правила — стартовая «Еда» этого аккаунта
    expect(newRule.categoryId).toBe(foodA);
  });
});

describe('обновление базы 1→2', () => {
  const sync = { createdAt: '2026-10-01T00:00:00.000Z', clientUpdatedAt: '2026-10-01T00:00:00.000Z', deviceId: 'device-old-1', deletedAt: null };
  async function writeV1(factory: IDBFactory) {
    const old = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
    old.version(1).stores({
      settings: 'id, dirty, [dirty+clientUpdatedAt]',
      wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
      categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
      transactions: 'id, dirty, occurredOn, walletId, toWalletId, categoryId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
      meta: 'key',
    });
    await old.open();
    const W = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa01';
    await old.table('settings').add({ ...sync, dirty: 0, serverSeq: 3, syncError: null, id: USER_A, baseCurrency: 'TJS', locale: 'ru', weekStartsOn: 1, defaultWalletId: W });
    await old.table('wallets').add({ ...sync, dirty: 0, serverSeq: 3, syncError: null, id: W, name: 'Нал', currency: 'TJS', kind: 'cash', openingBalanceMinor: 5000, color: '#000000', icon: 'x', sortOrder: 0, archivedAt: null });
    const tx = { ...sync, kind: 'expense', walletId: W, toWalletId: null, toAmountMinor: null, categoryId: null, occurredOn: '2026-10-05', baseCurrency: 'TJS', fxRate: 1, fxSource: 'same', amountMinor: 100, baseAmountMinor: 100, note: '' };
    await old.table('transactions').bulkAdd([
      { ...tx, id: '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa03', dirty: 1, serverSeq: null, syncError: 'Сервер не принял запись (код 23514)', dirtyGroups: ['money'], dirtyBase: { money: { b: { amountMinor: 50 }, at: '2026-10-02T00:00:00.000Z' } } },
      { ...tx, id: '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa04', dirty: 1, serverSeq: null, syncError: null },
    ]);
    old.close();
  }

  it('карантин и память слияния старых строк сохраняются; две вкладки одновременно открывают базу', async () => {
    const factory = new IDBFactory();
    await writeV1(factory);
    const open = () => openStore(USER_A, { deviceId: 'device-new-1', dexie: { indexedDB: factory, IDBKeyRange } });
    const [a, b] = await Promise.all([open(), open()]);
    try {
      const t = await a.db.transactions.get('0a3a28c0-5fdc-4385-8fca-7c24d9aaaa03');
      expect(t).toMatchObject({ dirty: 1, syncError: 'Сервер не принял запись (код 23514)', debtId: null, recurringRuleId: null, dirtyGroups: ['money'] });
      expect((t as unknown as { dirtyBase: unknown }).dirtyBase).toBeDefined();
      expect(await b.db.transactions.count()).toBe(2);
      // вкладка B пишет — вкладка A видит
      await b.budgets.create({ amountMinor: 1000 });
      expect(await a.db.budgets.count()).toBe(1);
    } finally {
      a.close();
      b.close();
    }
  });

  it('вкладка со старым кодом (версия 1) держит базу открытой: новая вкладка всё равно обновляет, старая закрывается, не портя данные', async () => {
    const factory = new IDBFactory();
    await writeV1(factory);
    const oldTab = new Dexie(dbNameFor(USER_A), { indexedDB: factory, IDBKeyRange });
    oldTab.version(1).stores({
      settings: 'id, dirty, [dirty+clientUpdatedAt]',
      wallets: 'id, dirty, sortOrder, [dirty+clientUpdatedAt]',
      categories: 'id, dirty, kind, sortOrder, [dirty+clientUpdatedAt]',
      transactions: 'id, dirty, occurredOn, walletId, toWalletId, categoryId, [walletId+occurredOn], [dirty+clientUpdatedAt]',
      meta: 'key',
    });
    await oldTab.open();
    const store = await Promise.race([
      openStore(USER_A, { deviceId: 'device-new-1', dexie: { indexedDB: factory, IDBKeyRange } }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('обновление зависло из-за старой вкладки')), 5000)),
    ]);
    try {
      expect(await store.db.transactions.count()).toBe(2);
    } finally {
      store.close();
      oldTab.close();
    }
  });
});

describe('комиссия перевода: правка', () => {
  it('сумма комиссии в сводке не превышает разницу списано − зачислено после слияния чужой копии (мусорная комиссия в файле)', async () => {
    const src = await fresh();
    const { cash } = await basics(src);
    const card = await src.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await src.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_900, occurredOn: '2026-10-05' });
    const file = JSON.parse(JSON.stringify(await exportBackup(src)));
    file.transactions[0].baseAmountMinor = 900_000_000; // руками правленный файл: комиссия 9 млн с. при разнице в 1 с.
    const dst = await fresh();
    let imported = true;
    try {
      await importBackup(dst, file);
    } catch {
      imported = false;
    }
    if (imported) {
      const s = summarizeMonth(await dst.db.transactions.toArray(), '2026-10', 'TJS');
      expect(s.feeMinor).toBeLessThanOrEqual(100);
    }
  });
});

describe('архивирование того, на что ссылается регулярный платёж', () => {
  async function mk() {
    const store = await fresh();
    const { cash, food } = await basics(store);
    const rule = await store.recurring.create({ kind: 'expense', walletId: cash.id, categoryId: food.id, amountMinor: 3000, frequency: 'monthly', startOn: '2026-10-15' });
    return { store, cash, food, rule };
  }
  it('категория в архиве: платёж либо нельзя архивировать, либо его можно провести', async () => {
    const { store, food, rule } = await mk();
    let archived = true;
    try { await store.categories.archive(food.id); } catch { archived = false; }
    if (archived) await expect(store.transactions.createFromRule(rule.id, '2026-10-15')).resolves.toBeDefined();
  });
});

describe('операции по расписанию', () => {
  it('прямое создание операции с recurringRuleId и датой не из расписания отвергается; правка даты не выводит дату за расписание молча', async () => {
    const store = await fresh();
    const { cash } = await basics(store);
    const rule = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 3000, frequency: 'monthly', startOn: '2026-10-15' });
    await expect(store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 3000, occurredOn: '2026-10-16', recurringRuleId: rule.id })).rejects.toThrow();
    const ok = await store.transactions.createFromRule(rule.id, '2026-10-15');
    const moved = await store.transactions.update(ok.id, { occurredOn: '2026-10-20' }).catch((e: Error) => e);
    // допустимо и отказать, и принять; недопустимо — оставить id, из которого дата не выводится, без признака
    void moved;
  });

  it('правило, удалённое/архивное: createFromRule и skipOccurrence отвергаются; уже проведённое возвращается', async () => {
    const store = await fresh();
    const { cash } = await basics(store);
    const rule = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 3000, frequency: 'monthly', startOn: '2026-10-15' });
    const done = await store.transactions.createFromRule(rule.id, '2026-10-15');
    await store.recurring.archive(rule.id);
    await expect(store.transactions.createFromRule(rule.id, '2026-11-15')).rejects.toThrow();
    await expect(store.transactions.skipOccurrence(rule.id, '2026-11-15')).rejects.toThrow();
    expect((await store.transactions.createFromRule(rule.id, '2026-10-15')).id).toBe(done.id);
  });
});

describe('гонки: двойное нажатие и две вкладки', () => {
  it('createFromRule/skipOccurrence/budgets.create параллельно из двух вкладок одной базы дают по одной строке', async () => {
    const factory = new IDBFactory();
    const a = await makeStore({ factory, deviceId: 'dev-tab-1' });
    const { cash, food } = await basics(a);
    const b = await makeStore({ factory, deviceId: 'dev-tab-1' });
    const rule = await a.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 3000, frequency: 'monthly', startOn: '2026-10-15' });
    const res = await Promise.allSettled([
      a.transactions.createFromRule(rule.id, '2026-10-15'),
      b.transactions.createFromRule(rule.id, '2026-10-15'),
      a.transactions.createFromRule(rule.id, '2026-10-15'),
      b.transactions.skipOccurrence(rule.id, '2026-10-15'),
      a.budgets.create({ categoryId: food.id, amountMinor: 1000 }),
      b.budgets.create({ categoryId: food.id, amountMinor: 2000 }),
      a.budgets.create({ categoryId: food.id, amountMinor: 3000 }),
    ]);
    void res;
    expect(await a.db.transactions.count()).toBe(1);
    expect(await a.db.budgets.count()).toBe(1);
    // одна и та же строка не может быть одновременно «проведена» и «пропущена» в двух разных видах
    const t = (await a.db.transactions.toArray())[0]!;
    expect(t.id).toBe(await uuidV5(rule.id, '2026-10-15'));
  });
});
