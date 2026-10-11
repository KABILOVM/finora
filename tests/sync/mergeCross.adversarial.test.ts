import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FxRequiredError, ValidationError } from '@/db';
import { createMemoryServer } from '@/sync/memoryServer';
import { SYNC_TABLES } from '@/sync/tables';
import { openDevice, snapshotOf } from './engineHarness';
import { apply, bootstrap, disposeWorld, endPhase, type World } from './convergenceModel';

/**
 * Согласованность МЕЖДУ записями после слияния: вид операции = вид её категории, «операция в базовой валюте» лежит только в
 * кошельке базовой валюты, перевод в одной валюте не создаёт деньги. Правки идут с нескольких устройств и без сети.
 *
 * Правки вида категории (cat-kind) и валюты кошелька (wallet-cur) в случайный набор НЕ включены (вес 0): одновременные правки разных
 * устройств там ломают согласованность и без слияния по группам (проверено прогоном с отключёнными группами) — это предел reconcile.ts,
 * а не слияния. Детерминированные сценарии на эти случаи — в mergeReconcile.adversarial.test.ts.
 */

type XOp =
  | { t: 'tx-kind'; d: number; i: number; c: number }
  | { t: 'tx-wallet'; d: number; i: number; w: number }
  | { t: 'tx-cat'; d: number; i: number; c: number }
  | { t: 'cat-kind'; d: number; i: number }
  | { t: 'wallet-cur'; d: number; i: number; cur: 'TJS' | 'USD' }
  | { t: 'tx-new'; d: number; w: number; c: number; amount: number }
  | { t: 'xfer-new'; d: number; w: number; to: number; amount: number; toAmount: number }
  | { t: 'xfer-edit'; d: number; i: number; amount: number; toAmount: number; note: boolean }
  | { t: 'sync'; d: number }
  | { t: 'offline'; d: number }
  | { t: 'online'; d: number }
  | { t: 'tick'; ms: number };

const runs = Number(process.env['CONVERGENCE_RUNS'] ?? 25);
const pick = <T>(l: T[], i: number): T | undefined => (l.length === 0 ? undefined : l[i % l.length]);
const byId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => (a.id < b.id ? -1 : 1));

async function step(w: World, op: XOp): Promise<void> {
  if (op.t === 'sync' || op.t === 'offline' || op.t === 'online' || op.t === 'tick') return apply(w, op);
  const s = w.devices[op.d]!.store;
  try {
    const wallets = byId((await s.db.wallets.toArray()).filter((x) => x.deletedAt === null && x.archivedAt === null));
    const cats = byId((await s.db.categories.toArray()).filter((x) => x.deletedAt === null));
    const txs = byId(await s.db.transactions.toArray());
    switch (op.t) {
      case 'tx-new': {
        const wal = pick(wallets, op.w);
        if (!wal) return;
        const cat = op.c < 0 ? undefined : pick(cats.filter((c) => c.kind === 'expense'), op.c);
        const x = await s.transactions.create({ kind: 'expense', walletId: wal.id, amountMinor: op.amount, categoryId: cat?.id ?? null, occurredOn: '2026-10-05', fx: wal.currency === 'TJS' ? undefined : { rate: 10, source: 'manual' } });
        w.created.add(`transactions/${x.id}`);
        return;
      }
      case 'xfer-new': {
        const from = pick(wallets, op.w);
        const to = pick(wallets.filter((x) => x.id !== from?.id), op.to);
        if (!from || !to) return;
        const x = await s.transactions.create({ kind: 'transfer', walletId: from.id, toWalletId: to.id, amountMinor: op.amount, toAmountMinor: from.currency === to.currency ? op.amount : op.toAmount, occurredOn: '2026-10-05' });
        w.created.add(`transactions/${x.id}`);
        return;
      }
      case 'xfer-edit': {
        const x = pick(txs.filter((t) => t.kind === 'transfer'), op.i);
        if (!x) return;
        await s.transactions.update(x.id, op.note ? { note: `n${op.amount}` } : { amountMinor: op.amount, toAmountMinor: op.toAmount });
        return;
      }
      case 'tx-kind': {
        const x = pick(txs.filter((t) => t.kind !== 'transfer' && t.deletedAt === null), op.i);
        if (!x) return;
        const kind = x.kind === 'expense' ? 'income' : 'expense';
        const cat = op.c < 0 ? undefined : pick(cats.filter((c) => c.kind === kind), op.c);
        await s.transactions.update(x.id, { kind, categoryId: cat?.id ?? null });
        return;
      }
      case 'tx-cat': {
        const x = pick(txs.filter((t) => t.kind !== 'transfer' && t.deletedAt === null), op.i);
        if (!x) return;
        const cat = pick(cats.filter((c) => c.kind === x.kind), op.c);
        await s.transactions.update(x.id, { categoryId: cat?.id ?? null });
        return;
      }
      case 'tx-wallet': {
        const x = pick(txs.filter((t) => t.kind === 'expense' || t.kind === 'income'), op.i);
        const wal = pick(wallets, op.w);
        if (!x || !wal || x.deletedAt !== null) return;
        await s.transactions.update(x.id, { walletId: wal.id, fx: wal.currency === 'TJS' ? undefined : { rate: 10, source: 'manual' } });
        return;
      }
      case 'cat-kind': {
        const c = pick(cats, op.i);
        if (c) await s.categories.update(c.id, { kind: c.kind === 'expense' ? 'income' : 'expense' });
        return;
      }
      case 'wallet-cur': {
        const wal = pick(wallets, op.i);
        if (wal) await s.wallets.update(wal.id, { currency: op.cur });
        return;
      }
    }
  } catch (e) {
    if (!(e instanceof ValidationError) && !(e instanceof FxRequiredError)) throw e;
  }
}

async function crossChecks(w: World): Promise<void> {
  const snap = await snapshotOf(w.devices[0]!.store);
  const wallets = new Map(snap.wallets.map((x) => [x.id, x]));
  const cats = new Map(snap.categories.map((x) => [x.id, x]));
  for (const t of snap.transactions) {
    const wal = wallets.get(t.walletId)!;
    if (t.kind !== 'transfer') {
      expect(t.fxSource === 'same' ? wal.currency === t.baseCurrency : wal.currency !== t.baseCurrency, `операция ${t.id}: кошелёк ${wal.currency}, снимок ${t.fxSource}/${t.baseCurrency}`).toBe(true);
      if (t.deletedAt === null && t.categoryId) expect(cats.get(t.categoryId)!.kind, `операция ${t.id} (${t.kind}) в категории другого вида`).toBe(t.kind);
    } else if (t.deletedAt === null && t.toWalletId) {
      const to = wallets.get(t.toWalletId)!;
      if (wal.currency === to.currency) expect(t.toAmountMinor!, `перевод ${t.id} в одной валюте создаёт деньги`).toBeLessThanOrEqual(t.amountMinor);
    }
  }
}

const xopArb = (n: number): fc.Arbitrary<XOp[]> => {
  const d = fc.integer({ min: 0, max: n - 1 });
  const i = fc.integer({ min: 0, max: 20 });
  return fc.array(
    fc.oneof(
      { weight: 3, arbitrary: fc.record({ t: fc.constant('tx-kind' as const), d, i, c: fc.integer({ min: -1, max: 5 }) }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('tx-wallet' as const), d, i, w: i }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('tx-cat' as const), d, i, c: fc.integer({ min: 0, max: 5 }) }) },
      { weight: 0, arbitrary: fc.record({ t: fc.constant('cat-kind' as const), d, i }) },
      { weight: 0, arbitrary: fc.record({ t: fc.constant('wallet-cur' as const), d, i, cur: fc.constantFrom('TJS' as const, 'USD' as const) }) },
      { weight: 4, arbitrary: fc.record({ t: fc.constant('tx-new' as const), d, w: i, c: fc.integer({ min: -1, max: 5 }), amount: fc.integer({ min: 1, max: 99_999 }) }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('xfer-new' as const), d, w: i, to: i, amount: fc.integer({ min: 1, max: 99_999 }), toAmount: fc.integer({ min: 1, max: 99_999 }) }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('xfer-edit' as const), d, i, amount: fc.integer({ min: 1, max: 99_999 }), toAmount: fc.integer({ min: 1, max: 99_999 }), note: fc.boolean() }) },
      { weight: 8, arbitrary: fc.record({ t: fc.constant('sync' as const), d }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('offline' as const), d }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant('online' as const), d }) },
      { weight: 2, arbitrary: fc.record({ t: fc.constant('tick' as const), ms: fc.integer({ min: 0, max: 2000 }) }) },
    ),
    { minLength: 15, maxLength: 60, size: 'max' },
  );
};

async function world(n: number): Promise<World> {
  const time = { t: Date.now() };
  const server = createMemoryServer({ now: () => ++time.t });
  const offline = Array.from({ length: n }, () => false);
  const devices = [];
  for (let d = 0; d < n; d++) {
    devices.push(
      await openDevice(server, `dev-${d}`, {
        seed: true,
        now: () => time.t,
        wrap: (inner) => ({
          pull: async (table, after, limit) => {
            if (offline[d]) throw new (await import('@/sync/transport')).TransportError('network', 'офлайн');
            return inner.pull(table, after, limit);
          },
          push: async (table, rows) => {
            if (offline[d]) throw new (await import('@/sync/transport')).TransportError('network', 'офлайн');
            return inner.push(table, rows);
          },
        }),
      }),
    );
  }
  return { server, devices, offline, time, names: { n: 0 }, created: new Set(), phase: new Map() };
}

describe('согласованность между записями после слияния', () => {
  for (const n of [2, 3]) {
    it(`${n} устройства (${runs} прогонов)`, async () => {
      await fc.assert(
        fc.asyncProperty(xopArb(n), async (ops) => {
          const w = await world(n);
          try {
            await bootstrap(w);
            // стартовый набор: два кошелька (TJS и USD), по одной операции в каждом, категории уже затравлены
            const s0 = w.devices[0]!.store;
            await s0.wallets.create({ name: 'USD', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'u' });
            await w.devices[0]!.engine.syncNow();
            for (const d of w.devices) await d.engine.syncNow();
            for (const t of SYNC_TABLES) for (const r of await s0.db.syncTable(t).toArray()) w.created.add(`${t}/${r.id}`);
            for (const op of ops) await step(w, op);
            w.phase = new Map(); // группы здесь не проверяем (их проверяет convergenceModel на своих правках)
            await endPhase(w, 14);
            try {
              await crossChecks(w);
            } catch (e) {
              if (process.env['FZ_DUMP'] === '1') {
                const snap = await snapshotOf(w.devices[0]!.store);
                console.log('WALLETS', JSON.stringify(snap.wallets.map((x) => [x.id.slice(0, 4), x.name, x.currency, x.clientUpdatedAt.slice(11), x.deviceId])));
                console.log('CATS', JSON.stringify(snap.categories.map((x) => [x.id.slice(0, 4), x.name, x.kind, x.clientUpdatedAt.slice(14), x.deviceId, x.archivedAt ? 'arch' : ''])));
                console.log('TX', JSON.stringify(snap.transactions.map((t) => [t.id.slice(0, 4), t.kind, t.walletId.slice(0, 4), t.toWalletId?.slice(0, 4), t.amountMinor, t.toAmountMinor, t.fxSource, t.baseCurrency, t.deviceId, t.deletedAt ? 'del' : ''])));
              }
              throw e;
            }
          } finally {
            disposeWorld(w);
          }
        }),
        { numRuns: runs, endOnFailure: process.env['FZ_NOSHRINK'] === '1', ...(process.env['FZ_SEED'] ? { seed: Number(process.env['FZ_SEED']), path: process.env['FZ_PATH'] } : {}) },
      );
    }, 900_000);
  }
});
