// @vitest-environment node
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importBackup, openStore } from '@/db';
import { SYNC_TABLES, toWire } from '@/sync/tables';
import { makeBudget, makeCategory, makeDebt, makeRecurringRule, makeTransaction, makeUserId, makeWallet } from './factories';
import { createPgliteServer, type PgliteServer } from './pglite';

let pg: PgliteServer;
beforeAll(async () => {
  pg = await createPgliteServer();
}, 120_000);
afterAll(async () => pg.close());

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TEXTS = ['', ' ', 'Али', 'a'.repeat(80), 'a'.repeat(81), '😀'.repeat(40), '😀'.repeat(41), 'x\u0000y', 'x\uD800y', 'a\nb', ' x ', 'я'.repeat(500), 'я'.repeat(501), '😀'.repeat(250), '😀'.repeat(251), ' '];
const AMOUNTS: unknown[] = [1, 2, 999_999_999_999_999, 1_000_000_000_000_000, 1_000_000_000_000_001, 0, -1, 1.5];
const DATES: unknown[] = ['2000-01-01', '1999-12-31', '2100-01-01', '2100-01-02', '2024-02-29', '2026-02-29'];
const STAMPS: unknown[] = ['2000-01-01T00:00:00.000Z', '1999-12-31T23:59:59.999Z', '2100-01-01T00:00:00.000Z', '2100-01-01T00:00:00.001Z', '2026-10-10T10:00:00.000Z', '2026-10-10T10:00:00.000+05:00', '2026-10-10T10:00:00Z', '3000-01-01T00:00:00.000Z'];
const FEE: unknown[] = [0, 1, 5, 1_000_000_000_000_000, 1_000_000_000_000_001];

describe('всё, что принял импорт копии, принимает и сервер', () => {
  it('случайные значения во всех семи таблицах', async () => {
    const rand = rng(5);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const mut = <T,>(good: T, xs: readonly T[], p = 0.04): T => (rand() < p ? pick(xs) : good);
    const bad: string[] = [];
    let imported = 0;
    for (let i = 0; i < 700; i++) {
      const userId = makeUserId();
      const store = await openStore(userId, { deviceId: `dev-imp-${i}`, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
      try {
        const s = () => ({ createdAt: mut('2026-10-01T00:00:00.000Z', STAMPS) as string, clientUpdatedAt: mut('2026-10-01T00:00:00.000Z', STAMPS) as string, deletedAt: mut(null, STAMPS, 0.03) as string | null });
        const w1 = makeWallet({ ...s(), name: mut('Нал', TEXTS), archivedAt: mut(null, STAMPS, 0.03) as string | null, openingBalanceMinor: mut(0, AMOUNTS as number[]) as number });
        const w2 = makeWallet(s());
        const c1 = makeCategory({ ...s(), name: mut('Еда', TEXTS), archivedAt: mut(null, STAMPS, 0.03) as string | null });
        const d1 = makeDebt({ ...s(), counterparty: mut('Али', TEXTS), note: mut('', TEXTS), principalMinor: mut(100, AMOUNTS as number[]) as number, openedOn: mut('2026-10-01', DATES as string[]) as string, dueOn: mut(null, DATES as string[]) as string | null, closedAt: mut(null, STAMPS, 0.03) as string | null, archivedAt: mut(null, STAMPS, 0.03) as string | null });
        const b1 = makeBudget({ ...s(), categoryId: c1.id, amountMinor: mut(100, AMOUNTS as number[]) as number, archivedAt: mut(null, STAMPS, 0.03) as string | null });
        const r1 = makeRecurringRule({ ...s(), walletId: w1.id, categoryId: c1.id, debtId: d1.id, amountMinor: mut(100, AMOUNTS as number[]) as number, note: mut('', TEXTS), startOn: mut('2026-10-01', DATES as string[]) as string, endOn: mut(null, DATES as string[]) as string | null, intervalN: mut(1, [1000, 1001, 0]) as number, archivedAt: mut(null, STAMPS, 0.03) as string | null });
        const t1 = makeTransaction({ ...s(), walletId: w1.id, categoryId: c1.id, debtId: d1.id, note: mut('', TEXTS), amountMinor: 100, baseAmountMinor: mut(100, FEE as number[]) as number, occurredOn: mut('2026-10-05', DATES as string[]) as string });
        const t2 = makeTransaction({ ...s(), kind: 'transfer', walletId: w1.id, toWalletId: w2.id, amountMinor: 1000, toAmountMinor: mut(1000, [999, 1, 1001]) as number, baseAmountMinor: mut(0, FEE as number[]) as number, note: mut('', TEXTS) });
        const file = { format: 'finora-backup', version: 2, exportedAt: '2026-10-10T00:00:00.000Z', settings: null, wallets: [w1, w2], categories: [c1], transactions: [t1, t2], budgets: [b1], debts: [d1], recurringRules: [r1] };
        try {
          await importBackup(store, file);
        } catch {
          continue;
        }
        imported++;
        await pg.addUser(userId);
        const tr = pg.transportFor(userId);
        for (const table of SYNC_TABLES) {
          if (table === 'settings') continue;
          const rows = await store.db.syncTable(table).toArray();
          for (const row of rows) {
            try {
              await tr.push(table, [toWire(table, row as never)]);
            } catch (e) {
              bad.push(`${table}: ${(e as Error).message} :: ${JSON.stringify(toWire(table, row as never)).slice(0, 400)}`);
            }
          }
        }
      } finally {
        store.close();
      }
      if (bad.length >= 6) break;
    }
    expect(bad).toEqual([]);
    expect(imported).toBeGreaterThan(20);
  }, 600_000);
});
