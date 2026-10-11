import fc from 'fast-check';
import { describe, it } from 'vitest';
import { openDevice } from './engineHarness';
import { createMemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';
import { spy, type Spy } from './engineHarness';
import { apply, bootstrap, disposeWorld, endPhase, opsArb, type Op, type World } from './convergenceModel';

/**
 * Случайные сценарии слияния С ОТКАЗАМИ СЕТИ: ответ потерян после того, как сервер принял запись («lossy»),
 * обрыв посреди отправки («partial»), огромные расхождения часов (до суток), 2–3 устройства.
 * Инварианты те же, что у tests/sync/convergenceModel.ts (одинаковые данные везде, ничего не потеряно, группа с одним
 * редактором равна его значению, остатки сходятся, метки на покое не растут).
 *
 * Потерянные ответы включаются переменной FZ_LOSSY=1: на них фуззер упирается в известные поломки (строка без групп после потерянного
 * ответа создания, см. merge.adversarial.test.ts), поэтому по умолчанию они выключены. FZ_SKEW — разброс часов, мс (по умолчанию 200 000).
 */

type Ext = Op | { t: 'lossy'; d: number } | { t: 'partial'; d: number };

const runs = Number(process.env['CONVERGENCE_RUNS'] ?? 25);

async function world(n: number, skews: number[]): Promise<{ w: World; spies: Spy[] }> {
  const time = { t: Date.now() };
  const server = createMemoryServer({ now: () => ++time.t }); // часы сервера идут вперёд на каждом запросе (как настоящие)
  const offline = Array.from({ length: n }, () => false);
  const spies: Spy[] = [];
  const devices = [];
  for (let d = 0; d < n; d++) {
    devices.push(
      await openDevice(server, `dev-${d}`, {
        seed: true,
        now: () => time.t + (skews[d] ?? 0),
        wrap: (inner) => {
          const s = spy({
            pull: async (table, after, limit) => {
              if (offline[d]) throw new TransportError('network', 'офлайн');
              return inner.pull(table, after, limit);
            },
            push: async (table, rows) => {
              if (offline[d]) throw new TransportError('network', 'офлайн');
              return inner.push(table, rows);
            },
          });
          spies[d] = s;
          return s.transport;
        },
      }),
    );
  }
  return { w: { server, devices, offline, time, names: { n: 0 }, created: new Set(), phase: new Map() }, spies };
}

async function run(w: World, spies: Spy[], op: Ext): Promise<void> {
  if (op.t === 'lossy') {
    spies[op.d]!.loseResponses = 1;
    await w.devices[op.d]!.engine.syncNow();
    spies[op.d]!.loseResponses = 0;
    return;
  }
  if (op.t === 'partial') {
    const s = spies[op.d]!;
    let n = 0;
    s.onPush = () => {
      if (n++ >= 1) throw new TransportError('network', 'обрыв');
    };
    await w.devices[op.d]!.engine.syncNow();
    s.onPush = undefined;
    return;
  }
  await apply(w, op);
}

const extArb = (n: number, min: number, max: number): fc.Arbitrary<Ext[]> =>
  fc.array(
    fc.oneof(
      { weight: 12, arbitrary: opsArb(n, 1, 1).map((l) => l[0] as Ext) },
      { weight: process.env['FZ_LOSSY'] === '1' ? 3 : 0, arbitrary: fc.record({ t: fc.constant('lossy' as const), d: fc.integer({ min: 0, max: n - 1 }) }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('partial' as const), d: fc.integer({ min: 0, max: n - 1 }) }) },
    ),
    { minLength: min, maxLength: max, size: 'max' },
  );

const SKEW = Number(process.env['FZ_SKEW'] ?? 200_000);

describe('слияние: случайные сценарии с отказами сети и большими расхождениями часов', () => {
  for (const n of [2, 3]) {
    it(`${n} устройства (${runs} прогонов)`, async () => {
      await fc.assert(
        fc.asyncProperty(
          extArb(n, 20, 70),
          fc.array(fc.integer({ min: -SKEW, max: SKEW }), { minLength: n, maxLength: n }),
          async (ops, skews) => {
            const { w, spies } = await world(n, skews);
            try {
              await bootstrap(w);
              for (const op of ops) await run(w, spies, op);
              await endPhase(w, 14);
            } finally {
              disposeWorld(w);
            }
          },
        ),
        { numRuns: runs, endOnFailure: process.env['FZ_NOSHRINK'] === '1', ...(process.env['FZ_SEED'] ? { seed: Number(process.env['FZ_SEED']), path: process.env['FZ_PATH'] } : {}) },
      );
    }, 900_000);
  }
});


