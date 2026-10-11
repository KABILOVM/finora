import { describe, expect, it } from 'vitest';
import type { Settings, Transaction, Wallet } from '@/domain/types';
import { basics, expense, makeStore, remoteWallet, stamp } from './helpers';

/**
 * (г) applyRemotePage со слиянием по группам полей: локальные группы остаются своими, остальные берутся с сервера.
 * Все ветки: локальная правка новее/старее серверной версии, одна и та же группа, удалено на сервере, восстановление,
 * идемпотентность повтора страницы, карантин, устаревшая версия, неизвестные группы.
 */

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const OLD = stamp(T0 - 5_000); // версия сервера «старее» нашей правки
const NEW = stamp(T0 + 5_000); // версия сервера «новее» нашей правки
const REMOTE_DEV = 'device-r-0001';

const page = (w: Wallet, serverSeq: number) => [{ entity: w, serverSeq }];
const remote = (over: Partial<Wallet>): Wallet => remoteWallet({ id: 'w-1', name: 'исх', color: '#111111', clientUpdatedAt: OLD, deviceId: REMOTE_DEV, ...over });

/** Устройство с «чистым» кошельком w-1 (серверная версия 1), часы стоят на T0. */
async function withCleanWallet() {
  const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
  await store.sync.applyRemotePage('wallets', page(remote({ clientUpdatedAt: stamp(T0 - 60_000) }), 1), 1);
  return store;
}
/** Строка как её отдаёт сервер: без локальных служебных полей. */
function toEntity(r: object): any {
  const { dirty: _d, serverSeq: _s, syncError: _e, dirtyGroups: _g, dirtyBase: _b, ...entity } = r as Record<string, unknown>;
  void [_d, _s, _e, _g, _b];
  return entity;
}
const row = async (store: Awaited<ReturnType<typeof makeStore>>) => (await store.db.wallets.get('w-1'))!;

describe('разные группы: объединяются независимо от того, чья метка новее', () => {
  it.each([
    ['серверная версия СТАРЕЕ нашей правки', OLD],
    ['серверная версия НОВЕЕ нашей правки', NEW],
  ])('%s: имя наше, цвет серверный; строка снова грязная с новой меткой, больше обеих', async (_name, remoteStamp) => {
    const store = await withCleanWallet();
    const mine = await store.wallets.update('w-1', { name: 'моё имя' });
    expect(mine.dirtyGroups).toEqual(['name']);

    const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: remoteStamp }), 2), 2);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 0, merged: 1 });
    const after = await row(store);
    expect(after).toMatchObject({ name: 'моё имя', color: '#222222', dirty: 1, serverSeq: 2, deviceId: 'device-local-0001', dirtyGroups: ['name'], syncError: null });
    expect(after.clientUpdatedAt > remoteStamp).toBe(true); // строго больше серверной: сервер примет
    expect(after.clientUpdatedAt > mine.clientUpdatedAt).toBe(true);
    // уходит в очередь отправки
    expect((await store.sync.listDirty('wallets', 10)).map((x) => x.id)).toEqual(['w-1']);
  });

  it('после отправки объединённая строка чистая, но помнит правки; когда сервер вернул нашу версию — без групп', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222' }), 2), 2);
    const merged = await row(store);
    expect(await store.sync.markPushed('wallets', [{ id: 'w-1', clientUpdatedAt: merged.clientUpdatedAt, deviceId: merged.deviceId }])).toBe(1);
    const sent = await row(store);
    expect(sent).toMatchObject({ dirty: 0, dirtyGroups: ['name'] });
    // сервер вернул ровно нашу версию (метка и устройство совпали): подтверждение
    const { dirty: _d, serverSeq: _s, syncError: _e, dirtyGroups: _g, dirtyBase: _b, ...echo } = sent as typeof sent & { dirtyBase?: unknown };
    void [_d, _s, _e, _g, _b];
    const r = await store.sync.applyRemotePage('wallets', page(echo as Wallet, 3), 3);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 0, merged: 0 });
    const done = await row(store);
    expect(done).toMatchObject({ dirty: 0, serverSeq: 3, name: 'моё имя' });
    expect('dirtyGroups' in done).toBe(false);
    expect('dirtyBase' in done).toBe(false);
  });

  it('несколько своих групп и несколько чужих: каждая группа целиком из своего источника', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    await store.wallets.archive('w-1');
    const r = await store.sync.applyRemotePage(
      'wallets',
      page(remote({ color: '#333333', icon: 'q', sortOrder: 4, openingBalanceMinor: 900, currency: 'TJS', kind: 'card', clientUpdatedAt: NEW }), 2),
      2,
    );
    expect(r.merged).toBe(1);
    expect(await row(store)).toMatchObject({
      name: 'моё имя', // своя группа name — у нас: сервер её не менял (там по-прежнему «исх»)
      archivedAt: expect.any(String), // своя группа archived
      color: '#333333',
      icon: 'q',
      sortOrder: 4, // look — серверная
      openingBalanceMinor: 900,
      kind: 'card', // money — серверная
      dirtyGroups: ['name', 'archived'],
    });
  });

  it('операция: заметка с одного устройства, сумма с другого — обе на месте', async () => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
    const b = await basics(store);
    const t = await expense(store, b.cash.id, 10_000, { note: 'такси' });
    await store.sync.markPushed('transactions', [{ id: t.id, clientUpdatedAt: t.clientUpdatedAt, deviceId: t.deviceId }]);
    const mine = await store.transactions.update(t.id, { amountMinor: 1_000 });
    expect(mine.dirtyGroups).toEqual(['money']);

    const theirs: Transaction = { ...(await store.db.transactions.get(t.id))!, note: 'такси из аэропорта', amountMinor: 10_000, baseAmountMinor: 10_000, clientUpdatedAt: NEW, deviceId: REMOTE_DEV };
    const { dirty: _d, serverSeq: _s, syncError: _e, dirtyGroups: _g, ...entity } = theirs as Transaction & { dirty: number; serverSeq: number; syncError: null; dirtyGroups?: string[] };
    const r = await store.sync.applyRemotePage('transactions', [{ entity: entity as Transaction, serverSeq: 5 }], 5);
    expect(r.merged).toBe(1);
    expect(await store.db.transactions.get(t.id)).toMatchObject({ amountMinor: 1_000, baseAmountMinor: 1_000, note: 'такси из аэропорта', dirty: 1, dirtyGroups: ['money'] });
  });

  it('настройки: неделя наша, кошелёк по умолчанию чужой', async () => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
    const b = await basics(store);
    const s0 = (await store.settings.get())!;
    await store.sync.markPushed('settings', [{ id: s0.id, clientUpdatedAt: s0.clientUpdatedAt, deviceId: s0.deviceId }]);
    await store.settings.update({ weekStartsOn: 0 });
    const server: Settings = {
      id: s0.id, createdAt: s0.createdAt, clientUpdatedAt: NEW, deviceId: REMOTE_DEV, deletedAt: null,
      baseCurrency: 'TJS', locale: 'ru', weekStartsOn: 1, defaultWalletId: b.cash.id,
    };
    const r = await store.sync.applyRemotePage('settings', [{ entity: server, serverSeq: 3 }], 3);
    expect(r.merged).toBe(1);
    expect(await store.settings.get()).toMatchObject({ weekStartsOn: 0, defaultWalletId: b.cash.id, dirty: 1, dirtyGroups: ['week'] });
  });
});

describe('одна и та же группа: побеждает правка с более поздней меткой', () => {
  it('серверная версия НОВЕЕ нашей правки: побеждает серверное имя, строка чистая (не «слияние»)', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    const r = await store.sync.applyRemotePage('wallets', page(remote({ name: 'их имя', clientUpdatedAt: NEW }), 2), 2);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 0, merged: 0 });
    const after = await row(store);
    expect(after).toMatchObject({ name: 'их имя', dirty: 0, serverSeq: 2, clientUpdatedAt: NEW, deviceId: REMOTE_DEV });
    expect('dirtyGroups' in after).toBe(false);
  });

  it('серверная версия новее, но менялась ДРУГАЯ группа: наше имя остаётся, метка поднимается выше серверной', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#555555', clientUpdatedAt: NEW }), 2), 2);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 0, merged: 1 });
    const after = await row(store);
    expect(after).toMatchObject({ name: 'моё имя', color: '#555555', dirty: 1, deviceId: 'device-local-0001' });
    expect(after.clientUpdatedAt > NEW).toBe(true);
  });

  it('серверная версия старее: наша строка уже подходит и новее — ничего не пишется, метка прежняя, serverSeq поднимается', async () => {
    const store = await withCleanWallet();
    const mine = await store.wallets.update('w-1', { name: 'моё имя' });
    const r = await store.sync.applyRemotePage('wallets', page(remote({ name: 'их имя', clientUpdatedAt: OLD }), 2), 2);
    expect(r).toEqual({ applied: 0, keptLocal: 1, lostLocal: 0, merged: 0 });
    expect(await row(store)).toMatchObject({ name: 'моё имя', clientUpdatedAt: mine.clientUpdatedAt, dirty: 1, serverSeq: 2 });
  });

  it.each([
    ['серверная правка НОВЕЕ: вся группа money серверная', NEW, { categoryId: 'food', amountMinor: 77_000, baseAmountMinor: 77_000 }],
    ['серверная правка СТАРЕЕ: вся группа money наша', OLD, { categoryId: null, amountMinor: 10_000, baseAmountMinor: 10_000 }],
  ])('операция, %s — группа приходит ЦЕЛИКОМ от одного участника, а не смесью полей', async (_n, remoteStamp, want) => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
    const b = await basics(store);
    const t = await expense(store, b.cash.id, 10_000, { categoryId: b.food.id, note: 'еда' });
    await store.sync.markPushed('transactions', [{ id: t.id, clientUpdatedAt: t.clientUpdatedAt, deviceId: t.deviceId }]);
    await store.sync.applyRemotePage('transactions', [{ entity: toEntity(t), serverSeq: 1 }], 1); // отправка подтверждена
    // мы меняем КАТЕГОРИЮ (money), чужое устройство — СУММУ (тоже money)
    const mine = await store.transactions.update(t.id, { categoryId: null });
    expect(mine.dirtyGroups).toEqual(['money']);
    const theirs = { ...toEntity((await store.db.transactions.get(t.id))!), amountMinor: 77_000, baseAmountMinor: 77_000, categoryId: b.food.id, clientUpdatedAt: remoteStamp, deviceId: REMOTE_DEV };
    await store.sync.applyRemotePage('transactions', [{ entity: theirs, serverSeq: 9 }], 9);
    expect(await store.db.transactions.get(t.id)).toMatchObject({
      categoryId: want.categoryId === 'food' ? b.food.id : want.categoryId,
      amountMinor: want.amountMinor,
      baseAmountMinor: want.baseAmountMinor,
    });
  });
});

describe('удаление и восстановление', () => {
  it('удалено на сервере, а мы правили имя: остаётся удалённой, но с нашим именем', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    const r = await store.sync.applyRemotePage('wallets', page(remote({ deletedAt: NEW, clientUpdatedAt: NEW }), 2), 2);
    expect(r.merged).toBe(1);
    expect(await row(store)).toMatchObject({ name: 'моё имя', deletedAt: NEW, dirty: 1, dirtyGroups: ['name'] });
  });

  it('удалили мы, а на сервере поправили имя: удалена, имя серверное', async () => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
    const b = await basics(store);
    const t = await expense(store, b.cash.id, 100, { note: 'старая' });
    await store.sync.markPushed('transactions', [{ id: t.id, clientUpdatedAt: t.clientUpdatedAt, deviceId: t.deviceId }]);
    await store.transactions.softDelete(t.id);
    const base = (await store.db.transactions.get(t.id))!;
    const { dirty: _d, serverSeq: _s, syncError: _e, dirtyGroups: _g, ...entity } = { ...base, deletedAt: null, note: 'правка с другого', clientUpdatedAt: NEW, deviceId: REMOTE_DEV };
    await store.sync.applyRemotePage('transactions', [{ entity: entity as Transaction, serverSeq: 4 }], 4);
    const after = (await store.db.transactions.get(t.id))!;
    expect(after.deletedAt).not.toBeNull();
    expect(after).toMatchObject({ note: 'правка с другого', dirty: 1, dirtyGroups: ['deleted'] });
  });

  it.each([
    ['удаление на сервере ПОЗЖЕ нашего восстановления: остаётся удалённой', NEW, true],
    ['удаление на сервере РАНЬШЕ нашего восстановления: восстановление побеждает', OLD, false],
  ])('мы удалили (отправлено) и восстановили, а на сервере удалена: %s', async (_n, remoteStamp, stillDeleted) => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
    const b = await basics(store);
    const t = await expense(store, b.cash.id, 100);
    await store.sync.markPushed('transactions', [{ id: t.id, clientUpdatedAt: t.clientUpdatedAt, deviceId: t.deviceId }]);
    await store.sync.applyRemotePage('transactions', [{ entity: toEntity(t), serverSeq: 1 }], 1);
    await store.transactions.softDelete(t.id);
    const deleted = (await store.db.transactions.get(t.id))!;
    await store.sync.markPushed('transactions', [{ id: t.id, clientUpdatedAt: deleted.clientUpdatedAt, deviceId: deleted.deviceId }]);
    // удаление отправлено; восстановление НЕ убирает группу: на сервере уже могло лежать удаление
    const restored = await store.transactions.restore(t.id);
    expect(restored.dirtyGroups).toEqual(['deleted']);
    const theirs = { ...toEntity(deleted), deletedAt: remoteStamp, clientUpdatedAt: remoteStamp, deviceId: REMOTE_DEV };
    await store.sync.applyRemotePage('transactions', [{ entity: theirs, serverSeq: 6 }], 6);
    const after = (await store.db.transactions.get(t.id))!;
    expect(after.deletedAt === null).toBe(!stillDeleted);
  });
});

describe('нет расхождений, повторы, устаревшее', () => {
  it('всё, что мы правили, уже совпало с сервером → принимаем серверную версию: чистая, без групп, это не «проигрыш»', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'то же имя' });
    const r = await store.sync.applyRemotePage('wallets', page(remote({ name: 'то же имя', color: '#999999', clientUpdatedAt: NEW }), 2), 2);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 0, merged: 0 });
    const after = await row(store);
    expect(after).toMatchObject({ name: 'то же имя', color: '#999999', dirty: 0, serverSeq: 2, clientUpdatedAt: NEW, deviceId: REMOTE_DEV });
    expect('dirtyGroups' in after).toBe(false);
  });

  it('повтор той же страницы: ничего не пишется, метка не растёт', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    const p = page(remote({ color: '#222222', clientUpdatedAt: NEW }), 2);
    await store.sync.applyRemotePage('wallets', p, 2);
    const once = await row(store);
    for (let i = 0; i < 3; i++) {
      const again = await store.sync.applyRemotePage('wallets', p, 2);
      expect(again).toEqual({ applied: 0, keptLocal: 1, lostLocal: 0, merged: 0 });
      expect(await row(store)).toEqual(once);
    }
  });

  it('повтор после того, как объединённая строка ушла на сервер, её не откатывает', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    const p = page(remote({ color: '#222222', clientUpdatedAt: NEW }), 2);
    await store.sync.applyRemotePage('wallets', p, 2);
    const merged = await row(store);
    await store.sync.markPushed('wallets', [{ id: 'w-1', clientUpdatedAt: merged.clientUpdatedAt, deviceId: merged.deviceId }]);
    await store.sync.applyRemotePage('wallets', p, 2);
    expect(await row(store)).toMatchObject({ name: 'моё имя', color: '#222222', dirty: 0 });
  });

  it('устаревшая версия (serverSeq не больше известного) игнорируется, даже с другим содержимым', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: NEW }), 5), 5);
    const before = await row(store);
    const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#abcdef', icon: 'zzz', clientUpdatedAt: stamp(T0 + 9_000) }), 3), 5);
    expect(r.merged + r.applied).toBe(0);
    expect(await row(store)).toEqual(before);
  });

  it('следующая версия сервера объединяется с уже объединённой строкой (метка растёт только с новой серверной версией)', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: NEW }), 2), 2);
    const first = await row(store);
    const next = stamp(T0 + 20_000);
    const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', icon: 'новый', clientUpdatedAt: next }), 3), 3);
    expect(r.merged).toBe(1);
    const second = await row(store);
    expect(second).toMatchObject({ name: 'моё имя', icon: 'новый', serverSeq: 3 });
    expect(second.clientUpdatedAt > next).toBe(true);
    expect(second.clientUpdatedAt > first.clientUpdatedAt).toBe(true);
  });

  it('серверная метка «из будущего»: наша объединённая метка всё равно строго больше, следующая правка тоже', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    const future = stamp(T0 + 3 * 3600_000); // сервер зажимает метки до «сейчас + 5 мин» по СВОИМ часам, наши отстают
    await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: future }), 2), 2);
    const merged = await row(store);
    expect(merged.clientUpdatedAt > future).toBe(true);
    const edited = await store.wallets.update('w-1', { icon: 'ещё' });
    expect(edited.clientUpdatedAt > merged.clientUpdatedAt).toBe(true);
  });
});

describe('карантин и «вся запись»', () => {
  it('строка с карантином и известными группами сливается как грязная: карантин остаётся, метка новая', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    await store.sync.quarantine('wallets', ['w-1'], 'сервер отказал');
    const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: NEW }), 2), 2);
    expect(r.merged).toBe(1);
    const after = await row(store);
    expect(after).toMatchObject({ name: 'моё имя', color: '#222222', dirty: 1, syncError: 'сервер отказал', dirtyGroups: ['name'] });
    expect(await store.sync.listDirty('wallets', 10)).toEqual([]); // в очередь отправки не вернулась
    expect(await store.sync.counts()).toEqual({ pending: 0, quarantined: 1 });
  });

  it('строка с карантином, где всё совпало с сервером, принимает серверную версию', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'то же' });
    await store.sync.quarantine('wallets', ['w-1'], 'сервер отказал');
    await store.sync.applyRemotePage('wallets', page(remote({ name: 'то же', clientUpdatedAt: NEW }), 2), 2);
    expect(await row(store)).toMatchObject({ dirty: 0, syncError: null });
  });

  describe('новая строка, созданная здесь и ни разу не правленная', () => {
    const fresh = async () => {
      const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
      await store.wallets.create({ name: 'моя', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
      return store;
    };

    it('другое устройство независимо создало ту же запись, и его версия новее: принимает серверную', async () => {
      const store = await fresh();
      const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: NEW }), 2), 2);
      expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 1, merged: 0 });
      expect(await row(store)).toMatchObject({ name: 'исх', color: '#222222', dirty: 0, serverSeq: 2 });
    });

    it('...а его версия старее нашей: наша остаётся и уйдёт уже с известной версией сервера (проверка версии при записи)', async () => {
      const store = await fresh();
      const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: OLD }), 2), 2);
      expect(r).toEqual({ applied: 0, keptLocal: 1, lostLocal: 0, merged: 0 });
      expect(await row(store)).toMatchObject({ name: 'моя', color: '#000000', dirty: 1, serverSeq: 2, deviceId: 'device-local-0001' });
      expect((await store.sync.listDirty('wallets', 10)).map((x) => x.id)).toEqual(['w-1']);
    });

    it('на сервере наша же отправленная версия (ответ потерялся), которую успело поправить другое устройство: принимает серверную', async () => {
      const store = await fresh();
      const created = (await row(store))!;
      // метка сервера может быть и меньше нашей (наши часы ушли вперёд, сервер зажал метку), но создание — наше
      const theirs = { ...toEntity(created), color: '#222222', clientUpdatedAt: OLD, deviceId: 'device-local-0001' };
      const r = await store.sync.applyRemotePage('wallets', page(theirs as Wallet, 2), 2);
      expect(r.merged).toBe(0);
      expect(await row(store)).toMatchObject({ color: '#222222', dirty: 0 });
    });
  });

  it('новая строка, созданная здесь и ПРАВЛЕННАЯ до подтверждения: правка остаётся, остальное — серверное', async () => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
    await store.wallets.create({ name: 'моя', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    await store.wallets.update('w-1', { name: 'моя 2' });
    // на сервере наше создание уже есть (ответ потерялся) и его успели перекрасить на другом устройстве
    const created = (await store.db.wallets.get('w-1'))!;
    const theirs = { ...toEntity(created), name: 'моя', color: '#222222', clientUpdatedAt: NEW, deviceId: REMOTE_DEV };
    const r = await store.sync.applyRemotePage('wallets', page(theirs as Wallet, 2), 2);
    expect(r.merged).toBe(1);
    expect(await row(store)).toMatchObject({ name: 'моя 2', color: '#222222', dirty: 1, dirtyGroups: ['name'] });
  });

  it('грязная строка без групп (импорт, до обновления приложения): прежнее правило «новее побеждает», группы не применяются', async () => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
    await store.wallets.create({ name: 'моя', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    await store.db.wallets.update('w-1', { dirtyGroups: undefined });
    expect('dirtyGroups' in (await row(store))).toBe(false);
    const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: NEW }), 2), 2);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 1, merged: 0 });
    expect(await row(store)).toMatchObject({ name: 'исх', color: '#222222', dirty: 0 });
  });

  it('неизвестные группы в сохранённой строке → прежнее правило «целиком»', async () => {
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    await store.db.wallets.update('w-1', { dirtyGroups: ['name', 'группа-из-будущего'] });
    const r = await store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: NEW }), 2), 2);
    expect(r.lostLocal).toBe(1);
    expect(await row(store)).toMatchObject({ name: 'исх', dirty: 0 });
  });
});

describe('смешанная страница и атомарность', () => {
  it('в одной странице: вставка, замена чистой, слияние, оставленная локальная — счётчики сходятся', async () => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
    await store.sync.applyRemotePage('wallets', [{ entity: remote({ id: 'w-clean', clientUpdatedAt: stamp(T0 - 60_000) }), serverSeq: 1 }, { entity: remote({ id: 'w-merge', clientUpdatedAt: stamp(T0 - 60_000) }), serverSeq: 2 }], 2);
    await store.wallets.update('w-merge', { name: 'моё' });
    await store.wallets.create({ name: 'новая моя', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-kept' });
    await store.db.wallets.update('w-kept', { dirtyGroups: undefined }); // как строка из импорта: «вся запись», новее побеждает
    const r = await store.sync.applyRemotePage(
      'wallets',
      [
        { entity: remote({ id: 'w-new', clientUpdatedAt: OLD }), serverSeq: 3 },
        { entity: remote({ id: 'w-clean', name: 'обновлено', clientUpdatedAt: NEW }), serverSeq: 4 },
        { entity: remote({ id: 'w-merge', color: '#444444', clientUpdatedAt: NEW }), serverSeq: 5 },
        { entity: remote({ id: 'w-kept', name: 'старая сервера', clientUpdatedAt: stamp(T0 - 90_000) }), serverSeq: 6 },
      ],
      6,
    );
    expect(r).toEqual({ applied: 3, keptLocal: 1, lostLocal: 0, merged: 1 });
  });

  it('сбой записи курса при слиянии не оставляет следов', async () => {
    const { vi } = await import('vitest');
    const store = await withCleanWallet();
    await store.wallets.update('w-1', { name: 'моё имя' });
    const before = await store.db.wallets.toArray();
    const spy = vi.spyOn(store.db.meta, 'put').mockImplementation(() => Promise.reject(new Error('сбой диска')) as never);
    await expect(store.sync.applyRemotePage('wallets', page(remote({ color: '#222222', clientUpdatedAt: NEW }), 2), 2)).rejects.toThrow(/сбой диска/);
    spy.mockRestore();
    expect(await store.db.wallets.toArray()).toEqual(before);
    expect(await store.sync.getCursor('wallets')).toBe(1);
  });
});
