import { describe, expect, it, vi } from 'vitest';
import { ensureSeeded } from '@/db';
import { META_INITIAL_PULL } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { UNREADABLE_MESSAGE } from '@/sync/pullPhase';
import type { PulledRow } from '@/sync/tables';
import { makeWallet } from './factories';
import { USER, openDevice, snapshotOf, spy, type Device, type Spy } from './engineHarness';

/** Первая загрузка, затравка и нечитаемые строки. */

const iso = (ms: number) => new Date(ms).toISOString();
const count = (s: MemoryServer, table: 'settings' | 'wallets' | 'categories' | 'transactions') => s.dump(USER, table).length;

describe('первая загрузка и затравка', () => {
  it('затравка вызывается один раз: после полного получения и до первой отправки', async () => {
    const server = createMemoryServer();
    const timeline: string[] = [];
    let sp!: Spy;
    const d = await openDevice(server, 'dev-a', {
      wrap: (inner) => {
        sp = spy(inner);
        const t = sp.transport;
        return {
          pull: async (table, after, limit) => (timeline.push(`pull:${table}`), t.pull(table, after, limit)),
          push: async (table, rows) => (timeline.push(`push:${table}`), t.push(table, rows)),
        };
      },
      engine: {
        afterFirstPull: async () => {
          timeline.push('seed');
          await ensureSeeded(d.store);
        },
      },
    });
    await d.engine.syncNow();
    const seed = timeline.indexOf('seed');
    expect(seed).toBeGreaterThan(0);
    expect(timeline.slice(0, seed)).toEqual(['pull:settings', 'pull:wallets', 'pull:categories', 'pull:transactions']); // всё получено до затравки
    expect(timeline.slice(seed + 1)[0]).toBe('push:settings'); // отправка — только после неё
    expect(timeline.filter((x) => x === 'seed')).toHaveLength(1);
    expect(await d.store.sync.getMeta(META_INITIAL_PULL)).toBe(true);

    await d.engine.syncNow();
    await d.engine.syncNow();
    expect(timeline.filter((x) => x === 'seed')).toHaveLength(1); // позже не вызывается
    expect(count(server, 'settings')).toBe(1);
  });

  it('затравка упала: признак первой загрузки не ставится, ничего не отправлено, следующий цикл повторяет', async () => {
    const server = createMemoryServer();
    let calls = 0;
    const d = await openDevice(server, 'dev-a', {
      engine: {
        afterFirstPull: async () => {
          calls++;
          if (calls === 1) throw new Error('диск переполнен');
          await ensureSeeded(d.store);
        },
      },
    });
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ phase: 'error', lastError: 'диск переполнен' });
    expect(await d.store.sync.getMeta(META_INITIAL_PULL)).toBeUndefined();
    expect(count(server, 'settings')).toBe(0);

    await d.engine.syncNow();
    expect(calls).toBe(2);
    expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', lastError: null });
    expect(await d.store.sync.getMeta(META_INITIAL_PULL)).toBe(true);
    expect(count(server, 'settings')).toBe(1);
  });

  it('первая загрузка не удалась (нет сети): затравка не вызывается — иначе можно затереть данные с сервера', async () => {
    const server = createMemoryServer();
    const seed = vi.fn(async () => undefined);
    const d = await openDevice(server, 'dev-a', { engine: { afterFirstPull: seed } });
    server.setOnline(false);
    await d.engine.syncNow();
    expect(d.engine.getStatus().phase).toBe('offline');
    expect(seed).not.toHaveBeenCalled();
    server.setOnline(true);
    await d.engine.syncNow();
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('без колбэка затравки признак первой загрузки всё равно ставится', async () => {
    const server = createMemoryServer();
    const d = await openDevice(server, 'dev-a');
    await d.engine.syncNow();
    expect(await d.store.sync.getMeta(META_INITIAL_PULL)).toBe(true);
    expect(d.engine.getStatus().phase).toBe('idle');
  });

  it('два устройства нового пользователя друг за другом: затравка не дублируется', async () => {
    const server = createMemoryServer();
    const a = await openDevice(server, 'dev-a', { seed: true });
    const b = await openDevice(server, 'dev-b', { seed: true });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect([count(server, 'settings'), count(server, 'wallets'), count(server, 'categories')]).toEqual([1, 1, 17]);
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
    expect(await b.store.db.wallets.count()).toBe(1);
  });

  it('два устройства нового пользователя ОДНОВРЕМЕННО (оба видят пустой сервер): дублей нет, данные сходятся', async () => {
    const server = createMemoryServer();
    server.setLatency(10); // запросы двух устройств перемешиваются
    const seeded: boolean[] = [];
    const seedWith = (get: () => Device) => async () => void seeded.push(await ensureSeeded(get().store));
    const a: Device = await openDevice(server, 'dev-a', { engine: { afterFirstPull: seedWith(() => a) } });
    const b: Device = await openDevice(server, 'dev-b', { engine: { afterFirstPull: seedWith(() => b) } });
    await Promise.all([a.engine.syncNow(), b.engine.syncNow()]);
    expect(seeded).toEqual([true, true]); // оба действительно сеяли каждый своё
    server.setLatency(0);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect([count(server, 'settings'), count(server, 'wallets'), count(server, 'categories')]).toEqual([1, 1, 17]);
    expect(await a.store.db.wallets.count()).toBe(1);
    expect(await b.store.db.wallets.count()).toBe(1);
    expect(await a.store.db.categories.count()).toBe(17);
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
    expect(b.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
  });
});

describe('нечитаемая строка с сервера', () => {
  /** Сервер с кошельками от устройства A, у устройства B ответ по кошелькам портится на 3-й строке. */
  async function setup() {
    const server = createMemoryServer();
    const a = await openDevice(server, 'dev-a', { seed: true });
    await a.engine.syncNow();
    const base = Date.now() - 3_600_000;
    for (let i = 0; i < 4; i++) {
      await a.store.db.wallets.put({
        ...makeWallet({ createdAt: iso(base + i), clientUpdatedAt: iso(base + i), deviceId: 'dev-a', sortOrder: 10 + i, name: `W${i}` }),
        dirty: 1,
        serverSeq: null,
        syncError: null,
      });
    }
    await a.engine.syncNow();
    expect(count(server, 'wallets')).toBe(5);
    let sp!: Spy;
    const afterFirstPull = vi.fn(async () => undefined);
    const b = await openDevice(server, 'dev-b', { wrap: (inner) => (sp = spy(inner)).transport, engine: { afterFirstPull } });
    return { server, a, b, sp, afterFirstPull };
  }
  const corruptThird = (rows: PulledRow[]): PulledRow[] => rows.map((r, i) => (i === 2 ? { ...r, opening_balance_minor: 'abc' } : r));

  it('на первой загрузке: принятое до неё сохранено, курс стоит перед ней, другие таблицы получены, затравка не вызвана, ошибка видна', async () => {
    const { server, b, sp, afterFirstPull } = await setup();
    sp.onPull = (table, _after, rows) => (table === 'wallets' ? corruptThird(rows) : rows);
    await b.engine.syncNow();

    expect(b.engine.getStatus()).toMatchObject({ phase: 'error', lastError: UNREADABLE_MESSAGE });
    expect(await b.store.db.wallets.count()).toBe(2); // две строки до нечитаемой
    const walletsOnServer = server.dump(USER, 'wallets');
    expect(await b.store.sync.getCursor('wallets')).toBe(walletsOnServer[1]?.server_seq);
    expect(await b.store.db.categories.count()).toBe(17); // другие таблицы не пострадали
    expect(afterFirstPull).not.toHaveBeenCalled();
    expect(await b.store.sync.getMeta(META_INITIAL_PULL)).toBeUndefined();

    // приложение «обновили» (теперь строка читается): всё доезжает, курс идёт дальше, затравка вызывается
    sp.onPull = undefined;
    await b.engine.syncNow();
    expect(b.engine.getStatus()).toMatchObject({ phase: 'idle', lastError: null });
    expect(await b.store.db.wallets.count()).toBe(5);
    expect(await b.store.sync.getCursor('wallets')).toBe(walletsOnServer[4]?.server_seq);
    expect(afterFirstPull).toHaveBeenCalledTimes(1);
  });

  it('позже, в обычной работе: курс не сдвигается за нечитаемую строку, повторные попытки ничего не ломают, после починки всё доезжает', async () => {
    const { server, a, b, sp } = await setup();
    await b.engine.syncNow(); // нормальная первая загрузка
    expect(await b.store.db.wallets.count()).toBe(5);

    const base = Date.now() - 1_800_000;
    for (let i = 0; i < 3; i++) {
      await a.store.db.wallets.put({
        ...makeWallet({ createdAt: iso(base + i), clientUpdatedAt: iso(base + i), deviceId: 'dev-a', sortOrder: 50 + i, name: `N${i}` }),
        dirty: 1,
        serverSeq: null,
        syncError: null,
      });
    }
    await a.engine.syncNow();
    const rows = server.dump(USER, 'wallets');
    expect(rows).toHaveLength(8);
    const cursorBefore = await b.store.sync.getCursor('wallets');
    expect(cursorBefore).toBe(rows[4]?.server_seq);

    const badId = rows[6]?.id; // вторая из трёх новых строк
    sp.onPull = (table, _after, page) => (table === 'wallets' ? page.map((r) => (r.id === badId ? { ...r, name: null } : r)) : page);
    for (let attempt = 0; attempt < 3; attempt++) {
      await b.engine.syncNow();
      expect(b.engine.getStatus()).toMatchObject({ phase: 'error', lastError: UNREADABLE_MESSAGE });
      expect(await b.store.db.wallets.count()).toBe(6); // пятая-шестая: первая из трёх новых принята, остальные ждут
      expect(await b.store.sync.getCursor('wallets')).toBe(rows[5]?.server_seq);
    }

    sp.onPull = undefined;
    await b.engine.syncNow();
    expect(b.engine.getStatus()).toMatchObject({ phase: 'idle', lastError: null });
    expect(await snapshotOf(b.store)).toEqual(await snapshotOf(a.store));
  });

  it('нечитаемая строка не мешает отправке: свои правки при этом уходят', async () => {
    const { server, a, b, sp } = await setup();
    await b.engine.syncNow();
    await a.store.wallets.update((await a.store.db.wallets.toArray())[0]!.id, { name: 'правка A' });
    await a.engine.syncNow();
    sp.onPull = (table, _after, page) => (table === 'wallets' ? page.map((r) => ({ ...r, currency: 5 })) : page);
    const mine = await b.store.wallets.create({ name: 'Моя', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
    await b.engine.syncNow();
    expect(b.engine.getStatus()).toMatchObject({ phase: 'error', lastError: UNREADABLE_MESSAGE, pending: 0 });
    expect(server.dump(USER, 'wallets').map((r) => r['id'])).toContain(mine.id);
  });
});
