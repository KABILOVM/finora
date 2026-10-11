import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { USER } from './engineHarness';
import { apply, bootstrap, disposeWorld, endPhase, makeWorld, quiesce, type Op, type World } from './convergenceModel';

/**
 * Слияние правок разных частей одной записи (src/db/syncMerge.ts): плотные сценарии на ОДНОЙ операции и ОДНОМ кошельке
 * (чтобы устройства постоянно сталкивались), обе очерёдности синхронизации, ограниченность кругов, неподвижность меток на покое.
 * Общие инварианты — tests/sync/convergenceModel.ts.
 */

const runs = Number(process.env['CONVERGENCE_RUNS'] ?? 40);

/** Считает, сколько раз слияние сработало на каждом устройстве (чтобы тест не оказался пустым). */
function countMerges(w: World): { merged: number } {
  const total = { merged: 0 };
  for (const d of w.devices) {
    const orig = d.store.sync.applyRemotePage.bind(d.store.sync);
    d.store.sync.applyRemotePage = (async (...args: Parameters<typeof orig>) => {
      const r = await orig(...args);
      total.merged += r.merged;
      return r;
    }) as typeof orig;
  }
  return total;
}

/** Мир с одной операцией и одним кошельком, уже синхронизированный на всех устройствах. */
async function denseWorld(n: number, skews: number[]): Promise<World> {
  const w = await makeWorld(n, skews);
  await bootstrap(w);
  await apply(w, { t: 'tx-create', d: 0, kind: 'expense', w: 0, to: 0, amount: 10_000, cat: -1 });
  await quiesce(w);
  w.phase = new Map();
  return w;
}

const idx = fc.integer({ min: 0, max: 3 });
const denseOps = (n: number, min: number, max: number): fc.Arbitrary<Op[]> => {
  const d = fc.integer({ min: 0, max: n - 1 });
  return fc.array(
    fc.oneof(
      { weight: 4, arbitrary: fc.record({ t: fc.constant('tx-update' as const), d, i: idx, amount: fc.integer({ min: 1, max: 99_999 }) }) },
      { weight: 4, arbitrary: fc.record({ t: fc.constant('tx-note' as const), d, i: idx, n: fc.integer({ min: 0, max: 9 }) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('tx-date' as const), d, i: idx, day: fc.integer({ min: 1, max: 27 }) }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('tx-delete' as const), d, i: idx, restore: fc.boolean() }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('wallet-rename' as const), d, i: idx }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('wallet-color' as const), d, i: idx, n: fc.integer({ min: 0, max: 9 }) }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('wallet-opening' as const), d, i: idx, amount: fc.integer({ min: 0, max: 99_999 }) }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant('settings' as const), d }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('offline' as const), d }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('online' as const), d }) },
      { weight: 8, arbitrary: fc.record({ t: fc.constant('sync' as const), d }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('tick' as const), ms: fc.integer({ min: 0, max: 2_000 }) }) },
    ),
    { minLength: min, maxLength: max, size: 'max' },
  );
};

describe('слияние: плотные случайные конфликты на одной операции и одном кошельке', () => {
  for (const n of [2, 3]) {
    it(
      `${n} устройства, две фазы с общей точкой между ними (${runs} прогонов)`,
      async () => {
        const totals = { merged: 0, single: 0, contested: 0 };
        await fc.assert(
          fc.asyncProperty(
            denseOps(n, 20, 70),
            denseOps(n, 10, 40),
            fc.array(fc.integer({ min: -90_000, max: 90_000 }), { minLength: n, maxLength: n }),
            async (first, second, skews) => {
              const w = await denseWorld(n, skews);
              const merges = countMerges(w);
              try {
                for (const ops of [first, second]) {
                  for (const op of ops) await apply(w, op);
                  const { rounds, stats } = await endPhase(w);
                  expect(rounds, 'слишком много кругов до покоя').toBeLessThanOrEqual(n + 2);
                  totals.single += stats.single;
                  totals.contested += stats.contested;
                }
              } finally {
                totals.merged += merges.merged;
                disposeWorld(w);
              }
            },
          ),
          { numRuns: runs, endOnFailure: true },
        );
        // тест не пустой: слияния реально происходили, были и единоличные, и спорные группы
        expect(totals.merged).toBeGreaterThan(0);
        expect(totals.single).toBeGreaterThan(0);
        expect(totals.contested).toBeGreaterThan(0);
      },
      600_000,
    );
  }
});

describe('слияние: заданные сценарии', () => {
  const serverTx = (w: World) => w.server.dump(USER, 'transactions')[0]!;

  it.each([
    ['A отправляет первым', [0, 1]],
    ['B отправляет первым', [1, 0]],
  ])('сумма на A, заметка на B офлайн (%s): обе правки везде, метки больше не меняются', async (_name, order) => {
    const w = await denseWorld(2, [0, 0]);
    await apply(w, { t: 'offline', d: 0 });
    await apply(w, { t: 'offline', d: 1 });
    await apply(w, { t: 'tx-update', d: 0, i: 0, amount: 1_000 });
    await apply(w, { t: 'tick', ms: 3 });
    await apply(w, { t: 'tx-note', d: 1, i: 0, n: 5 });
    w.offline.fill(false);
    for (const d of order) await apply(w, { t: 'sync', d: d! });
    const { rounds } = await endPhase(w);
    expect(rounds).toBeLessThanOrEqual(2);
    expect(serverTx(w)).toMatchObject({ amount_minor: 1_000, base_amount_minor: 1_000 });
    expect(String(serverTx(w)['note'])).toMatch(/^заметка-5-/);
    for (const d of w.devices) expect(await d.store.db.transactions.toArray()).toMatchObject([{ amountMinor: 1_000, dirty: 0 }]);
    disposeWorld(w);
  });

  it('разные группы одного кошелька (имя на A, цвет на B) складываются независимо от меток и порядка', async () => {
    const w = await denseWorld(2, [0, 5_000]);
    await apply(w, { t: 'offline', d: 0 });
    await apply(w, { t: 'offline', d: 1 });
    await apply(w, { t: 'wallet-rename', d: 0, i: 0 });
    await apply(w, { t: 'tick', ms: 1_000 });
    await apply(w, { t: 'wallet-color', d: 1, i: 0, n: 5 });
    w.offline.fill(false);
    await apply(w, { t: 'sync', d: 1 });
    await apply(w, { t: 'sync', d: 0 });
    await endPhase(w);
    for (const d of w.devices) expect((await d.store.db.wallets.toArray())[0]).toMatchObject({ name: 'W1', color: '#000005', dirty: 0 });
    expect(w.server.dump(USER, 'wallets')[0]).toMatchObject({ name: 'W1', color: '#000005' });
    disposeWorld(w);
  });

  it('спорная группа (заметка с обеих сторон): итог — заметка той правки, что СДЕЛАНА позже (не того, кто синхронизируется позже), и она одна на всех', async () => {
    for (const order of [[0, 1], [1, 0]]) {
      const w = await denseWorld(2, [0, 0]);
      await apply(w, { t: 'offline', d: 0 });
      await apply(w, { t: 'offline', d: 1 });
      await apply(w, { t: 'tx-note', d: 0, i: 0, n: 1 });
      await apply(w, { t: 'tick', ms: 5 });
      await apply(w, { t: 'tx-note', d: 1, i: 0, n: 2 });
      w.offline.fill(false);
      for (const d of order) await apply(w, { t: 'sync', d: d! });
      await endPhase(w);
      // правку устройства 1 сделали позже по метке: она побеждает при любом порядке выхода в сеть
      expect(String(serverTx(w)['note']), `порядок ${order}`).toMatch(/^заметка-2-/);
      disposeWorld(w);
    }
  });

  it('три устройства правят три разные части одной операции + четвёртую часть кошелька: всё складывается за ограниченное число кругов', async () => {
    const w = await denseWorld(3, [0, 40_000, -40_000]);
    for (const d of [0, 1, 2]) await apply(w, { t: 'offline', d });
    await apply(w, { t: 'tx-update', d: 0, i: 0, amount: 4_242 });
    await apply(w, { t: 'tx-date', d: 1, i: 0, day: 9 });
    await apply(w, { t: 'tx-note', d: 2, i: 0, n: 3 });
    await apply(w, { t: 'wallet-color', d: 2, i: 0, n: 4 });
    await apply(w, { t: 'wallet-rename', d: 1, i: 0 });
    const { rounds, stats } = await endPhase(w);
    expect(rounds).toBeLessThanOrEqual(3);
    expect(stats.contested).toBe(0);
    expect(serverTx(w)).toMatchObject({ amount_minor: 4_242, occurred_on: '2026-10-09' });
    disposeWorld(w);
  });

  it('удалил A, а B правил сумму и заметку: операция удалена, с новой суммой и заметкой; восстановление показывает их', async () => {
    const w = await denseWorld(2, [0, 0]);
    await apply(w, { t: 'offline', d: 0 });
    await apply(w, { t: 'offline', d: 1 });
    await apply(w, { t: 'tx-delete', d: 0, i: 0, restore: false });
    await apply(w, { t: 'tx-update', d: 1, i: 0, amount: 2_000 });
    await apply(w, { t: 'tx-note', d: 1, i: 0, n: 8 });
    await endPhase(w);
    expect(serverTx(w)['deleted_at']).not.toBeNull();
    expect(serverTx(w)).toMatchObject({ amount_minor: 2_000 });
    const id = String(serverTx(w)['id']);
    const restored = await w.devices[0]!.store.transactions.restore(id);
    expect(restored).toMatchObject({ amountMinor: 2_000, deletedAt: null });
    await endPhase(w);
    disposeWorld(w);
  });

  it('A удалил и тут же восстановил (чистый ноль), а B в это время правил заметку: операция жива и с новой заметкой', async () => {
    const w = await denseWorld(2, [0, 0]);
    await apply(w, { t: 'offline', d: 0 });
    await apply(w, { t: 'offline', d: 1 });
    await apply(w, { t: 'tx-delete', d: 0, i: 0, restore: false });
    await apply(w, { t: 'tx-delete', d: 0, i: 0, restore: true });
    await apply(w, { t: 'tx-note', d: 1, i: 0, n: 4 });
    await endPhase(w);
    expect(serverTx(w)['deleted_at']).toBeNull();
    expect(String(serverTx(w)['note'])).toMatch(/^заметка-4-/);
    disposeWorld(w);
  });

  it('после покоя повторные синхронизации не трогают метки и номера (тридцать кругов — то же состояние)', async () => {
    const w = await denseWorld(3, [0, 10_000, -10_000]);
    for (const d of [0, 1, 2]) await apply(w, { t: 'offline', d });
    await apply(w, { t: 'tx-update', d: 0, i: 0, amount: 111 });
    await apply(w, { t: 'tx-note', d: 1, i: 0, n: 1 });
    await apply(w, { t: 'tx-date', d: 2, i: 0, day: 3 });
    await endPhase(w);
    const raw = async () => JSON.stringify(await Promise.all(w.devices.map((d) => d.store.db.transactions.toArray())));
    const before = await raw();
    const serverBefore = JSON.stringify(w.server.dump(USER, 'transactions'));
    for (let i = 0; i < 30; i++) for (const d of w.devices) await d.engine.syncNow();
    expect(await raw()).toBe(before);
    expect(JSON.stringify(w.server.dump(USER, 'transactions'))).toBe(serverBefore);
    disposeWorld(w);
  });

  it('группа, не тронутая локально, подхватывает чужую правку даже если наша метка новее; наша правка поверх старого содержимого не затирает чужую', async () => {
    // A (часы вперёд на минуту) правит заметку; B (часы назад) правит сумму позже по реальному времени, но с МЕНЬШЕЙ меткой.
    const w = await denseWorld(2, [60_000, -60_000]);
    await apply(w, { t: 'offline', d: 0 });
    await apply(w, { t: 'offline', d: 1 });
    await apply(w, { t: 'tx-note', d: 0, i: 0, n: 6 });
    await apply(w, { t: 'tick', ms: 100 });
    await apply(w, { t: 'tx-update', d: 1, i: 0, amount: 321 });
    w.offline.fill(false);
    await apply(w, { t: 'sync', d: 0 });
    await apply(w, { t: 'sync', d: 1 }); // метка B меньше серверной (минутой): без предварительного забора её отправка была бы проигнорирована
    await endPhase(w);
    expect(serverTx(w)).toMatchObject({ amount_minor: 321 });
    expect(String(serverTx(w)['note'])).toMatch(/^заметка-6-/);
    disposeWorld(w);
  });
});
