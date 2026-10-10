import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { ValidationError, type Store } from '@/db';
import type { Entity } from '@/domain/types';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { SYNC_TABLES, TABLE_SPECS, fromWire, type SyncTableName } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { USER, openDevice, snapshotOf, type Device } from './engineHarness';

/**
 * Сходимость: 2–3 устройства одного пользователя + сервер в памяти. Случайные правки (кошельки, операции, категории,
 * настройки), случайные уходы в офлайн и порядок синхронизаций, затем «тихий» этап до полной синхронизации.
 * Инварианты:
 *  1. данные на всех устройствах и на сервере совпадают;
 *  2. у каждой записи побеждает версия с наибольшей парой (метка, устройство) из ВСЕХ когда-либо сделанных; ни одна запись не потеряна и не продублирована;
 *  3. остатки кошельков на всех устройствах равны и равны остаткам, посчитанным по победившим версиям;
 *  4. очередь пуста, карантина нет.
 */

type Row = Record<string, unknown>;
const entityOf = (table: SyncTableName, row: Row): Entity =>
  Object.fromEntries(TABLE_SPECS[table].columns.map((c) => [c.field, row[c.field] ?? null])) as unknown as Entity;
const versionKey = (e: { clientUpdatedAt: string; deviceId: string }): string => `${e.clientUpdatedAt}|${e.deviceId}`;
const newer = (a: Entity, b: Entity): boolean =>
  a.clientUpdatedAt !== b.clientUpdatedAt ? a.clientUpdatedAt > b.clientUpdatedAt : a.deviceId > b.deviceId;

type Op =
  | { t: 'wallet-create'; d: number; opening: number }
  | { t: 'wallet-rename'; d: number; i: number }
  | { t: 'wallet-archive'; d: number; i: number; restore: boolean }
  | { t: 'category-rename'; d: number; i: number }
  | { t: 'settings'; d: number }
  | { t: 'tx-create'; d: number; kind: 'expense' | 'income' | 'transfer'; w: number; to: number; amount: number; cat: number }
  | { t: 'tx-update'; d: number; i: number; amount: number }
  | { t: 'tx-delete'; d: number; i: number; restore: boolean }
  | { t: 'offline'; d: number }
  | { t: 'online'; d: number }
  | { t: 'sync'; d: number }
  | { t: 'tick'; ms: number };

const dev = (n: number) => fc.integer({ min: 0, max: n - 1 });
const idx = fc.integer({ min: 0, max: 50 });
const opsArb = (n: number, min: number, max: number): fc.Arbitrary<Op[]> =>
  fc.array(
    fc.oneof(
      { weight: 3, arbitrary: fc.record({ t: fc.constant('wallet-create' as const), d: dev(n), opening: fc.integer({ min: 0, max: 100_000 }) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('wallet-rename' as const), d: dev(n), i: idx }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('wallet-archive' as const), d: dev(n), i: idx, restore: fc.boolean() }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('category-rename' as const), d: dev(n), i: idx }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('settings' as const), d: dev(n) }) },
      {
        weight: 8,
        arbitrary: fc.record({
          t: fc.constant('tx-create' as const),
          d: dev(n),
          kind: fc.constantFrom('expense' as const, 'income' as const, 'transfer' as const),
          w: idx,
          to: idx,
          amount: fc.integer({ min: 1, max: 1_000_000 }),
          cat: fc.integer({ min: -1, max: 30 }),
        }),
      },
      { weight: 4, arbitrary: fc.record({ t: fc.constant('tx-update' as const), d: dev(n), i: idx, amount: fc.integer({ min: 1, max: 1_000_000 }) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('tx-delete' as const), d: dev(n), i: idx, restore: fc.boolean() }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('offline' as const), d: dev(n) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('online' as const), d: dev(n) }) },
      { weight: 9, arbitrary: fc.record({ t: fc.constant('sync' as const), d: dev(n) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('tick' as const), ms: fc.integer({ min: 0, max: 3_000 }) }) },
    ),
    { minLength: min, maxLength: max, size: 'max' }, // 'max': серии нужной длины, а не по две-три правки
  );

interface World {
  server: MemoryServer;
  devices: Device[];
  offline: boolean[];
  history: Record<SyncTableName, Map<string, Map<string, Entity>>>; // таблица → id → ключ версии → сущность
  time: { t: number };
  names: { n: number };
}

async function makeWorld(n: number, skews: number[], base = Date.now()): Promise<World> {
  const time = { t: base };
  const server = createMemoryServer({ now: () => time.t });
  const offline = Array.from({ length: n }, () => false);
  const devices: Device[] = [];
  for (let d = 0; d < n; d++) {
    devices.push(
      await openDevice(server, `dev-${d}`, {
        seed: true,
        now: () => time.t + (skews[d] ?? 0),
        wrap: (inner) => ({
          pull: async (table, after, limit) => {
            if (offline[d]) throw new TransportError('network', 'офлайн');
            return inner.pull(table, after, limit);
          },
          push: async (table, rows) => {
            if (offline[d]) throw new TransportError('network', 'офлайн');
            return inner.push(table, rows);
          },
        }),
      }),
    );
  }
  const history = Object.fromEntries(SYNC_TABLES.map((t) => [t, new Map()])) as World['history'];
  return { server, devices, offline, history, time, names: { n: 0 } };
}

function record(w: World, table: SyncTableName, row: object): void {
  const e = entityOf(table, row as Row);
  const byId = w.history[table].get(e.id) ?? new Map<string, Entity>();
  byId.set(versionKey(e), e);
  w.history[table].set(e.id, byId);
}

const pick = <T>(list: T[], i: number): T | undefined => (list.length === 0 ? undefined : list[i % list.length]);

/** Применяет одну операцию. Правки, которые локальные проверки не пускают (архивный кошелёк и т. п.), — пропуск. */
async function apply(w: World, op: Op): Promise<void> {
  if (op.t === 'tick') {
    w.time.t += op.ms;
    return;
  }
  const d = w.devices[op.d] as Device;
  const s: Store = d.store;
  try {
    const wallets = (await s.db.wallets.toArray()).filter((x) => x.deletedAt === null).sort((a, b) => (a.id < b.id ? -1 : 1));
    const usable = wallets.filter((x) => x.archivedAt === null);
    const txs = (await s.db.transactions.toArray()).sort((a, b) => (a.id < b.id ? -1 : 1));
    switch (op.t) {
      case 'offline':
        w.offline[op.d] = true;
        return;
      case 'online':
        w.offline[op.d] = false;
        return;
      case 'sync':
        await d.engine.syncNow();
        return;
      case 'wallet-create':
        record(w, 'wallets', await s.wallets.create({ name: `W${++w.names.n}`, currency: 'TJS', kind: 'cash', openingBalanceMinor: op.opening, color: '#111111', icon: 'w' }));
        return;
      case 'wallet-rename': {
        const x = pick(wallets, op.i);
        if (x) record(w, 'wallets', await s.wallets.update(x.id, { name: `W${++w.names.n}` }));
        return;
      }
      case 'wallet-archive': {
        const x = pick(wallets, op.i);
        if (x) record(w, 'wallets', op.restore ? await s.wallets.restore(x.id) : await s.wallets.archive(x.id));
        return;
      }
      case 'category-rename': {
        const cats = (await s.db.categories.toArray()).filter((x) => x.deletedAt === null).sort((a, b) => (a.id < b.id ? -1 : 1));
        const x = pick(cats, op.i);
        if (x) record(w, 'categories', await s.categories.update(x.id, { name: `C${++w.names.n}` }));
        return;
      }
      case 'settings': {
        const cur = await s.settings.get();
        if (cur) record(w, 'settings', await s.settings.update({ weekStartsOn: cur.weekStartsOn === 1 ? 0 : 1 }));
        return;
      }
      case 'tx-create': {
        const from = pick(usable, op.w);
        if (!from) return;
        const cats = (await s.db.categories.toArray()).filter((x) => x.deletedAt === null && x.archivedAt === null && x.kind === op.kind);
        const cat = op.kind === 'transfer' || op.cat < 0 ? undefined : pick(cats.sort((a, b) => (a.id < b.id ? -1 : 1)), op.cat);
        const target = op.kind === 'transfer' ? pick(usable.filter((x) => x.id !== from.id), op.to) : undefined;
        if (op.kind === 'transfer' && !target) return;
        record(
          w,
          'transactions',
          await s.transactions.create({
            kind: op.kind,
            walletId: from.id,
            toWalletId: target?.id ?? null,
            amountMinor: op.amount,
            categoryId: cat?.id ?? null,
            occurredOn: '2026-10-05',
          }),
        );
        return;
      }
      case 'tx-update': {
        const x = pick(txs, op.i);
        if (x) record(w, 'transactions', await s.transactions.update(x.id, { amountMinor: op.amount }));
        return;
      }
      case 'tx-delete': {
        const x = pick(txs, op.i);
        if (x) record(w, 'transactions', op.restore ? await s.transactions.restore(x.id) : await s.transactions.softDelete(x.id));
        return;
      }
    }
  } catch (e) {
    if (e instanceof ValidationError) return; // локальные правила не пустили — как будто человек этого не делал
    throw e;
  }
}

/** Начало: каждое устройство хотя бы раз синхронизировано (настройки и затравка на месте), история начинается с их состояния. */
async function bootstrap(w: World): Promise<void> {
  for (const d of w.devices) await d.engine.syncNow();
  for (const d of w.devices) await d.engine.syncNow();
  const first = w.devices[0] as Device;
  for (const table of SYNC_TABLES) for (const row of await first.store.db.syncTable(table).toArray()) record(w, table, row);
}

/** Тихий этап: все в сети, синхронизации по кругу, пока всё не уляжется. */
async function quiesce(w: World): Promise<void> {
  w.offline.fill(false);
  for (let round = 0; round < 4; round++) for (const d of w.devices) await d.engine.syncNow();
}

function winners(w: World): Record<SyncTableName, Map<string, Entity>> {
  const out = {} as Record<SyncTableName, Map<string, Entity>>;
  for (const table of SYNC_TABLES) {
    out[table] = new Map();
    for (const [id, versions] of w.history[table]) {
      let best: Entity | undefined;
      for (const e of versions.values()) if (!best || newer(e, best)) best = e;
      if (best) out[table].set(id, best);
    }
  }
  return out;
}

const byId = <T extends { id: string }>(list: T[]): T[] => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

async function checkInvariants(w: World): Promise<void> {
  // 4. очередь пуста
  for (const d of w.devices) {
    expect(d.engine.getStatus(), `${d.deviceId}: статус`).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0, lastError: null });
  }
  // 1. все устройства и сервер совпадают
  const snaps = await Promise.all(w.devices.map((d) => snapshotOf(d.store)));
  const first = snaps[0]!;
  const norm = (s: typeof first) => ({
    settings: s.settings,
    wallets: byId(s.wallets),
    categories: byId(s.categories),
    transactions: byId(s.transactions),
  });
  for (const [i, s] of snaps.entries()) expect(norm(s), `устройство ${i} против устройства 0`).toEqual(norm(first));
  const onServer = Object.fromEntries(
    SYNC_TABLES.map((t) => [t, byId(w.server.dump(USER, t).map((r) => fromWire(t, r).entity))]),
  ) as unknown as Record<SyncTableName, Entity[]>;
  expect(onServer.settings).toEqual(first.settings ? [first.settings] : []);
  expect(onServer.wallets).toEqual(norm(first).wallets);
  expect(onServer.categories).toEqual(norm(first).categories);
  expect(onServer.transactions).toEqual(norm(first).transactions);

  // 2. победитель по LWW, ничего не потеряно и не продублировано
  const win = winners(w);
  for (const t of SYNC_TABLES) {
    expect(onServer[t].map((e) => e.id).sort(), `таблица ${t}: набор записей`).toEqual([...win[t].keys()].sort());
    for (const e of onServer[t]) expect(e, `${t}/${e.id}: победившая версия`).toEqual(win[t].get(e.id));
  }

  // 3. остатки: равны на всех устройствах и равны посчитанным по победившим версиям
  const model = computeBalances(
    [...win.wallets.values()] as never,
    [...win.transactions.values()] as never,
  );
  for (const [i, s] of snaps.entries()) {
    const got = computeBalances(s.wallets, s.transactions);
    expect([...got.entries()].sort(), `остатки устройства ${i}`).toEqual([...model.entries()].sort());
  }
}

const runs = Number(process.env['CONVERGENCE_RUNS'] ?? 40);

describe('сходимость устройств и сервера', () => {
  it(
    `3 устройства, случайные правки, офлайн и порядок синхронизаций (${runs} прогонов)`,
    async () => {
      await fc.assert(
        fc.asyncProperty(opsArb(3, 25, 60), fc.array(fc.integer({ min: -120_000, max: 120_000 }), { minLength: 3, maxLength: 3 }), async (ops, skews) => {
          const w = await makeWorld(3, skews);
          try {
            await bootstrap(w);
            for (const op of ops) await apply(w, op);
            await quiesce(w);
            await checkInvariants(w);
          } finally {
            for (const d of w.devices) {
              d.engine.dispose();
              d.store.close();
            }
          }
        }),
        { numRuns: runs, endOnFailure: true },
      );
    },
    600_000,
  );

  it(
    `2 устройства, длинные серии (${Math.ceil(runs / 2)} прогонов)`,
    async () => {
      await fc.assert(
        fc.asyncProperty(opsArb(2, 40, 120), async (ops) => {
          const w = await makeWorld(2, [0, 45_000]);
          try {
            await bootstrap(w);
            for (const op of ops) await apply(w, op);
            await quiesce(w);
            await checkInvariants(w);
          } finally {
            for (const d of w.devices) {
              d.engine.dispose();
              d.store.close();
            }
          }
        }),
        { numRuns: Math.ceil(runs / 2), endOnFailure: true },
      );
    },
    600_000,
  );
});

describe('сходимость: заданные сценарии', () => {
  const finish = async (w: World) => {
    await quiesce(w);
    await checkInvariants(w);
  };

  it('удаление операции на одном устройстве и правка её суммы на другом: побеждает более поздняя, остаток один на всех', async () => {
    const w = await makeWorld(2, [0, 0]);
    await bootstrap(w);
    await apply(w, { t: 'tx-create', d: 0, kind: 'expense', w: 0, to: 0, amount: 5_000, cat: -1 });
    await apply(w, { t: 'sync', d: 0 });
    await apply(w, { t: 'sync', d: 1 });
    await apply(w, { t: 'offline', d: 0 });
    await apply(w, { t: 'offline', d: 1 });
    await apply(w, { t: 'tx-delete', d: 0, i: 0, restore: false });
    await apply(w, { t: 'tick', ms: 10 });
    await apply(w, { t: 'tx-update', d: 1, i: 0, amount: 7_000 }); // позже удаления: воскрешает с новой суммой
    await finish(w);
    const tx = (await w.devices[0]!.store.db.transactions.toArray())[0];
    expect(tx).toMatchObject({ amountMinor: 7_000, deletedAt: null });
  });

  it('три устройства правят одно имя: побеждает самая поздняя метка, равные метки решает id устройства', async () => {
    const w = await makeWorld(3, [0, 0, 0]);
    await bootstrap(w);
    for (const d of [2, 0, 1]) await apply(w, { t: 'offline', d });
    for (const d of [0, 1, 2]) await apply(w, { t: 'wallet-rename', d, i: 0 }); // одна и та же миллисекунда времени: часы равны
    await apply(w, { t: 'online', d: 1 });
    await apply(w, { t: 'sync', d: 1 });
    await finish(w);
  });

  it('устройство с часами на час вперёд: метки зажимаются сервером, но все устройства всё равно сходятся и ничего не теряется', async () => {
    const w = await makeWorld(2, [3_600_000, 0]);
    await bootstrap(w);
    await apply(w, { t: 'wallet-create', d: 0, opening: 100 });
    await apply(w, { t: 'wallet-rename', d: 0, i: 1 });
    await apply(w, { t: 'tx-create', d: 0, kind: 'income', w: 1, to: 0, amount: 900, cat: -1 });
    await apply(w, { t: 'wallet-create', d: 1, opening: 5 });
    await apply(w, { t: 'tick', ms: 1_000 });
    await apply(w, { t: 'sync', d: 1 });
    await apply(w, { t: 'sync', d: 0 });
    await quiesce(w);
    // победителя «по истории» здесь считать нельзя (сервер подменил метки): проверяем сходимость и целостность
    const snaps = await Promise.all(w.devices.map((d) => snapshotOf(d.store)));
    expect(snaps[1]).toEqual(snaps[0]);
    expect(snaps[0]!.wallets.length).toBeGreaterThanOrEqual(3);
    for (const d of w.devices) expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    const onServer = w.server.dump(USER, 'wallets').length;
    expect(onServer).toBe(snaps[0]!.wallets.length);
  });

  it('долгий офлайн: сотня правок на одном устройстве и параллельные правки на другом — всё сходится', async () => {
    const w = await makeWorld(2, [0, 20_000]);
    await bootstrap(w);
    await apply(w, { t: 'offline', d: 0 });
    for (let i = 0; i < 40; i++) {
      await apply(w, { t: 'tx-create', d: 0, kind: i % 3 === 0 ? 'income' : 'expense', w: 0, to: 0, amount: 100 + i, cat: i % 5 });
      await apply(w, { t: 'tick', ms: 50 });
      if (i % 4 === 0) await apply(w, { t: 'tx-create', d: 1, kind: 'expense', w: 0, to: 0, amount: 7 + i, cat: -1 });
      if (i % 7 === 0) await apply(w, { t: 'sync', d: 1 });
      if (i % 9 === 0) await apply(w, { t: 'tx-delete', d: 0, i, restore: false });
    }
    await finish(w);
  });
});
