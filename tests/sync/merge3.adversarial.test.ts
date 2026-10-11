import { describe, expect, it } from 'vitest';
import { createMemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';
import { USER, openDevice, snapshotOf, type Device } from './engineHarness';

/** Три устройства, три разные части одной операции, ВСЕ порядки синхронизации (включая повторные заходы). */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const perms = <T>(l: T[]): T[][] => (l.length <= 1 ? [l] : l.flatMap((x, i) => perms([...l.slice(0, i), ...l.slice(i + 1)]).map((p) => [x, ...p])));

async function trio() {
  const server = createMemoryServer();
  const off = [false, false, false];
  const devs: Device[] = [];
  for (let d = 0; d < 3; d++) {
    devs.push(
      await openDevice(server, `dev-${d}`, {
        seed: true,
        wrap: (inner) => ({
          pull: async (t, s, l) => (off[d] ? Promise.reject(new TransportError('network', 'офлайн')) : inner.pull(t, s, l)),
          push: async (t, r) => (off[d] ? Promise.reject(new TransportError('network', 'офлайн')) : inner.push(t, r)),
        }),
      }),
    );
  }
  for (const d of devs) await d.engine.syncNow();
  for (const d of devs) await d.engine.syncNow();
  const wallet = (await devs[0]!.store.db.wallets.toArray())[0]!;
  const tx = await devs[0]!.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 10_000, occurredOn: '2026-10-05', note: 'такси' });
  for (let i = 0; i < 2; i++) for (const d of devs) await d.engine.syncNow();
  return { server, off, devs, tx, wallet };
}

describe('три устройства, три части одной операции, все порядки', () => {
  for (const order of perms([0, 1, 2])) {
    it(`порядок ${order.join('→')}: сумма, заметка и дата сохраняются; удаление третьим поверх всего`, async () => {
      const { server, off, devs, tx } = await trio();
      off.fill(true);
      await devs[0]!.store.transactions.update(tx.id, { amountMinor: 20_000 });
      await sleep(2);
      await devs[1]!.store.transactions.update(tx.id, { note: 'из аэропорта' });
      await sleep(2);
      await devs[2]!.store.transactions.update(tx.id, { occurredOn: '2026-10-01' });
      off.fill(false);
      for (const i of order) await devs[i]!.engine.syncNow();
      for (let r = 0; r < 3; r++) for (const d of devs) await d.engine.syncNow();
      const row = server.dump(USER, 'transactions').find((t) => t['id'] === tx.id)!;
      expect([row['amount_minor'], row['note'], row['occurred_on']]).toEqual([20_000, 'из аэропорта', '2026-10-01']);
      const s0 = await snapshotOf(devs[0]!.store);
      expect(await snapshotOf(devs[1]!.store)).toEqual(s0);
      expect(await snapshotOf(devs[2]!.store)).toEqual(s0);
    });

    it(`порядок ${order.join('→')}: все трое правят сумму, двое — заметку: итог один и тот же на всех, значения целые`, async () => {
      const { server, off, devs, tx } = await trio();
      off.fill(true);
      await devs[0]!.store.transactions.update(tx.id, { amountMinor: 20_000 });
      await sleep(2);
      await devs[1]!.store.transactions.update(tx.id, { amountMinor: 30_000, note: 'B' });
      await sleep(2);
      await devs[2]!.store.transactions.update(tx.id, { amountMinor: 40_000, note: 'C' });
      off.fill(false);
      for (const i of order) await devs[i]!.engine.syncNow();
      for (let r = 0; r < 3; r++) for (const d of devs) await d.engine.syncNow();
      const row = server.dump(USER, 'transactions').find((t) => t['id'] === tx.id)!;
      expect([20_000, 30_000, 40_000]).toContain(row['amount_minor']);
      expect(['B', 'C']).toContain(row['note']);
      expect(row['base_amount_minor']).toBe(row['amount_minor']);
      const s0 = await snapshotOf(devs[0]!.store);
      expect(await snapshotOf(devs[1]!.store)).toEqual(s0);
      expect(await snapshotOf(devs[2]!.store)).toEqual(s0);
    });
  }
});
