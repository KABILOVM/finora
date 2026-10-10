import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@/db';
import type { Category, Settings, Transaction } from '@/domain/types';
import { basics, expense, makeStore, remoteWallet, stamp, USER_A } from './helpers';

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const w = (id: string, serverSeq: number, over: Parameters<typeof remoteWallet>[0] extends infer P ? Partial<P> : never = {}) => ({
  entity: remoteWallet({ id, ...over }),
  serverSeq,
});

describe('курсор и служебные данные', () => {
  it('курсор по умолчанию 0; у каждой таблицы свой; resetCursors обнуляет все', async () => {
    const store = await makeStore();
    expect(await store.sync.getCursor('wallets')).toBe(0);
    await store.sync.applyRemotePage('wallets', [w('w-1', 5)], 5);
    expect(await store.sync.getCursor('wallets')).toBe(5);
    expect(await store.sync.getCursor('transactions')).toBe(0);
    await store.sync.resetCursors();
    expect(await store.sync.getCursor('wallets')).toBe(0);
    expect((await store.db.wallets.get('w-1'))?.name).toBe('С сервера'); // данные на месте
  });

  it('getMeta/setMeta: lastSyncedAt; служебные ключи защищены', async () => {
    const store = await makeStore();
    expect(await store.sync.getMeta('lastSyncedAt')).toBeUndefined();
    await store.sync.setMeta('lastSyncedAt', '2026-10-10T10:00:00.000Z');
    expect(await store.sync.getMeta('lastSyncedAt')).toBe('2026-10-10T10:00:00.000Z');
    await expect(store.sync.setMeta('lastStamp', 'x')).rejects.toBeInstanceOf(ValidationError);
    await expect(store.sync.setMeta('cursor:wallets', 999)).rejects.toBeInstanceOf(ValidationError);
    await expect(store.sync.setMeta('', 1)).rejects.toBeInstanceOf(ValidationError);
    expect(await store.sync.getCursor('wallets')).toBe(0);
  });

  it('неизвестная таблица — ошибка', async () => {
    const store = await makeStore();
    await expect(store.sync.getCursor('users' as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(store.sync.listDirty('users' as never, 10)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('listDirty', () => {
  it('только dirty и без карантина, старые первыми, с лимитом', async () => {
    const store = await makeStore();
    const a = await store.wallets.create({ name: 'A', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const b = await store.wallets.create({ name: 'B', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const c = await store.wallets.create({ name: 'C', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const d = await store.wallets.create({ name: 'D', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await store.sync.markPushed('wallets', [{ id: b.id, clientUpdatedAt: b.clientUpdatedAt, deviceId: b.deviceId }]);
    await store.sync.quarantine('wallets', [a.id], 'отвергнуто');
    expect((await store.sync.listDirty('wallets', 10)).map((r) => r.id)).toEqual([c.id, d.id]);
    expect((await store.sync.listDirty('wallets', 1)).map((r) => r.id)).toEqual([c.id]);
    // правка делает строку «самой новой» в очереди
    await store.wallets.update(c.id, { name: 'C2' });
    expect((await store.sync.listDirty('wallets', 10)).map((r) => r.id)).toEqual([d.id, c.id]);
  });

  it('лимит считается ПОСЛЕ отсева карантина: застрявшие строки не вытесняют здоровые', async () => {
    const store = await makeStore();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await store.wallets.create({ name: `W${i}`, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' })).id);
    }
    await store.sync.quarantine('wallets', ids.slice(0, 4), 'x');
    expect((await store.sync.listDirty('wallets', 2)).map((r) => r.id)).toEqual([ids[4]]);
  });

  it.each([0, -1, 1.5, Number.NaN, 10_001])('размер пачки %s отвергается', async (n) => {
    const store = await makeStore();
    await expect(store.sync.listDirty('wallets', n)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('markPushed', () => {
  it('очищает dirty, если версия та же', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const n = await store.sync.markPushed('wallets', [{ id: cash.id, clientUpdatedAt: cash.clientUpdatedAt, deviceId: cash.deviceId }]);
    expect(n).toBe(1);
    expect(await store.db.wallets.get(cash.id)).toMatchObject({ dirty: 0, syncError: null });
  });

  it('правка во время отправки: строка остаётся dirty', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const sent = { id: cash.id, clientUpdatedAt: cash.clientUpdatedAt, deviceId: cash.deviceId };
    await store.wallets.update(cash.id, { name: 'Исправил пока уходило' });
    expect(await store.sync.markPushed('wallets', [sent])).toBe(0);
    const row = await store.db.wallets.get(cash.id);
    expect(row).toMatchObject({ dirty: 1, name: 'Исправил пока уходило' });
    expect((await store.sync.listDirty('wallets', 10)).map((r) => r.id)).toContain(cash.id);
  });

  it('другое устройство в той же метке — не наша версия; неизвестные id пропускаются', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const n = await store.sync.markPushed('wallets', [
      { id: cash.id, clientUpdatedAt: cash.clientUpdatedAt, deviceId: 'другое-устройство' },
      { id: 'no-such-id', clientUpdatedAt: cash.clientUpdatedAt, deviceId: cash.deviceId },
    ]);
    expect(n).toBe(0);
    expect((await store.db.wallets.get(cash.id))?.dirty).toBe(1);
  });

  it('снимает и карантин у отправленной версии; пустой список и кривые данные', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    expect(await store.sync.markPushed('wallets', [])).toBe(0);
    await expect(store.sync.markPushed('wallets', [{ id: cash.id } as never])).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('quarantine / retryQuarantined / counts', () => {
  it('карантин по id и по версии; устаревшая версия в карантин не попадает', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const oldRef = { id: cash.id, clientUpdatedAt: cash.clientUpdatedAt, deviceId: cash.deviceId };
    await store.wallets.update(cash.id, { name: 'правка после отправки' });
    expect(await store.sync.quarantine('wallets', [oldRef], 'ошибка старой версии')).toBe(0);
    expect((await store.db.wallets.get(cash.id))?.syncError).toBeNull();
    expect(await store.sync.quarantine('wallets', [usd.id, 'no-such-id'], 'ошибка')).toBe(1);
    expect((await store.db.wallets.get(usd.id))?.syncError).toBe('ошибка');
  });

  it('сообщение обрезается и не бывает пустым; чистые строки не карантинятся', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    await store.sync.markPushed('wallets', [{ id: usd.id, clientUpdatedAt: usd.clientUpdatedAt, deviceId: usd.deviceId }]);
    await store.sync.quarantine('wallets', [cash.id, usd.id], 'x'.repeat(1000));
    expect((await store.db.wallets.get(cash.id))?.syncError).toHaveLength(500);
    expect((await store.db.wallets.get(usd.id))?.syncError).toBeNull();
    await store.sync.quarantine('wallets', [cash.id], '   ');
    expect((await store.db.wallets.get(cash.id))?.syncError).toBe('Сервер отверг запись');
  });

  it('counts считает по всем таблицам: ждут отправки и в карантине', async () => {
    const store = await makeStore();
    const { cash, food } = await basics(store);
    await expense(store, cash.id, 100);
    const before = await store.sync.counts();
    expect(before).toEqual({ pending: 6, quarantined: 0 }); // настройки, 2 кошелька, 2 категории, 1 операция
    await store.sync.quarantine('categories', [food.id], 'ошибка');
    expect(await store.sync.counts()).toEqual({ pending: 5, quarantined: 1 });
  });

  it('retryQuarantined возвращает строки в очередь и сообщает, сколько', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    await store.sync.quarantine('wallets', [cash.id, usd.id], 'ошибка');
    expect(await store.sync.listDirty('wallets', 10)).toEqual([]);
    expect(await store.sync.retryQuarantined()).toBe(2);
    expect((await store.sync.listDirty('wallets', 10)).map((r) => r.id).sort()).toEqual([cash.id, usd.id].sort());
    expect(await store.sync.retryQuarantined()).toBe(0);
  });
});

describe('applyRemotePage — ветки слияния', () => {
  it('строки нет → вставляется чистой, serverSeq запоминается', async () => {
    const store = await makeStore();
    const r = await store.sync.applyRemotePage('wallets', [w('w-1', 7)], 7);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 0 });
    expect(await store.db.wallets.get('w-1')).toMatchObject({ dirty: 0, serverSeq: 7, syncError: null, name: 'С сервера' });
  });

  it('локальная чистая → заменяется серверной', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [w('w-1', 3, { name: 'v3' })], 3);
    const r = await store.sync.applyRemotePage('wallets', [w('w-1', 9, { name: 'v9', clientUpdatedAt: '2026-10-02T00:00:00.000Z' })], 9);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 0 });
    expect(await store.db.wallets.get('w-1')).toMatchObject({ name: 'v9', serverSeq: 9, dirty: 0 });
  });

  it('локальная чистая + версия с меньшим serverSeq (запоздавшая) → игнорируется', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [w('w-1', 9, { name: 'v9' })], 9);
    const r = await store.sync.applyRemotePage('wallets', [w('w-1', 4, { name: 'старая v4' })], 9);
    expect(r).toEqual({ applied: 0, keptLocal: 0, lostLocal: 0 });
    expect(await store.db.wallets.get('w-1')).toMatchObject({ name: 'v9', serverSeq: 9 });
  });

  it('повтор уже применённой страницы не откатывает локальную правку, которая с тех пор ушла на сервер', async () => {
    const store = await makeStore({ now: () => T0 });
    const page = [w('w-1', 1, { name: 'версия сервера', clientUpdatedAt: stamp(T0 - 1000), deviceId: 'device-a-0001' })];
    await store.sync.applyRemotePage('wallets', page, 1);
    const edited = await store.wallets.update('w-1', { name: 'моя правка' });
    await store.sync.markPushed('wallets', [{ id: 'w-1', clientUpdatedAt: edited.clientUpdatedAt, deviceId: edited.deviceId }]); // сервер принял
    const r = await store.sync.applyRemotePage('wallets', page, 1); // ответ потерялся, страницу получили ещё раз
    expect(r).toEqual({ applied: 0, keptLocal: 0, lostLocal: 0 });
    expect(await store.db.wallets.get('w-1')).toMatchObject({ name: 'моя правка', dirty: 0 });
  });

  it('локальная dirty, серверная новее → заменяет, правка проиграла (lostLocal), dirty=0, карантин снят', async () => {
    const store = await makeStore({ now: () => T0 });
    const local = await store.wallets.create({ name: 'моя правка', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    await store.sync.quarantine('wallets', ['w-1'], 'ошибка');
    const r = await store.sync.applyRemotePage('wallets', [w('w-1', 5, { name: 'сервер новее', clientUpdatedAt: stamp(T0 + 5000) })], 5);
    expect(r).toEqual({ applied: 1, keptLocal: 0, lostLocal: 1 });
    expect(local.clientUpdatedAt < stamp(T0 + 5000)).toBe(true);
    expect(await store.db.wallets.get('w-1')).toMatchObject({ name: 'сервер новее', dirty: 0, syncError: null, serverSeq: 5 });
  });

  it('локальная dirty новее → остаётся (dirty, текст), serverSeq поднимается до максимума', async () => {
    const store = await makeStore({ now: () => T0 });
    await store.wallets.create({ name: 'моя новая', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    const r = await store.sync.applyRemotePage('wallets', [w('w-1', 5, { name: 'сервер старее', clientUpdatedAt: stamp(T0 - 5000) })], 5);
    expect(r).toEqual({ applied: 0, keptLocal: 1, lostLocal: 0 });
    expect(await store.db.wallets.get('w-1')).toMatchObject({ name: 'моя новая', dirty: 1, serverSeq: 5 });
    // последующая более старая по serverSeq страница serverSeq не понижает
    await store.sync.applyRemotePage('wallets', [w('w-1', 2, { name: 'ещё старее', clientUpdatedAt: stamp(T0 - 9000) })], 5);
    expect((await store.db.wallets.get('w-1'))?.serverSeq).toBe(5);
  });

  it('одинаковая версия → остаётся локальная dirty (уйдёт повторно, сервер проигнорирует — безопасно)', async () => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-same-0001' });
    const local = await store.wallets.create({ name: 'моя', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    const echo = { ...remoteWallet({ id: 'w-1', name: 'моя' }), clientUpdatedAt: local.clientUpdatedAt, deviceId: local.deviceId, createdAt: local.createdAt, sortOrder: local.sortOrder };
    const r = await store.sync.applyRemotePage('wallets', [{ entity: echo, serverSeq: 4 }], 4);
    expect(r).toEqual({ applied: 0, keptLocal: 1, lostLocal: 0 });
    expect(await store.db.wallets.get('w-1')).toMatchObject({ dirty: 1, serverSeq: 4 });
  });

  it('равные метки: решает deviceId (большее побеждает) — одинаково на всех устройствах', async () => {
    const store = await makeStore({ now: () => T0, deviceId: 'device-m-5555' });
    await store.wallets.create({ name: 'локальная', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    await store.wallets.create({ name: 'локальная2', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-2' });
    const t1 = (await store.db.wallets.get('w-1'))!.clientUpdatedAt;
    const t2 = (await store.db.wallets.get('w-2'))!.clientUpdatedAt;
    const r = await store.sync.applyRemotePage(
      'wallets',
      [w('w-1', 1, { name: 'z-побеждает', clientUpdatedAt: t1, deviceId: 'device-z-9999' }), w('w-2', 2, { name: 'a-проигрывает', clientUpdatedAt: t2, deviceId: 'device-a-0001' })],
      2,
    );
    expect(r).toEqual({ applied: 1, keptLocal: 1, lostLocal: 1 });
    expect((await store.db.wallets.get('w-1'))?.name).toBe('z-побеждает');
    expect((await store.db.wallets.get('w-2'))?.name).toBe('локальная2');
  });

  it('локальная dirty в карантине и осталась новее → карантин сохраняется', async () => {
    const store = await makeStore({ now: () => T0 });
    await store.wallets.create({ name: 'моя', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    await store.sync.quarantine('wallets', ['w-1'], 'ошибка');
    await store.sync.applyRemotePage('wallets', [w('w-1', 3, { clientUpdatedAt: stamp(T0 - 1000) })], 3);
    expect(await store.db.wallets.get('w-1')).toMatchObject({ dirty: 1, syncError: 'ошибка' });
  });

  it('повтор той же страницы ничего не меняет (идемпотентность)', async () => {
    const store = await makeStore({ now: () => T0 });
    await store.wallets.create({ name: 'моя', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    const page = [w('w-1', 3, { clientUpdatedAt: stamp(T0 - 1000) }), w('w-2', 4)];
    await store.sync.applyRemotePage('wallets', page, 4);
    const snapshot = await store.db.wallets.toArray();
    const again = await store.sync.applyRemotePage('wallets', page, 4);
    expect(await store.db.wallets.toArray()).toEqual(snapshot);
    expect(again.lostLocal).toBe(0);
  });

  it('одна строка дважды на странице: учитывается результат предыдущей', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [w('w-1', 3, { name: 'v3' }), w('w-1', 8, { name: 'v8', clientUpdatedAt: '2026-10-02T00:00:00.000Z' })], 8);
    expect(await store.db.wallets.get('w-1')).toMatchObject({ name: 'v8', serverSeq: 8 });
  });

  it('пустая страница: курс не двигается дальше прежнего, не откатывается назад', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [w('w-1', 5)], 5);
    expect(await store.sync.applyRemotePage('wallets', [], 5)).toEqual({ applied: 0, keptLocal: 0, lostLocal: 0 });
    await store.sync.applyRemotePage('wallets', [w('w-1', 2)], 2); // меньший курс не понижает
    expect(await store.sync.getCursor('wallets')).toBe(5);
  });

  it('работает для всех четырёх таблиц', async () => {
    const store = await makeStore();
    const base = { createdAt: '2026-10-01T00:00:00.000Z', clientUpdatedAt: '2026-10-01T00:00:00.000Z', deviceId: 'device-remote-1', deletedAt: null };
    const settings: Settings = { ...base, id: USER_A, baseCurrency: 'USD', locale: 'ru', weekStartsOn: 0, defaultWalletId: null };
    const category: Category = { ...base, id: 'c-1', name: 'Кафе', kind: 'expense', parentId: null, color: '#000000', icon: 'x', sortOrder: 0, archivedAt: null };
    const t: Transaction = {
      ...base, id: 't-1', kind: 'expense', walletId: 'w-1', toWalletId: null, amountMinor: 100, toAmountMinor: null, categoryId: 'c-1',
      occurredOn: '2026-10-01', note: '', baseCurrency: 'USD', baseAmountMinor: 100, fxRate: 1, fxSource: 'same',
    };
    await store.sync.applyRemotePage('settings', [{ entity: settings, serverSeq: 1 }], 1);
    await store.sync.applyRemotePage('wallets', [w('w-1', 2)], 2);
    await store.sync.applyRemotePage('categories', [{ entity: category, serverSeq: 3 }], 3);
    await store.sync.applyRemotePage('transactions', [{ entity: t, serverSeq: 4 }], 4);
    expect((await store.settings.get())?.baseCurrency).toBe('USD');
    expect(await store.db.categories.get('c-1')).toMatchObject({ name: 'Кафе', dirty: 0, serverSeq: 3 });
    expect(await store.db.transactions.get('t-1')).toMatchObject({ amountMinor: 100, dirty: 0, serverSeq: 4 });
    expect(await store.sync.counts()).toEqual({ pending: 0, quarantined: 0 });
  });

  it('лишние поля отбрасываются, служебные поля от сервера не принимаются', async () => {
    const store = await makeStore();
    const dirtyEntity = { ...remoteWallet({ id: 'w-1' }), dirty: 1, serverSeq: 9999, syncError: 'подмена', evil: '<script>' };
    await store.sync.applyRemotePage('wallets', [{ entity: dirtyEntity as never, serverSeq: 3 }], 3);
    const row = (await store.db.wallets.get('w-1')) as unknown as Record<string, unknown>;
    expect(row).toMatchObject({ dirty: 0, serverSeq: 3, syncError: null });
    expect(row['evil']).toBeUndefined();
  });

  it('не вызывает onLocalChange (это не правка пользователя)', async () => {
    const store = await makeStore();
    const seen = vi.fn();
    store.onLocalChange(seen);
    await store.sync.applyRemotePage('wallets', [w('w-1', 1)], 1);
    expect(seen).not.toHaveBeenCalled();
  });

  it('после загрузки чужих правок метка следующей правки больше увиденных (правка после синхронизации не проиграет)', async () => {
    const store = await makeStore({ now: () => T0 });
    await store.sync.applyRemotePage('wallets', [w('w-1', 1, { clientUpdatedAt: stamp(T0 + 60_000) })], 1); // чужие часы на минуту впереди
    const edited = await store.wallets.update('w-1', { name: 'моя правка после синхронизации' });
    expect(edited.clientUpdatedAt > stamp(T0 + 60_000)).toBe(true);
  });
});

describe('applyRemotePage — курсор и атомарность', () => {
  it('курс не может опережать данные страницы', async () => {
    const store = await makeStore();
    await expect(store.sync.applyRemotePage('wallets', [w('w-1', 5)], 6)).rejects.toThrow(/опережает/);
    expect(await store.db.wallets.count()).toBe(0);
    expect(await store.sync.getCursor('wallets')).toBe(0);
    await expect(store.sync.applyRemotePage('wallets', [], 1)).rejects.toThrow(/опережает/);
  });

  it('курс меньше максимума страницы допустим (страница будет получена ещё раз — безопасно)', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [w('w-1', 5), w('w-2', 8)], 5);
    expect(await store.sync.getCursor('wallets')).toBe(5);
    expect(await store.db.wallets.count()).toBe(2);
  });

  it('сбой записи курса откатывает и строки: курс не уходит вперёд данных и данные не появляются без курса', async () => {
    const store = await makeStore();
    await store.sync.applyRemotePage('wallets', [w('w-0', 1)], 1);
    const spy = vi.spyOn(store.db.meta, 'put').mockImplementation(() => Promise.reject(new Error('диск отказал')) as never);
    await expect(store.sync.applyRemotePage('wallets', [w('w-1', 2), w('w-2', 3)], 3)).rejects.toThrow(/диск отказал/);
    spy.mockRestore();
    expect(await store.sync.getCursor('wallets')).toBe(1);
    expect((await store.db.wallets.toArray()).map((r) => r.id)).toEqual(['w-0']);
    // после сбоя та же страница применяется нормально
    await store.sync.applyRemotePage('wallets', [w('w-1', 2), w('w-2', 3)], 3);
    expect(await store.db.wallets.count()).toBe(3);
    expect(await store.sync.getCursor('wallets')).toBe(3);
  });

  it('сбой записи строк не двигает курс', async () => {
    const store = await makeStore();
    const proto = Object.getPrototypeOf(store.db.wallets) as { bulkPut: (...a: unknown[]) => unknown };
    const spy = vi.spyOn(proto, 'bulkPut').mockImplementation(() => Promise.reject(new Error('квота')));
    await expect(store.sync.applyRemotePage('wallets', [w('w-1', 2)], 2)).rejects.toThrow(/квота/);
    spy.mockRestore();
    expect(await store.sync.getCursor('wallets')).toBe(0);
    expect(await store.db.wallets.count()).toBe(0);
  });

  it('битая строка на странице отвергает ВСЮ страницу до записи', async () => {
    const store = await makeStore();
    const bad = { entity: { ...remoteWallet({ id: 'w-2' }), openingBalanceMinor: 1.5 } as never, serverSeq: 3 };
    await expect(store.sync.applyRemotePage('wallets', [w('w-1', 2), bad], 3)).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.wallets.count()).toBe(0);
    expect(await store.sync.getCursor('wallets')).toBe(0);
  });

  it.each([
    ['нет обязательного поля', (e: Record<string, unknown>) => ({ ...e, name: undefined })],
    ['метка времени не каноничная', (e: Record<string, unknown>) => ({ ...e, clientUpdatedAt: '2026-10-01 00:00:00' })],
    ['id не строка', (e: Record<string, unknown>) => ({ ...e, id: 5 })],
    ['пустой id', (e: Record<string, unknown>) => ({ ...e, id: '' })],
  ])('отвергает строку: %s', async (_n, mutate) => {
    const store = await makeStore();
    const entity = mutate({ ...remoteWallet({ id: 'w-1' }) });
    await expect(store.sync.applyRemotePage('wallets', [{ entity: entity as never, serverSeq: 1 }], 1)).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.wallets.count()).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN])('serverSeq %s отвергается', async (seq) => {
    const store = await makeStore();
    await expect(store.sync.applyRemotePage('wallets', [w('w-1', seq)], 1)).rejects.toBeInstanceOf(ValidationError);
  });

  it.each([-1, 1.5, Number.NaN, Infinity])('курс %s отвергается', async (c) => {
    const store = await makeStore();
    await expect(store.sync.applyRemotePage('wallets', [], c)).rejects.toBeInstanceOf(ValidationError);
  });
});
