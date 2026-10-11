import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_USER_ID } from '@/auth/config';
import { ensureSeeded, exportBackup, importBackup, openStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { withoutSettings } from '@/features/settings/backupAccount';
import { fixtureText } from './__fixtures__/load';
import { loadExisting } from './existing';
import { computeIds } from './ids';
import { parseZenmoney } from './parse';
import { buildPlan } from './plan';
import { runImport } from './runImport';
import type { ImportPlan } from './types';

/**
 * Атаки на идемпотентность: «повторная загрузка того же файла ничего не дублирует».
 * Здесь проверяем, что обещание держится не только в «чистой» базе, но и после действий, которые человек делает в этом
 * же приложении: перенос данных локального режима в аккаунт, ручной выбор кошелька при первой загрузке.
 */

const ACCOUNT_USER = '7d1f6f3e-4a0b-4b1e-9d3a-2f5a8c9e1b77';
const stores: Store[] = [];

async function fresh(userId: string): Promise<Store> {
  const store = await openStore(userId, { deviceId: `dev-${userId.slice(0, 4)}`, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  stores.push(store);
  await ensureSeeded(store);
  return store;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

async function planFor(store: Store, text: string, choices: Record<string, string> = {}): Promise<ImportPlan> {
  const parsed = parseZenmoney(text);
  const ids = await computeIds(store.userId, parsed);
  const [wallets, categories, existing] = await Promise.all([store.db.wallets.toArray(), store.db.categories.toArray(), loadExisting(store)]);
  return buildPlan({
    parsed,
    ids,
    baseCurrency: 'TJS',
    wallets,
    categories,
    existing,
    walletChoices: choices,
    rates: { USD: 10.9 },
  });
}

const live = (store: Store) => store.db.transactions.filter((t) => t.deletedAt === null).toArray();

describe('идемпотентность импорта: после переноса данных локального режима в аккаунт', () => {
  it('тот же файл, загруженный в аккаунте после переноса, не задваивает историю', async () => {
    const text = fixtureText('basic.csv');

    // 1) человек без входа (локальный режим) импортирует выгрузку
    const local = await fresh(LOCAL_USER_ID);
    await runImport(local, await planFor(local, text));
    const added = (await live(local)).length;
    expect(added).toBe(10);

    // 2) подключил облако и перенёс записи в аккаунт — ровно так, как это делает приложение (transferLocalData)
    const account = await fresh(ACCOUNT_USER);
    const backup = await exportBackup(local);
    await importBackup(account, withoutSettings(backup), { sourceUserId: LOCAL_USER_ID });
    expect((await live(account)).length).toBe(added);

    // 3) на следующий месяц снова загружает ту же выгрузку (она всегда выгружается целиком)
    const plan = await planFor(account, text);
    await runImport(account, plan);

    // каждая строка файла должна остаться одной операцией
    expect((await live(account)).length).toBe(added);
  });
});

describe('идемпотентность импорта: ручной выбор кошелька при первой загрузке', () => {
  it('исправленные строки второй загрузки попадают в тот же кошелёк, куда человек направил счёт в первый раз', async () => {
    const text = fixtureText('basic.csv');
    const store = await fresh(ACCOUNT_USER);

    // человек направил счёт «Карта Алиф» в свой кошелёк «Моя карта»
    const mine = await store.wallets.create({ name: 'Моя карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
    const first = await planFor(store, text, { 'карта алиф|TJS': mine.id });
    expect(first.wallets.find((w) => w.name === 'Карта Алиф')!.target).toMatchObject({ kind: 'existing', id: mine.id });
    await runImport(store, first);
    const before = (await live(store)).filter((t) => t.walletId === mine.id).length;
    expect(before).toBeGreaterThan(0);

    // в Zenmoney появилась ещё одна операция по той же карте; человек снова загружает свежую выгрузку, ничего не меняя вручную
    const text2 = text.trimEnd() + '\n2026-09-20,Продукты,Корвон,Новая покупка,Карта Алиф,77.00,TJS,,0,,2026-09-20 10:00:00,2026-09-20 10:00:00,\n';
    const second = await planFor(store, text2);
    await runImport(store, second);

    // новая покупка по той же карте обязана лежать там же, где вся её история
    const all = await live(store);
    const novelty = all.find((t) => t.note === 'Корвон — Новая покупка')!;
    expect(novelty.walletId).toBe(mine.id);
    const stray = (await store.db.wallets.toArray()).filter((w) => w.name === 'Карта Алиф');
    expect(stray).toHaveLength(0);
  });

  it('«Остаток по файлу» нового кошелька не считает деньги, которые лежат в другом кошельке (иначе сверка с банком врёт и деньги удвоятся)', async () => {
    const text = fixtureText('basic.csv');
    const store = await fresh(ACCOUNT_USER);
    const mine = await store.wallets.create({ name: 'Моя карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
    await runImport(store, await planFor(store, text, { 'карта алиф|TJS': mine.id }));

    // вторая загрузка: в файле одна новая покупка по той же карте, а человек сам выбрал «создать новый кошелёк» для этого счёта
    const text2 = text.trimEnd() + '\n2026-09-20,Продукты,Корвон,Новая покупка,Карта Алиф,77.00,TJS,,0,,2026-09-20 10:00:00,2026-09-20 10:00:00,\n';
    const second = await planFor(store, text2, { 'карта алиф|TJS': 'new' });
    expect(second.wallets.find((w) => w.name === 'Карта Алиф')!.target.kind).toBe('create');
    const report = await runImport(store, second);

    const wallets = await store.db.wallets.filter((w) => w.deletedAt === null).toArray();
    const bal = computeBalances(wallets, await store.db.transactions.toArray());
    const line = report.reconcile.find((r) => r.name === 'Карта Алиф' && r.created)!;
    expect(line).toBeDefined();
    // человек сверит «остаток по файлу» с банком и поправит начальный остаток кошелька: у нового кошелька настоящий остаток — только новая покупка
    expect(line.fileBalanceMinor).toBe(-7700);
    expect(bal.get(line.id)).toBe(line.fileBalanceMinor);
  });

  it('операция, которую человек перенёс в другой кошелёк, не входит в «остаток по файлу» кошелька импорта', async () => {
    const text = fixtureText('basic.csv');
    const store = await fresh(ACCOUNT_USER);
    await runImport(store, await planFor(store, text));

    // человек перенёс одну покупку («Хлеб и молоко», 120,50) из кошелька импорта в «Наличные»
    const cash = (await store.db.wallets.toArray()).find((w) => w.name === 'Наличные' && w.currency === 'TJS')!;
    const bread = (await live(store)).find((t) => t.note === 'Корвон — Хлеб и молоко')!;
    await store.transactions.update(bread.id, { walletId: cash.id });

    const text2 = text.trimEnd() + '\n2026-09-20,Продукты,Корвон,Новая покупка,Карта Алиф,77.00,TJS,,0,,2026-09-20 10:00:00,2026-09-20 10:00:00,\n';
    const report = await runImport(store, await planFor(store, text2));

    const wallets = await store.db.wallets.filter((w) => w.deletedAt === null).toArray();
    const bal = computeBalances(wallets, await store.db.transactions.toArray());
    const line = report.reconcile.find((r) => r.name === 'Карта Алиф')!;
    expect(line).toBeDefined();
    expect(line.created).toBe(false);
    expect(bal.get(line.id)).toBe(line.fileBalanceMinor);
  });
});
