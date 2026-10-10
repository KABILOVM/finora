import fc from 'fast-check';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openStore, type Store } from '@/db';
import type { Wallet } from '@/domain/types';

/**
 * Многоустройственная симуляция с сервером, который ТОЧНО повторяет триггер sync_guard
 * (зажим «сейчас+5 мин», строгая новизна, server_seq), и наивным движком (отправка → markPushed → загрузка).
 */
const USER = '44444444-4444-4444-8444-444444444444';
const IDS = ['w-0', 'w-1'] as const;
const FIVE = 5 * 60 * 1000;

interface SRow { entity: Wallet; seq: number }
class FakeServer {
  rows = new Map<string, SRow>();
  seq = 0;
  constructor(public now: () => number) {}
  push(batch: Wallet[]) {
    for (const e of batch) {
      const limit = this.now() + FIVE;
      const cu = Math.min(Date.parse(e.clientUpdatedAt), limit);
      const stored = this.rows.get(e.id);
      const next: Wallet = { ...e, clientUpdatedAt: new Date(cu).toISOString() };
      if (!stored) { this.rows.set(e.id, { entity: next, seq: ++this.seq }); continue; }
      const oc = Date.parse(stored.entity.clientUpdatedAt);
      if (cu < oc || (cu === oc && next.deviceId <= stored.entity.deviceId)) continue;
      this.rows.set(e.id, { entity: { ...next, createdAt: stored.entity.createdAt }, seq: ++this.seq });
    }
  }
  pull(after: number, limit: number) {
    return [...this.rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit);
  }
}

type Op =
  | { t: 'edit'; d: number; i: number }
  | { t: 'push'; d: number; editMid: boolean; crash: boolean }
  | { t: 'pull'; d: number; page: number };
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('edit' as const), d: fc.integer({ min: 0, max: 2 }), i: fc.integer({ min: 0, max: 1 }) }),
  fc.record({ t: fc.constant('push' as const), d: fc.integer({ min: 0, max: 2 }), editMid: fc.boolean(), crash: fc.boolean() }),
  fc.record({ t: fc.constant('pull' as const), d: fc.integer({ min: 0, max: 2 }), page: fc.integer({ min: 1, max: 3 }) }),
);

describe.each([0, 120_000])('симуляция трёх устройств, расхождение часов до %i мс', (SKEW) => {
  it('сходимость; при точных часах «последняя правка по реальному времени побеждает»', { timeout: 300_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 30, maxLength: 80, size: 'max' }), fc.array(fc.integer({ min: -SKEW, max: SKEW }), { minLength: 3, maxLength: 3 }), async (ops, skews) => {
        let nowMs = Date.UTC(2026, 9, 10, 12, 0, 0);
        const server = new FakeServer(() => nowMs);
        const stores: Store[] = [];
        for (let d = 0; d < 3; d++) {
          stores.push(await openStore(USER, { deviceId: `device-${d}-aaaa`, now: () => nowMs + skews[d]!, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } }));
        }
        try {
          const lastEdit = new Map<string, { name: string }>();
          let counter = 0;
          const edit = async (d: number, i: number) => {
            nowMs += 7;
            const s = stores[d]!;
            const id = IDS[i]!;
            const name = `E${++counter}`;
            const cur = await s.db.wallets.get(id);
            if (cur) {
              const saved = await s.wallets.update(id, { name });
              expect(saved.clientUpdatedAt > cur.clientUpdatedAt, `правка на устройстве ${d} старше версии, которую она заменила (${cur.clientUpdatedAt} -> ${saved.clientUpdatedAt})`).toBe(true);
            } else await s.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id });
            lastEdit.set(id, { name });
          };
          const strip = (r: any): Wallet => { const { dirty: _d, serverSeq: _s, syncError: _e, ...rest } = r; return rest as Wallet; };
          const pull = async (d: number, page: number) => {
            const s = stores[d]!;
            for (;;) {
              const cursor = await s.sync.getCursor('wallets');
              const rows = server.pull(cursor, page);
              const next = rows.length ? rows[rows.length - 1]!.seq : cursor;
              await s.sync.applyRemotePage('wallets', rows.map((r) => ({ entity: r.entity, serverSeq: r.seq })), next);
              if (rows.length < page) break;
            }
          };
          const push = async (d: number, editMid: boolean, crash: boolean) => {
            const s = stores[d]!;
            const dirty = await s.sync.listDirty('wallets', 10);
            if (!dirty.length) return;
            server.push(dirty.map(strip));
            if (editMid) await edit(d, 0);
            if (crash) return;
            await s.sync.markPushed('wallets', dirty.map((r) => ({ id: r.id, clientUpdatedAt: r.clientUpdatedAt, deviceId: r.deviceId })));
          };
          for (const op of ops) {
            nowMs += 3;
            if (op.t === 'edit') await edit(op.d, op.i);
            else if (op.t === 'push') await push(op.d, op.editMid, op.crash);
            else await pull(op.d, op.page);
          }
          // доводим до покоя
          for (let round = 0; round < 4; round++) {
            for (let d = 0; d < 3; d++) {
              nowMs += 3;
              await push(d, false, false);
              await pull(d, 2);
            }
          }
          for (const id of IDS) {
            const srv = server.rows.get(id);
            const want = lastEdit.get(id);
            for (let d = 0; d < 3; d++) {
              const row = await stores[d]!.db.wallets.get(id);
              if (!srv) { expect(row?.dirty ?? 0).toBe(0); continue; }
              expect(row, `устройство ${d} не получило ${id}`).toBeDefined();
              expect({ n: row!.name, st: row!.clientUpdatedAt, dv: row!.deviceId, dirty: row!.dirty }, `устройство ${d}, ${id}`).toEqual({ n: srv.entity.name, st: srv.entity.clientUpdatedAt, dv: srv.entity.deviceId, dirty: 0 });
            }
            if (want && SKEW === 0) expect(srv!.entity.name, `последняя правка ${id} потеряна`).toBe(want.name);
          }
        } finally {
          stores.forEach((s) => s.close());
        }
      }),
      { numRuns: 150 },
    );
  });
});
