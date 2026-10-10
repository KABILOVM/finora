import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { META_LAST_SYNCED_AT } from '@/db';
import { syncBadgeText } from '@/components/SyncBadge';
import { createSyncEngine } from '@/sync/engine';
import type { SyncStatus, SyncTransport } from '@/sync/transport';
import { settle } from '../sync/engineHarness';
import { basics, makeStore } from './helpers';

/**
 * Атака: честный статус при запуске. В прошлом сеансе синхронизация дошла до конца (в базе лежит lastSyncedAt), потом
 * человек офлайн внёс записи. Открываем приложение: движок читает lastSyncedAt и ТОЛЬКО ПОТОМ считает очередь.
 * Пока очередь не посчитана, у статуса pending = 0, а lastSyncedAt уже настоящий: бейдж показал бы «Синхронизировано».
 */

const hangingTransport: SyncTransport = {
  pull: () => new Promise(() => undefined),
  push: () => new Promise(() => undefined),
} as unknown as SyncTransport;

describe('SyncBadge при запуске: «Синхронизировано» не должно мелькать, пока в очереди есть записи', () => {
  it('ни один показанный статус не говорит «Синхронизировано», если на самом деле есть неотправленное', async () => {
    const store = await makeStore({ factory: new IDBFactory() });
    await basics(store); // несколько записей, ещё не отправленных
    await store.sync.setMeta(META_LAST_SYNCED_AT, '2026-10-01T10:00:00.000Z'); // прошлый сеанс закончил цикл
    const truePending = (await store.sync.counts()).pending;
    expect(truePending).toBeGreaterThan(0);

    const engine = createSyncEngine({ store, transport: hangingTransport });
    const seen: SyncStatus[] = [];
    engine.subscribe((s) => seen.push(s));
    try {
      await settle(200);
      const texts = seen.map((s) => syncBadgeText(s.phase, s.pending, s.quarantined, s.lastSyncedAt));
      // в конце всё честно...
      expect(engine.getStatus().pending).toBe(truePending);
      // ...но в середине пути не было ни одного вранья
      expect(texts).not.toContain('Синхронизировано');
    } finally {
      engine.dispose();
    }
  });
});
