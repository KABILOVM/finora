import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { USER, snapshotOf } from './engineHarness';
import { apply, bootstrap, disposeWorld, endPhase, makeWorld, opsArb, quiesce, type World } from './convergenceModel';

/**
 * Сходимость: 2–3 устройства одного пользователя + сервер в памяти. Случайные правки РАЗНЫХ частей записей, случайные уходы
 * в офлайн и порядок синхронизаций, затем «тихий» этап до полной синхронизации. Инварианты — в convergenceModel.ts.
 *
 * ЧТО ИЗМЕНИЛОСЬ ОТНОСИТЕЛЬНО ПРЕЖНЕЙ ВЕРСИИ (слияние по группам полей, src/db/syncMerge.ts):
 *  - прежний инвариант «у каждой записи побеждает версия с наибольшей парой (метка, устройство) из ВСЕХ сделанных» убран: он описывал
 *    «целиком побеждает последняя запись», а теперь правки разных групп складываются, и целиковой «победившей версии» нет;
 *  - вместо него: группа, изменённая за фазу одним устройством, = его значение; спорная группа = значение одного из участников
 *    (целиком); ни одна созданная запись не потеряна и не задвоена; данные и остатки на всех устройствах и сервере совпадают;
 *  - проверки очереди (пуста, карантина нет), остатков и «лишних записей нет» не ослаблены; добавлено: число кругов до покоя
 *    ограничено и лишние круги после покоя ничего не меняют (метки не растут).
 */

const runs = Number(process.env['CONVERGENCE_RUNS'] ?? 40);
const finish = async (w: World) => (await endPhase(w)).rounds;

/** Круги, которые могут менять состояние до покоя: каждому устройству нужно успеть забрать то, что отправили остальные. */
const maxRoundsFor = (devices: number) => devices + 2;

describe('сходимость устройств и сервера', () => {
  it(
    `3 устройства, две фазы случайных правок с общей точкой между ними (${runs} прогонов)`,
    async () => {
      await fc.assert(
        fc.asyncProperty(
          opsArb(3, 25, 60),
          opsArb(3, 10, 40),
          fc.array(fc.integer({ min: -120_000, max: 120_000 }), { minLength: 3, maxLength: 3 }),
          async (first, second, skews) => {
            const w = await makeWorld(3, skews);
            try {
              await bootstrap(w);
              for (const op of first) await apply(w, op);
              expect(await finish(w)).toBeLessThanOrEqual(maxRoundsFor(3));
              for (const op of second) await apply(w, op);
              expect(await finish(w)).toBeLessThanOrEqual(maxRoundsFor(3));
            } finally {
              disposeWorld(w);
            }
          },
        ),
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
            expect(await finish(w)).toBeLessThanOrEqual(maxRoundsFor(2));
          } finally {
            disposeWorld(w);
          }
        }),
        { numRuns: Math.ceil(runs / 2), endOnFailure: true },
      );
    },
    600_000,
  );
});

describe('сходимость: заданные сценарии', () => {
  it('удаление операции на одном устройстве и правка её суммы на другом: удаление сохраняется И сумма новая (разные группы), остаток один на всех', async () => {
    // Раньше «побеждала более поздняя»: правка суммы после удаления воскрешала операцию. Теперь удаление и сумма — разные группы,
    // обе правки сохраняются: операция остаётся удалённой, а при восстановлении покажет исправленную сумму.
    const w = await makeWorld(2, [0, 0]);
    await bootstrap(w);
    await apply(w, { t: 'tx-create', d: 0, kind: 'expense', w: 0, to: 0, amount: 5_000, cat: -1 });
    await apply(w, { t: 'sync', d: 0 });
    await apply(w, { t: 'sync', d: 1 });
    await apply(w, { t: 'offline', d: 0 });
    await apply(w, { t: 'offline', d: 1 });
    await apply(w, { t: 'tx-delete', d: 0, i: 0, restore: false });
    await apply(w, { t: 'tick', ms: 10 });
    await apply(w, { t: 'tx-update', d: 1, i: 0, amount: 7_000 });
    await finish(w);
    const tx = (await w.devices[0]!.store.db.transactions.toArray())[0];
    expect(tx).toMatchObject({ amountMinor: 7_000 });
    expect(tx?.deletedAt).not.toBeNull();
    disposeWorld(w);
  });

  it('три устройства правят одно имя: итог — имя одного из них целиком, равные метки не мешают', async () => {
    const w = await makeWorld(3, [0, 0, 0]);
    await bootstrap(w);
    for (const d of [2, 0, 1]) await apply(w, { t: 'offline', d });
    for (const d of [0, 1, 2]) await apply(w, { t: 'wallet-rename', d, i: 0 }); // одна и та же миллисекунда времени: часы равны
    await apply(w, { t: 'online', d: 1 });
    await apply(w, { t: 'sync', d: 1 });
    const { stats } = await endPhase(w);
    expect(stats.contested).toBeGreaterThanOrEqual(1);
    disposeWorld(w);
  });

  it('разные части одной записи на трёх устройствах: имя, цвет и архив кошелька складываются', async () => {
    const w = await makeWorld(3, [0, 30_000, -30_000]);
    await bootstrap(w);
    for (const d of [0, 1, 2]) await apply(w, { t: 'offline', d });
    await apply(w, { t: 'wallet-rename', d: 0, i: 0 });
    await apply(w, { t: 'wallet-color', d: 1, i: 0, n: 7 });
    await apply(w, { t: 'wallet-archive', d: 2, i: 0, restore: false });
    const { stats } = await endPhase(w);
    expect(stats.single).toBeGreaterThanOrEqual(3);
    const wallet = (await w.devices[0]!.store.db.wallets.toArray())[0]!;
    expect(wallet).toMatchObject({ color: '#000007', dirty: 0 });
    expect(wallet.name).toMatch(/^W1$/);
    expect(wallet.archivedAt).not.toBeNull();
    disposeWorld(w);
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
    // победителя по меткам считать нельзя (сервер подменил метки): проверяем сходимость и целостность
    const snaps = await Promise.all(w.devices.map((d) => snapshotOf(d.store)));
    expect(snaps[1]).toEqual(snaps[0]);
    expect(snaps[0]!.wallets.length).toBeGreaterThanOrEqual(3);
    for (const d of w.devices) expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(w.server.dump(USER, 'wallets').length).toBe(snaps[0]!.wallets.length);
    disposeWorld(w);
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
    disposeWorld(w);
  });
});
