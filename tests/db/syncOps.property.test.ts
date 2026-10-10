import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openStore } from '@/db';
import { IDBKeyRange } from 'fake-indexeddb';
import { remoteWallet, stamp } from './helpers';

/**
 * Модельный тест слияния: случайные последовательности локальных правок, отправок (markPushed),
 * страниц с сервера, сбоев записи, повторов страниц и скачков часов.
 * Проверки не повторяют код слияния, а сверяют результат с ИСТОРИЕЙ версий:
 *  1) итоговая версия строки = самая новая из всех виденных (локальных и серверных): новая правка не теряется;
 *  2) dirty ⇔ версия локальная и ещё не подтверждена именно этой версией (markPushed не чистит изменённую строку);
 *  3) курс = наибольший serverSeq успешно применённых страниц и никогда не опережает данные;
 *  4) сбой записи не оставляет следов; повтор страницы ничего не меняет.
 */

const IDS = ['wallet-0', 'wallet-1', 'wallet-2'] as const;
const LOCAL_DEVICE = 'device-m-5555';
const REMOTE_DEVICES = ['device-a-0001', 'device-z-9999'] as const;
const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);

type Op =
  | { t: 'edit'; i: number }
  | { t: 'snapshot'; i: number }
  | { t: 'confirm'; i: number }
  | { t: 'push'; i: number; editMid: boolean }
  | { t: 'remote'; i: number; delta: number; dev: number }
  | { t: 'fail'; i: number; delta: number; dev: number }
  | { t: 'replay' }
  | { t: 'time'; delta: number }
  | { t: 'quarantine'; i: number };

const idx = fc.integer({ min: 0, max: IDS.length - 1 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ t: fc.constant('edit' as const), i: idx }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('snapshot' as const), i: idx }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('confirm' as const), i: idx }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('push' as const), i: idx, editMid: fc.boolean() }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('remote' as const), i: idx, delta: fc.integer({ min: -40, max: 40 }), dev: fc.integer({ min: 0, max: 1 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('fail' as const), i: idx, delta: fc.integer({ min: -40, max: 40 }), dev: fc.integer({ min: 0, max: 1 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('replay' as const) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('time' as const), delta: fc.integer({ min: -5000, max: 5000 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('quarantine' as const), i: idx }) },
);

interface Version {
  stamp: string;
  device: string;
  name: string;
  local: boolean;
}
const keyOf = (v: { stamp: string; device: string }) => `${v.stamp}|${v.device}`;
const cmp = (a: { stamp: string; device: string }, b: { stamp: string; device: string }) =>
  a.stamp !== b.stamp ? (a.stamp < b.stamp ? -1 : 1) : a.device !== b.device ? (a.device < b.device ? -1 : 1) : 0;

describe('applyRemotePage / markPushed — модельный тест (fast-check)', () => {
  it('инварианты держатся на любых последовательностях', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 40 }), async (ops) => {
        let nowMs = T0;
        const store = await openStore('33333333-3333-4333-8333-333333333333', {
          deviceId: LOCAL_DEVICE,
          now: () => nowMs,
          dexie: { indexedDB: new IDBFactory(), IDBKeyRange },
        });
        try {
          const history = new Map<string, Version[]>(IDS.map((id) => [id, []]));
          const confirmed = new Set<string>();
          const refs = new Map<string, { clientUpdatedAt: string; deviceId: string }>();
          const server = new Map<string, { stamp: string; device: string }>(); // что уже «есть на сервере» по каждому id
          let seq = 0;
          let cursor = 0;
          let lastPage: { id: string; seq: number; entity: ReturnType<typeof remoteWallet> } | null = null;
          let counter = 0;

          const rowOf = (id: string) => store.db.wallets.get(id);

          const buildRemote = async (i: number, delta: number, dev: number) => {
            const id = IDS[i]!;
            const local = await rowOf(id);
            const baseMs = local ? Date.parse(local.clientUpdatedAt) : nowMs;
            let cand = { stamp: stamp(baseMs + delta), device: REMOTE_DEVICES[dev]! };
            const known = server.get(id);
            // сервер принимает только версии строго больше уже сохранённой
            if (known && cmp(cand, known) <= 0) cand = { stamp: stamp(Date.parse(known.stamp) + 1), device: cand.device };
            const name = `R${++counter}`;
            const entity = remoteWallet({ id, name, clientUpdatedAt: cand.stamp, deviceId: cand.device });
            return { cand, name, entity };
          };

          const check = async (step: string) => {
            for (const id of IDS) {
              const versions = history.get(id)!;
              const row = await rowOf(id);
              if (versions.length === 0) {
                expect(row, `${step}: строки быть не должно (${id})`).toBeUndefined();
                continue;
              }
              expect(row, `${step}: строка пропала (${id})`).toBeDefined();
              const best = versions.reduce((m, v) => (cmp(v, m) > 0 ? v : m));
              // 1) побеждает самая новая версия из всех виденных — ни одна новая правка не потеряна
              expect({ stamp: row!.clientUpdatedAt, device: row!.deviceId, name: row!.name }, `${step}: не та версия (${id})`).toEqual({
                stamp: best.stamp,
                device: best.device,
                name: best.name,
              });
              // 2) dirty ⇔ локальная версия, не подтверждённая именно ею
              const expectedDirty = best.local && !confirmed.has(keyOf(best));
              expect(row!.dirty === 1, `${step}: dirty (${id})`).toBe(expectedDirty);
              if (row!.syncError !== null) expect(row!.dirty, `${step}: карантин у чистой строки (${id})`).toBe(1);
            }
            // 3) курс = наибольший успешно применённый serverSeq
            expect(await store.sync.getCursor('wallets'), `${step}: курс`).toBe(cursor);
          };

          const doEdit = async (i: number) => {
            const id = IDS[i]!;
            const name = `L${++counter}`;
            const row = await rowOf(id);
            const saved = row
              ? await store.wallets.update(id, { name })
              : await store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id });
            history.get(id)!.push({ stamp: saved.clientUpdatedAt, device: saved.deviceId, name, local: true });
          };
          const doSnapshot = async (i: number) => {
            const row = await rowOf(IDS[i]!);
            if (row) refs.set(row.id, { clientUpdatedAt: row.clientUpdatedAt, deviceId: row.deviceId });
          };
          const doConfirm = async (i: number, step: string) => {
            const id = IDS[i]!;
            const ref = refs.get(id);
            if (!ref) return;
            const before = await rowOf(id);
            const cleared = await store.sync.markPushed('wallets', [{ id, ...ref }]);
            const sameVersion = !!before && before.clientUpdatedAt === ref.clientUpdatedAt && before.deviceId === ref.deviceId;
            // markPushed не чистит изменённую строку и чистит ровно ту версию, что отправляли
            expect(cleared, `${step}: markPushed`).toBe(sameVersion && before!.dirty === 1 ? 1 : 0);
            if (sameVersion) {
              confirmed.add(keyOf({ stamp: ref.clientUpdatedAt, device: ref.deviceId }));
              const known = server.get(id);
              const v = { stamp: ref.clientUpdatedAt, device: ref.deviceId };
              if (!known || cmp(v, known) > 0) server.set(id, v); // сервер принял эту версию
            }
          };

          for (const [n, op] of ops.entries()) {
            const step = `#${n} ${JSON.stringify(op)}`;
            switch (op.t) {
              case 'edit':
                await doEdit(op.i);
                break;
              case 'snapshot':
                await doSnapshot(op.i);
                break;
              case 'confirm':
                await doConfirm(op.i, step);
                break;
              case 'push':
                // как настоящий движок: взял версию → отправил → (за это время человек мог исправить) → подтвердил
                await doSnapshot(op.i);
                if (op.editMid) await doEdit(op.i);
                await doConfirm(op.i, step);
                break;
              case 'remote': {
                const id = IDS[op.i]!;
                const { cand, name, entity } = await buildRemote(op.i, op.delta, op.dev);
                seq += 1;
                const res = await store.sync.applyRemotePage('wallets', [{ entity, serverSeq: seq }], seq);
                expect(res.applied + res.keptLocal, `${step}: учтена ровно одна строка`).toBe(1);
                history.get(id)!.push({ stamp: cand.stamp, device: cand.device, name, local: false });
                server.set(id, cand);
                cursor = seq;
                lastPage = { id, seq, entity };
                break;
              }
              case 'fail': {
                const { entity } = await buildRemote(op.i, op.delta, op.dev);
                const before = await store.db.wallets.toArray();
                const spy = vi.spyOn(store.db.meta, 'put').mockImplementation(() => Promise.reject(new Error('сбой диска')) as never);
                await expect(store.sync.applyRemotePage('wallets', [{ entity, serverSeq: seq + 1 }], seq + 1)).rejects.toThrow(/сбой диска/);
                spy.mockRestore();
                expect(await store.db.wallets.toArray(), `${step}: сбой оставил следы`).toEqual(before);
                break;
              }
              case 'replay': {
                if (!lastPage) break;
                const before = await store.db.wallets.toArray();
                await store.sync.applyRemotePage('wallets', [{ entity: lastPage.entity, serverSeq: lastPage.seq }], lastPage.seq);
                expect(await store.db.wallets.toArray(), `${step}: повтор страницы изменил данные`).toEqual(before);
                break;
              }
              case 'time':
                nowMs += op.delta;
                break;
              case 'quarantine': {
                const id = IDS[op.i]!;
                const row = await rowOf(id);
                if (row) {
                  await store.sync.quarantine('wallets', [{ id, clientUpdatedAt: row.clientUpdatedAt, deviceId: row.deviceId }], 'отказ сервера');
                }
                break;
              }
            }
            await check(step);
          }

          // Сквозная проверка очереди: в listDirty попадают ровно «грязные» строки без карантина, старые первыми.
          const dirty = (await store.db.wallets.toArray()).filter((r) => r.dirty === 1 && r.syncError === null);
          const listed = await store.sync.listDirty('wallets', 100);
          expect(listed.map((r) => r.id).sort()).toEqual(dirty.map((r) => r.id).sort());
          expect(listed.map((r) => r.clientUpdatedAt)).toEqual([...listed.map((r) => r.clientUpdatedAt)].sort());
        } finally {
          store.close();
        }
      }),
      { numRuns: 300 },
    );
  });
});
