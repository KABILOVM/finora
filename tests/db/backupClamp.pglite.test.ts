// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from '@/db';
import { createSyncEngine } from '@/sync/engine';
import { toWire } from '@/sync/tables';
import { TransportError } from '@/sync/transport';
import { makeUserId, makeWallet } from '../sync/factories';
import { createPgliteServer, type PgliteServer } from '../sync/pglite';
import { basics, expense, makeStore } from './helpers';

/**
 * Сквозная проверка на настоящей схеме сервера (PGlite + supabase/schema.sql): старая копия с метками 1970 и 2200 года
 * после импорта уходит на сервер БЕЗ карантина, потому что метки подрезаны в границы CHECK ..._ts_sane (2000–2100).
 */

let server: PgliteServer;
beforeAll(async () => {
  server = await createPgliteServer();
}, 120_000);
afterAll(async () => {
  await server.close();
});

type Json = Record<string, any>;

describe('старая копия → сервер', () => {
  it('контроль: строка с меткой 1970 года, отправленная как есть, сервером отвергается (поэтому подрезание нужно)', async () => {
    const userId = makeUserId();
    const wire = toWire('wallets', makeWallet({ createdAt: '1970-01-01T00:00:00.000Z', clientUpdatedAt: '1970-01-01T00:00:01.000Z' }));
    const err = await server.transportFor(userId).push('wallets', [wire]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe('rejected');
  });

  it('копия с метками 1970 и 2200 года: импорт → синхронизация → ни одной записи в карантине, на сервере всё внутри 2000–2100', async () => {
    const userId = makeUserId();
    const src = await makeStore({ userId, factory: new IDBFactory() });
    const b = await basics(src);
    await expense(src, b.cash.id, 1200, { categoryId: b.food.id, note: 'Обед' });
    const gone = await expense(src, b.cash.id, 300);
    await src.transactions.softDelete(gone.id);
    await src.wallets.archive(b.usd.id);
    await src.categories.archive(b.salary.id);

    const file = JSON.parse(JSON.stringify(await exportBackup(src))) as Json;
    let n = 0;
    for (const r of [file.settings, ...file.wallets, ...file.categories, ...file.transactions] as Json[]) {
      const old = n++ % 2 === 0; // половина строк — «из 1970», половина — «из 2200»
      const bad = old ? '1970-01-01T00:00:00.000Z' : '2200-01-01T00:00:00.000Z';
      r.createdAt = bad;
      r.clientUpdatedAt = bad;
      if (r.deletedAt) r.deletedAt = bad;
      if (r.archivedAt) r.archivedAt = bad;
    }

    const dst = await makeStore({ userId, factory: new IDBFactory() });
    await importBackup(dst, file);
    const total = 1 + file.wallets.length + file.categories.length + file.transactions.length;
    expect((await dst.sync.counts()).pending).toBe(total);

    const engine = createSyncEngine({ store: dst, transport: server.transportFor(userId) });
    try {
      await engine.syncNow('manual');
      expect(engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0, lastError: null });
    } finally {
      engine.dispose();
    }

    for (const table of ['settings', 'wallets', 'categories', 'transactions'] as const) {
      const rows = (await server.adminRows(table)).filter((r) => r['user_id'] === userId);
      expect(rows.length, table).toBeGreaterThan(0);
      for (const r of rows) {
        for (const col of ['created_at', 'client_updated_at', 'deleted_at', 'archived_at']) {
          const v = r[col];
          if (typeof v !== 'string') continue;
          const ms = Date.parse(v);
          expect(ms >= Date.UTC(2000, 0, 1) && ms <= Date.UTC(2100, 0, 1), `${table}.${col}=${v}`).toBe(true);
        }
      }
    }
    expect((await server.adminRows('transactions')).filter((r) => r['user_id'] === userId)).toHaveLength(file.transactions.length);
  }, 60_000);
});
