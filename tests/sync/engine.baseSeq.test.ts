// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMemoryServer } from '@/sync/memoryServer';
import type { WireRow } from '@/sync/tables';
import { openDevice, spy } from './engineHarness';

/** Что уходит на сервер: каждая правка несёт версию строки на сервере, поверх которой сделана (base_seq). */

describe('отправка несёт ожидаемую версию строки', () => {
  it('новая строка — 0 («на сервере её нет»); известная — тот server_seq, который устройство получило; после принятия правки версия обновляется', async () => {
    const server = createMemoryServer();
    const sent: Array<{ table: string; rows: WireRow[] }> = [];
    let sp!: ReturnType<typeof spy>;
    const d = await openDevice(server, 'dev-a', {
      seed: true,
      wrap: (inner) => {
        sp = spy(inner);
        sp.onPush = (table, rows) => void sent.push({ table, rows: rows.map((r) => ({ ...r })) });
        return sp.transport;
      },
    });
    await d.engine.syncNow();
    const first = sent.filter((s) => s.table === 'wallets').flatMap((s) => s.rows);
    expect(first.length).toBeGreaterThan(0);
    for (const r of first) expect(r['base_seq'], 'новая строка').toBe(0);

    const wallet = (await d.store.db.wallets.toArray())[0]!;
    const seqOnServer = server.dump(d.store.userId, 'wallets').find((r) => r['id'] === wallet.id)!.server_seq;
    expect(await d.store.db.wallets.get(wallet.id)).toMatchObject({ serverSeq: seqOnServer, dirty: 0 });

    sent.length = 0;
    await d.store.wallets.update(wallet.id, { name: 'Другое имя' });
    await d.engine.syncNow();
    const second = sent.filter((s) => s.table === 'wallets').flatMap((s) => s.rows);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ id: wallet.id, name: 'Другое имя', base_seq: seqOnServer });
    // принято: номер на сервере вырос, устройство его получило
    const after = server.dump(d.store.userId, 'wallets').find((r) => r['id'] === wallet.id)!.server_seq;
    expect(after).toBeGreaterThan(seqOnServer);
    expect(await d.store.db.wallets.get(wallet.id)).toMatchObject({ serverSeq: after, dirty: 0 });
  });

  it('строка, которой устройство ещё не видело на сервере, но она там есть (создана дважды), не затирает серверную молча', async () => {
    // две установки одного пользователя засеялись одновременно: у обеих «Наличные» с одним и тем же производным id
    const server = createMemoryServer();
    const a = await openDevice(server, 'dev-a', { seed: false });
    const b = await openDevice(server, 'dev-b', { seed: false });
    const mk = (d: typeof a) => d.store.wallets.create({ name: 'Наличные', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' }, { id: '00000000-0000-4000-8000-0000000000aa' });
    await mk(a);
    await mk(b);
    await a.engine.syncNow();
    await b.engine.syncNow(); // версия на сервере уже есть, а у b serverSeq null (base_seq 0) → отказ → получение → слияние → отправка
    await a.engine.syncNow();
    for (const d of [a, b]) expect(d.engine.getStatus(), d.deviceId).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(server.dump(a.store.userId, 'wallets')).toHaveLength(1);
    expect(await b.store.db.wallets.toArray()).toEqual(await a.store.db.wallets.toArray());
  });

  // Один и тот же id создан на двух устройствах офлайн: решает позднейшая метка, а не порядок синхронизации.
  it.each([
    ['a', 'a'],
    ['a', 'b'],
    ['b', 'a'],
    ['b', 'b'],
  ] as const)('двойное создание: первым синхронизируется %s, правка позже у %s — побеждает позднейшая при любом порядке', async (first, later) => {
    const server = createMemoryServer();
    const T = Date.UTC(2026, 9, 10, 12, 0, 0);
    const clock = { a: T + (later === 'a' ? 5_000 : 1_000), b: T + (later === 'b' ? 5_000 : 1_000) };
    const a = await openDevice(server, 'dev-a', { seed: false, now: () => clock.a });
    const b = await openDevice(server, 'dev-b', { seed: false, now: () => clock.b });
    const mk = (d: typeof a, name: string) =>
      d.store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' }, { id: '00000000-0000-4000-8000-0000000000bb' });
    await mk(a, 'с устройства A');
    await mk(b, 'с устройства B');
    const order = first === 'a' ? [a, b, a, b] : [b, a, b, a];
    for (const d of order) await d.engine.syncNow();
    const winner = later === 'a' ? 'с устройства A' : 'с устройства B';
    expect(server.dump(a.store.userId, 'wallets')).toEqual([expect.objectContaining({ name: winner })]);
    for (const d of [a, b]) {
      expect(d.engine.getStatus(), d.deviceId).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
      expect(await d.store.db.wallets.toArray(), d.deviceId).toEqual([expect.objectContaining({ name: winner, dirty: 0 })]);
    }
  });
});
