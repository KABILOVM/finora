import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, type Store } from '@/db';
import { toWire } from '@/sync/tables';
import { newWatch, noteIncoming, reconcile } from '@/sync/reconcile';
import { basics, makeStore, remoteWallet, stamp } from './helpers';

/** (в) Запись репозиториев: какие группы (LocalFields.dirtyGroups) появляются при каких правках. */

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);

type Tbl = 'wallets' | 'categories' | 'transactions' | 'settings';

/** Сервер принял отправку: строка помечена отправленной. Память о правках остаётся до подтверждения (см. confirm). */
async function sent(store: Store, table: Tbl, id: string): Promise<void> {
  const row = (await store.db.table(table).get(id)) as { clientUpdatedAt: string; deviceId: string };
  await store.sync.markPushed(table, [{ id, clientUpdatedAt: row.clientUpdatedAt, deviceId: row.deviceId }]);
}

/** Следующее получение вернуло ровно нашу отправленную версию: подтверждение. */
async function confirm(store: Store, table: Tbl, id: string): Promise<void> {
  const row = (await store.db.table(table).get(id)) as Record<string, unknown>;
  const { dirty: _d, serverSeq, syncError: _e, dirtyGroups: _g, dirtyBase: _b, ...entity } = row;
  void [_d, _e, _g, _b];
  const seq = ((serverSeq as number | null) ?? 0) + 1;
  await store.sync.applyRemotePage(table, [{ entity: entity as never, serverSeq: seq }], seq);
}

/** Строка отправлена и подтверждена: «чистая», без следов правок. */
async function clean(store: Store, table: Tbl, id: string): Promise<void> {
  await sent(store, table, id);
  await confirm(store, table, id);
}

async function setup() {
  const store = await makeStore();
  const b = await basics(store);
  const tx = await store.transactions.create({ kind: 'expense', walletId: b.cash.id, amountMinor: 5_000, categoryId: b.food.id, occurredOn: '2026-10-05', note: 'обед' });
  for (const [t, id] of [['wallets', b.cash.id], ['wallets', b.usd.id], ['categories', b.food.id], ['categories', b.salary.id], ['transactions', tx.id]] as const) {
    await clean(store, t, id);
  }
  await clean(store, 'settings', store.userId);
  return { store, ...b, tx };
}

describe('создание и «вся запись»', () => {
  it('новая строка: dirty=1 и dirtyGroups ПУСТ (создана здесь, правок нет), памяти нет — у всех четырёх сущностей', async () => {
    const store = await makeStore();
    const b = await basics(store);
    const tx = await store.transactions.create({ kind: 'expense', walletId: b.cash.id, amountMinor: 1, occurredOn: '2026-10-05' });
    const settings = await store.settings.get();
    for (const row of [b.cash, b.food, tx, settings!]) {
      expect(row.dirty).toBe(1);
      expect(row.dirtyGroups).toEqual([]);
      expect('dirtyBase' in row).toBe(false);
    }
    expect((await store.db.wallets.get(b.cash.id))!.dirtyGroups).toEqual([]);
  });

  it('правка новой (ещё не отправленной) строки ставит группы и помнит, как её создали: ответ на создание мог потеряться', async () => {
    const store = await makeStore();
    const b = await basics(store);
    const edited = await store.wallets.update(b.cash.id, { name: 'Кошелёк 2' });
    expect(edited.dirty).toBe(1);
    expect(edited.dirtyGroups).toEqual(['name']);
    expect((edited as { dirtyBase?: unknown }).dirtyBase).toMatchObject({ name: { b: { name: b.cash.name } } });
    const archived = await store.wallets.archive(b.cash.id);
    expect(archived.dirtyGroups).toEqual(['name', 'archived']);
  });

  it('грязная строка БЕЗ групп (как до обновления приложения) остаётся без групп после правок', async () => {
    const store = await makeStore({ now: () => T0 });
    await store.sync.applyRemotePage('wallets', [{ entity: remoteWallet({ id: 'w-1' }), serverSeq: 1 }], 1);
    await store.db.wallets.update('w-1', { dirty: 1 }); // как строка, записанная старой версией: грязная, групп нет
    const row = await store.wallets.update('w-1', { name: 'новое' });
    expect(row.dirty).toBe(1);
    expect(row.dirtyGroups).toBeUndefined();
  });
});

describe('чистая строка: ровно изменённые группы', () => {
  it('операция: сумма → money; дата → date; заметка → note; удаление/восстановление → deleted', async () => {
    const { store, tx } = await setup();
    const a = await store.transactions.update(tx.id, { amountMinor: 6_000 });
    expect(a.dirtyGroups).toEqual(['money']);
    await clean(store, 'transactions', tx.id);
    expect((await store.transactions.update(tx.id, { occurredOn: '2026-10-06' })).dirtyGroups).toEqual(['date']);
    await clean(store, 'transactions', tx.id);
    expect((await store.transactions.update(tx.id, { note: 'ужин' })).dirtyGroups).toEqual(['note']);
    await clean(store, 'transactions', tx.id);
    expect((await store.transactions.softDelete(tx.id)).dirtyGroups).toEqual(['deleted']);
    await clean(store, 'transactions', tx.id);
    expect((await store.transactions.restore(tx.id)).dirtyGroups).toEqual(['deleted']);
  });

  it('операция: кошелёк, категория и вид — группа money (вместе с суммой и курсом)', async () => {
    const { store, tx, usd } = await setup();
    const row = await store.transactions.update(tx.id, { categoryId: null });
    expect(row.dirtyGroups).toEqual(['money']);
    await clean(store, 'transactions', tx.id);
    const kind = await store.transactions.update(tx.id, { kind: 'income' });
    expect(kind.dirtyGroups).toEqual(['money']);
    await clean(store, 'transactions', tx.id);
    const w = await store.transactions.update(tx.id, { walletId: usd.id, fx: { rate: 10, source: 'manual' } });
    expect(w.dirtyGroups).toEqual(['money']);
    expect(w.fxSource).toBe('manual');
  });

  it('операция: несколько правок за раз — несколько групп (в каноническом порядке)', async () => {
    const { store, tx } = await setup();
    const row = await store.transactions.update(tx.id, { note: 'другое', amountMinor: 1_234, occurredOn: '2026-10-07' });
    expect(row.dirtyGroups).toEqual(['money', 'date', 'note']);
  });

  it('кошелёк: имя → name; цвет/значок/порядок → look; сумма на начало → money; архив → archived', async () => {
    const { store, cash } = await setup();
    expect((await store.wallets.update(cash.id, { name: 'Кошелёк 2' })).dirtyGroups).toEqual(['name']);
    await clean(store, 'wallets', cash.id);
    expect((await store.wallets.update(cash.id, { color: '#ff0000' })).dirtyGroups).toEqual(['look']);
    await clean(store, 'wallets', cash.id);
    expect((await store.wallets.update(cash.id, { icon: 'z' })).dirtyGroups).toEqual(['look']);
    await clean(store, 'wallets', cash.id);
    expect((await store.wallets.update(cash.id, { sortOrder: 9 })).dirtyGroups).toEqual(['look']);
    await clean(store, 'wallets', cash.id);
    expect((await store.wallets.update(cash.id, { openingBalanceMinor: 777 })).dirtyGroups).toEqual(['money']);
    await clean(store, 'wallets', cash.id);
    expect((await store.wallets.archive(cash.id)).dirtyGroups).toEqual(['archived']);
    await clean(store, 'wallets', cash.id);
    expect((await store.wallets.restore(cash.id)).dirtyGroups).toEqual(['archived']);
  });

  it('кошелёк: валюта и вид — money (пока по кошельку нет операций)', async () => {
    const { store, usd } = await setup();
    expect((await store.wallets.update(usd.id, { currency: 'EUR', kind: 'card' })).dirtyGroups).toEqual(['money']);
  });

  it('категория: имя → name; вид/родитель → kind; цвет → look; архив → archived', async () => {
    const { store, salary, food } = await setup();
    expect((await store.categories.update(food.id, { name: 'Кафе' })).dirtyGroups).toEqual(['name']);
    await clean(store, 'categories', food.id);
    expect((await store.categories.update(food.id, { color: '#00ff00' })).dirtyGroups).toEqual(['look']);
    await clean(store, 'categories', food.id);
    expect((await store.categories.archive(food.id)).dirtyGroups).toEqual(['archived']);
    await clean(store, 'categories', food.id);
    expect((await store.categories.restore(food.id)).dirtyGroups).toEqual(['archived']);
    // вид меняется только у категории без операций
    expect((await store.categories.update(salary.id, { kind: 'expense' })).dirtyGroups).toEqual(['kind']);
    await clean(store, 'categories', salary.id);
    expect((await store.categories.update(salary.id, { parentId: food.id })).dirtyGroups).toEqual(['kind']);
  });

  it('настройки: неделя → week; кошелёк по умолчанию → defaultWallet; базовая валюта → baseCurrency', async () => {
    const { store, cash } = await setup();
    expect((await store.settings.update({ weekStartsOn: 0 })).dirtyGroups).toEqual(['week']);
    await clean(store, 'settings', store.userId);
    expect((await store.settings.update({ defaultWalletId: cash.id })).dirtyGroups).toEqual(['defaultWallet']);
    await clean(store, 'settings', store.userId);
    expect((await store.settings.update({ baseCurrency: 'USD' })).dirtyGroups).toEqual(['baseCurrency']);
    await clean(store, 'settings', store.userId);
    expect((await store.settings.update({ weekStartsOn: 1, defaultWalletId: null })).dirtyGroups).toEqual(['week', 'defaultWallet']);
  });

  it('правка, ничего не меняющая, строку не трогает', async () => {
    const { store, cash, tx } = await setup();
    const before = await store.db.wallets.get(cash.id);
    await store.wallets.update(cash.id, { name: cash.name });
    expect(await store.db.wallets.get(cash.id)).toEqual(before);
    const beforeTx = await store.db.transactions.get(tx.id);
    await store.transactions.update(tx.id, { note: tx.note });
    expect(await store.db.transactions.get(tx.id)).toEqual(beforeTx);
  });
});

describe('грязная строка с группами: объединение', () => {
  it('следующие правки добавляют группы к прежним (без повторов)', async () => {
    const { store, tx } = await setup();
    expect((await store.transactions.update(tx.id, { note: 'a' })).dirtyGroups).toEqual(['note']);
    expect((await store.transactions.update(tx.id, { amountMinor: 1_111 })).dirtyGroups).toEqual(['money', 'note']);
    expect((await store.transactions.update(tx.id, { note: 'b' })).dirtyGroups).toEqual(['money', 'note']);
    expect((await store.transactions.softDelete(tx.id)).dirtyGroups).toEqual(['money', 'note', 'deleted']);
    expect((await store.db.transactions.get(tx.id))?.dirtyGroups).toEqual(['money', 'note', 'deleted']);
  });

  it('карантин снимается правкой, группы сохраняются', async () => {
    const { store, cash } = await setup();
    await store.wallets.update(cash.id, { name: 'X' });
    await store.sync.quarantine('wallets', [cash.id], 'отказ');
    const row = await store.wallets.update(cash.id, { color: '#123456' });
    expect(row).toMatchObject({ syncError: null, dirtyGroups: ['name', 'look'] });
  });

  it('повреждённый или чужой список групп трактуется как «вся запись» и не размножается', async () => {
    const { store, cash } = await setup();
    await store.db.wallets.update(cash.id, { dirty: 1, dirtyGroups: ['name', 'нет-такой'] });
    const row = await store.wallets.update(cash.id, { color: '#654321' });
    expect(row.dirtyGroups).toBeUndefined();
  });
});

describe('markPushed и dirtyGroups', () => {
  it('совпала версия → dirty=0, но память о правках остаётся до подтверждения с сервера; подтверждение её стирает', async () => {
    const { store, cash } = await setup();
    const row = await store.wallets.update(cash.id, { name: 'N' });
    expect(row.dirtyGroups).toEqual(['name']);
    await sent(store, 'wallets', cash.id);
    const after = await store.db.wallets.get(cash.id);
    expect(after).toMatchObject({ dirty: 0, dirtyGroups: ['name'] });
    await confirm(store, 'wallets', cash.id);
    const confirmed = await store.db.wallets.get(cash.id);
    expect(confirmed?.dirty).toBe(0);
    expect('dirtyGroups' in confirmed!).toBe(false);
    expect('dirtyBase' in confirmed!).toBe(false);
  });

  it('отправлена, но не подтверждена; следующая правка добавляется к прежней памяти', async () => {
    const { store, tx } = await setup();
    await store.transactions.update(tx.id, { amountMinor: 6_000 });
    await sent(store, 'transactions', tx.id);
    const row = await store.transactions.update(tx.id, { note: 'после отправки' });
    expect(row.dirtyGroups).toEqual(['money', 'note']);
    expect((row as { dirtyBase?: Record<string, { b: Record<string, unknown> }> }).dirtyBase?.money?.b['amountMinor']).toBe(5_000);
  });

  it('группа вернулась к исходному значению — убирается (сменил и вернул = ничего не менял)', async () => {
    const { store, tx } = await setup();
    await store.transactions.update(tx.id, { amountMinor: 6_000 });
    await store.transactions.update(tx.id, { note: 'ужин' });
    const back = await store.transactions.update(tx.id, { amountMinor: 5_000 });
    expect(back.dirtyGroups).toEqual(['note']);
    const zero = await store.transactions.update(tx.id, { note: 'обед' });
    expect(zero.dirtyGroups).toEqual([]);
    const del = await store.transactions.softDelete(tx.id);
    const undone = await store.transactions.restore(tx.id);
    expect(del.dirtyGroups).toEqual(['deleted']);
    expect(undone.dirtyGroups).toEqual([]);
  });

  it('строку успели исправить во время отправки → остаётся грязной, группы — надмножество', async () => {
    const { store, cash } = await setup();
    const sent = await store.wallets.update(cash.id, { name: 'ушло' });
    await store.wallets.update(cash.id, { color: '#abcdef' }); // правка «во время отправки»
    const cleared = await store.sync.markPushed('wallets', [{ id: cash.id, clientUpdatedAt: sent.clientUpdatedAt, deviceId: sent.deviceId }]);
    expect(cleared).toBe(0);
    expect(await store.db.wallets.get(cash.id)).toMatchObject({ dirty: 1, dirtyGroups: ['name', 'look'] });
  });

  it('группы не уходят в облако (toWire) и не попадают в резервную копию', async () => {
    const { store, cash, tx } = await setup();
    const row = await store.wallets.update(cash.id, { name: 'N2' });
    expect(Object.keys(toWire('wallets', row))).not.toContain('dirtyGroups');
    expect(JSON.stringify(toWire('wallets', row))).not.toContain('dirtyGroups');
    await store.transactions.update(tx.id, { note: 'z' });
    const backup = await exportBackup(store);
    expect(JSON.stringify(backup)).not.toContain('dirtyGroups');
  });
});

describe('импорт: импортированное — вся запись', () => {
  it('строка, которую заменил импорт, грязная и БЕЗ групп (даже если до этого группы были)', async () => {
    const { store, cash } = await setup();
    await store.wallets.update(cash.id, { name: 'до импорта' });
    const backup = await exportBackup(store);
    // файл новее локальной версии: метка вперёд
    const newer = { ...backup, wallets: backup.wallets.map((w) => (w.id === cash.id ? { ...w, name: 'из файла', clientUpdatedAt: new Date(Date.now() + 1000).toISOString(), deviceId: 'device-file-0001' } : w)) };
    const r = await importBackup(store, newer);
    expect(r.replaced).toBeGreaterThanOrEqual(1);
    const row = await store.db.wallets.get(cash.id);
    expect(row).toMatchObject({ name: 'из файла', dirty: 1 });
    expect('dirtyGroups' in row!).toBe(false);
  });

  it('новая строка из файла — грязная без групп', async () => {
    const store = await makeStore();
    await store.settings.ensure();
    const donor = await makeStore();
    await basics(donor);
    const file = await exportBackup(donor);
    await importBackup(store, { ...file, settings: null });
    const rows = await store.db.wallets.toArray();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.dirty).toBe(1);
      expect('dirtyGroups' in r).toBe(false);
    }
  });
});

describe('согласование (reconcile) ставит группы', () => {
  it('возврат валюты кошелька → группа money; возврат вида категории → группа kind', async () => {
    const store = await makeStore({ now: () => T0 });
    await basics(store);
    // кошелёк и категория «пришли с сервера» (чистые), по ним есть операция
    const wallet = remoteWallet({ id: '33333333-3333-4333-8333-333333333333', name: 'Карта', currency: 'TJS' });
    await store.sync.applyRemotePage('wallets', [{ entity: wallet, serverSeq: 1 }], 1);
    await store.settings.update({ baseCurrency: 'TJS' });
    const tx = await store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 1_000, occurredOn: '2026-10-05' });
    expect(tx.fxSource).toBe('same');
    const cats = await store.categories.create({ name: 'Транспорт', kind: 'expense', color: '#111111', icon: 'b' });
    await clean(store, 'categories', cats.id);
    await store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 10, categoryId: cats.id, occurredOn: '2026-10-05' });

    // чужая версия меняет валюту кошелька и вид категории
    const watch = newWatch();
    const incomingWallet = [{ entity: { ...wallet, currency: 'USD', clientUpdatedAt: stamp(T0 + 60_000), deviceId: 'device-z-9999' }, serverSeq: 2 }];
    await noteIncoming(store, 'wallets', incomingWallet, watch);
    await store.sync.applyRemotePage('wallets', incomingWallet, 2);
    const catRow = (await store.db.categories.get(cats.id))!;
    const incomingCat = [
      { entity: { ...catRow, kind: 'income' as const, clientUpdatedAt: stamp(T0 + 60_000), deviceId: 'device-z-9999', dirty: undefined, serverSeq: undefined, syncError: undefined, dirtyGroups: undefined }, serverSeq: 3 },
    ];
    // чужая версия категории: чистой копией (метки новее наших)
    const entity = Object.fromEntries(Object.entries(incomingCat[0]!.entity).filter(([, v]) => v !== undefined));
    await noteIncoming(store, 'categories', [{ entity }], watch);
    await store.sync.applyRemotePage('categories', [{ entity: entity as never, serverSeq: 3 }], 3);
    expect(await store.db.wallets.get(wallet.id)).toMatchObject({ currency: 'USD', dirty: 0 });

    const fixed = await reconcile(store, watch);
    expect(fixed).toBeGreaterThanOrEqual(1);
    expect(await store.db.wallets.get(wallet.id)).toMatchObject({ currency: 'TJS', dirty: 1, dirtyGroups: ['money'] });
    expect(await store.db.categories.get(cats.id)).toMatchObject({ kind: 'expense', dirty: 1, dirtyGroups: ['kind'] });
  });
});
