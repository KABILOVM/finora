import { describe, expect, it } from 'vitest';
import type { Wallet } from '@/domain/types';
import { makeStore, remoteWallet, stamp } from './helpers';

/** Атаки на applyRemotePage со слиянием: повторы, перестановки версий в странице, карантин, устаревшие номера. */

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const REMOTE_DEV = 'device-r-0001';
const remote = (over: Partial<Wallet>): Wallet =>
  remoteWallet({ id: 'w-1', name: 'исх', color: '#111111', clientUpdatedAt: stamp(T0 - 60_000), deviceId: REMOTE_DEV, ...over });
const page = (...rows: Array<[Wallet, number]>) => rows.map(([entity, serverSeq]) => ({ entity, serverSeq }));

async function dirtyName() {
  const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
  await store.sync.applyRemotePage('wallets', page([remote({}), 1]), 1);
  await store.wallets.update('w-1', { name: 'моё имя' });
  return store;
}
const row = async (store: Awaited<ReturnType<typeof makeStore>>) => (await store.db.wallets.get('w-1'))!;

describe('applyRemotePage: версии одной записи внутри страницы', () => {
  it.each([
    ['по возрастанию номеров', [2, 5]],
    ['по убыванию номеров', [5, 2]],
  ])('две версии одной записи (%s): итог — наше имя поверх последней серверной версии', async (_n, order) => {
    const store = await dirtyName();
    const v = (seq: number) => remote({ color: seq === 2 ? '#222222' : '#555555', clientUpdatedAt: stamp(T0 - 30_000 + seq) });
    await store.sync.applyRemotePage('wallets', page(...order.map((s): [Wallet, number] => [v(s), s])), 5);
    const after = await row(store);
    expect(after).toMatchObject({ name: 'моё имя', color: '#555555', dirty: 1, serverSeq: 5, dirtyGroups: ['name'] });
    expect(after.clientUpdatedAt > stamp(T0 - 30_000 + 5)).toBe(true);
  });

  it('страница, повторённая три раза, не двигает ни метку, ни данные', async () => {
    const store = await dirtyName();
    const p = page([remote({ color: '#222222', clientUpdatedAt: stamp(T0 - 10_000) }), 2]);
    await store.sync.applyRemotePage('wallets', p, 2);
    const first = await row(store);
    for (let i = 0; i < 3; i++) expect(await store.sync.applyRemotePage('wallets', p, 2)).toMatchObject({ merged: 0, lostLocal: 0 });
    expect(await row(store)).toEqual(first);
  });

  it('старая версия (меньший номер) после слияния не откатывает строку', async () => {
    const store = await dirtyName();
    await store.sync.applyRemotePage('wallets', page([remote({ color: '#222222', clientUpdatedAt: stamp(T0 - 10_000) }), 7]), 7);
    const first = await row(store);
    await store.sync.applyRemotePage('wallets', page([remote({ color: '#999999', clientUpdatedAt: stamp(T0 - 20_000) }), 3]), 7);
    expect(await row(store)).toEqual(first);
  });
});

describe('applyRemotePage: карантин и слияние', () => {
  it('отвергнутая сервером строка после слияния остаётся в карантине (и не уходит в очередь отправки)', async () => {
    const store = await dirtyName();
    const mine = await row(store);
    await store.sync.quarantine('wallets', [{ id: 'w-1', clientUpdatedAt: mine.clientUpdatedAt, deviceId: mine.deviceId }], 'отказ');
    await store.sync.applyRemotePage('wallets', page([remote({ color: '#222222', clientUpdatedAt: stamp(T0 + 5_000) }), 2]), 2);
    const after = await row(store);
    expect(after).toMatchObject({ name: 'моё имя', color: '#222222', syncError: 'отказ', dirty: 1 });
    expect(await store.sync.listDirty('wallets', 10)).toHaveLength(0);
    expect(await store.sync.hasMergeableEdits()).toBe(false);
    expect(await store.sync.counts()).toEqual({ pending: 0, quarantined: 1 });
    // повтор: снова в очередь
    expect(await store.sync.retryQuarantined()).toBe(1);
    expect((await store.sync.listDirty('wallets', 10)).map((x) => x.id)).toEqual(['w-1']);
  });
});

describe('markPushed и ссылка на отправленную версию', () => {
  it('отправленная версия А, затем слияние создало версию Б: markPushed(А) не чистит строку и не трогает группы', async () => {
    const store = await dirtyName();
    const sent = await row(store);
    await store.sync.applyRemotePage('wallets', page([remote({ color: '#222222', clientUpdatedAt: stamp(T0 + 5_000) }), 2]), 2);
    const merged = await row(store);
    expect(merged.clientUpdatedAt).not.toBe(sent.clientUpdatedAt);
    expect(await store.sync.markPushed('wallets', [{ id: 'w-1', clientUpdatedAt: sent.clientUpdatedAt, deviceId: sent.deviceId }])).toBe(0);
    expect(await row(store)).toEqual(merged);
  });
});
