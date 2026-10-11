import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openStore } from '@/db';
import { IDBKeyRange } from 'fake-indexeddb';
import { remoteWallet, stamp } from './helpers';

/**
 * Модельный тест слияния: случайные последовательности локальных правок, отправок (markPushed),
 * страниц с сервера, сбоев записи, повторов страниц и скачков часов.
 * Проверки не повторяют код слияния, а сверяют результат с МОДЕЛЬЮ состояния строки (она описана правилами, а не кодом):
 *  1) чистая строка без памяти заменяется серверной; грязная БЕЗ групп (импорт) — побеждает большая пара (метка, устройство);
 *     созданная здесь, ни разу не правленная и ещё не видевшая сервера (другое устройство независимо создало ту же запись) — как
 *     «целиком»: побеждает большая пара, иначе проверка версии при записи (base_seq) отдавала бы выигрыш тому, кто синхронизируется
 *     вторым; уже видевшая сервер, но не правленная — принимает серверную; строка с памятью о правке имени («имя» — единственная
 *     группа) спорит с сервером по МЕТКАМ: правка именем побеждает, если её метка (at) позже метки серверной версии. Выигравшая
 *     правка остаётся с меткой прежней (если она и так новее серверной) либо с новой, строго больше серверной и прежней —
 *     иначе сервер молча проигнорировал бы отправку;
 *  2) dirty ⇔ версия локальная и ещё не подтверждена именно этой версией (markPushed не чистит изменённую строку);
 *     отправленная правка (markPushed) остаётся в памяти строки до версии с сервера: её группы видны и у чистой строки;
 *  3) курс = наибольший serverSeq успешно применённых страниц и никогда не опережает данные;
 *  4) сбой записи не оставляет следов; повтор страницы ничего не меняет (метка не растёт).
 * В записях с сервера правится только имя (остальные поля равны локальным), поэтому спорной бывает лишь группа «имя».
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
  | { t: 'quarantine'; i: number }
  | { t: 'strip'; i: number };

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
  { weight: 1, arbitrary: fc.record({ t: fc.constant('strip' as const), i: idx }) },
);

/** Модель строки: что должно лежать в базе по правилам. */
interface Model {
  name: string;
  stamp: string;
  device: string;
  dirty: boolean;
  /**
   * plain — без памяти о правках; new — создана здесь, не правлена (группы пусты); edit — помнит правку имени (at — её метка);
   * whole — грязная без групп (как из импорта).
   */
  kind: 'plain' | 'new' | 'edit' | 'whole';
  at?: string;
  /** Для 'new': сервер этой записи ещё не видели (serverSeq === null) — при встрече с чужой версией решает большая пара. */
  unseen?: boolean;
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
          const model = new Map<string, Model>();
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
            const entity = remoteWallet({ id, name, clientUpdatedAt: cand.stamp, deviceId: cand.device, sortOrder: local?.sortOrder ?? 0 });
            return { cand, name, entity };
          };

          const check = async (step: string) => {
            for (const id of IDS) {
              const want = model.get(id);
              const row = await rowOf(id);
              if (!want) {
                expect(row, `${step}: строки быть не должно (${id})`).toBeUndefined();
                continue;
              }
              expect(row, `${step}: строка пропала (${id})`).toBeDefined();
              expect({ stamp: row!.clientUpdatedAt, device: row!.deviceId, name: row!.name }, `${step}: не та версия (${id})`).toEqual({
                stamp: want.stamp,
                device: want.device,
                name: want.name,
              });
              // dirty ⇔ локальная версия, не подтверждённая именно ею
              expect(row!.dirty === 1, `${step}: dirty (${id})`).toBe(want.dirty);
              // группы: «имя» у строки с памятью о правке (в том числе отправленной), пусто у новой, нет у остальных
              const wantGroups = want.kind === 'edit' ? ['name'] : want.kind === 'new' ? [] : undefined;
              expect(row!.dirtyGroups, `${step}: dirtyGroups (${id})`).toEqual(wantGroups);
              if (row!.syncError !== null) expect(row!.dirty, `${step}: карантин у чистой строки (${id})`).toBe(1);
            }
            // курс = наибольший успешно применённый serverSeq
            expect(await store.sync.getCursor('wallets'), `${step}: курс`).toBe(cursor);
          };

          const doEdit = async (i: number) => {
            const id = IDS[i]!;
            const name = `L${++counter}`;
            const row = await rowOf(id);
            const saved = row
              ? await store.wallets.update(id, { name })
              : await store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id });
            const prev = model.get(id);
            // создание — «новая»; первая правка (чистой, новой или отправленной) — запоминает время правки; импортная остаётся «целиком»
            const kind: Model['kind'] = !prev ? 'new' : prev.kind === 'whole' ? 'whole' : 'edit';
            model.set(id, {
              name,
              stamp: saved.clientUpdatedAt,
              device: saved.deviceId,
              dirty: true,
              kind,
              ...(kind === 'edit' ? { at: saved.clientUpdatedAt } : {}),
              ...(kind === 'new' ? { unseen: true } : {}),
            });
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
              if (before!.dirty === 1) {
                const m = model.get(id)!;
                // отправленная правка имени помнится до версии с сервера; остальное становится «чистым»
                model.set(id, { ...m, dirty: false, kind: m.kind === 'edit' ? 'edit' : 'plain' });
              }
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
                const before = model.get(id);
                const res = await store.sync.applyRemotePage('wallets', [{ entity, serverSeq: seq }], seq);
                expect(res.applied + res.keptLocal, `${step}: учтена ровно одна строка`).toBe(1);
                const remoteModel: Model = { name, stamp: cand.stamp, device: cand.device, dirty: false, kind: 'plain' };
                if (before?.kind === 'new' && before.unseen && before.dirty) {
                  // созданная здесь запись, сервера ещё не видевшая: чужая независимая версия — побеждает большая пара
                  if (cmp(cand, before) > 0) model.set(id, remoteModel);
                  else model.set(id, { ...before, unseen: false }); // своя остаётся (уйдёт с известной версией сервера)
                  expect(res.merged, step).toBe(0);
                } else if (!before || before.kind === 'plain' || before.kind === 'new') {
                  model.set(id, remoteModel); // вставка / замена чистой / принимает серверную (создана здесь, не правлена)
                  expect(res.merged, step).toBe(0);
                } else if (before.kind === 'whole') {
                  // грязная без групп: побеждает большая пара
                  if (cmp(cand, before) > 0) model.set(id, remoteModel);
                  expect(res.merged, step).toBe(0);
                } else if (cmp(cand, { stamp: before.at!, device: LOCAL_DEVICE }) > 0) {
                  // менялись обе стороны (серверное имя всегда новое), серверная метка позже нашей правки: побеждает сервер
                  model.set(id, remoteModel);
                  expect(res.merged, step).toBe(0);
                } else if (before.dirty && cmp(before, cand) > 0) {
                  // наша правка позже и строка новее серверной: имя своё, метка прежняя (писать нечего)
                  expect(res.merged, `${step}: лишнее слияние`).toBe(0);
                } else {
                  // наша правка позже, но отправленная версия не новее серверной (или строка чистая и ждала подтверждения):
                  // имя своё, метка НОВАЯ — больше серверной (иначе сервер проигнорирует) и больше прежней нашей
                  expect(res.merged, `${step}: слияние`).toBe(1);
                  const now = (await rowOf(id))!;
                  expect(now.clientUpdatedAt > cand.stamp, `${step}: метка слияния не больше серверной`).toBe(true);
                  expect(now.clientUpdatedAt > before.stamp, `${step}: метка слияния не больше прежней`).toBe(true);
                  model.set(id, { ...before, stamp: now.clientUpdatedAt, device: LOCAL_DEVICE, dirty: true });
                }
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
              case 'strip': {
                // как строка из импорта или записанная до обновления приложения: грязная, групп нет
                const id = IDS[op.i]!;
                const row = await rowOf(id);
                const m = model.get(id);
                if (row && m && row.dirty === 1) {
                  await store.db.wallets.update(id, { dirtyGroups: undefined, dirtyBase: undefined } as never);
                  model.set(id, { ...m, kind: 'whole' });
                }
                break;
              }
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
