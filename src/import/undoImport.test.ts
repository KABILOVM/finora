import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSeeded, openStore, type Store } from '@/db';
import { fixtureText } from './__fixtures__/load';
import { computeIds } from './ids';
import { parseZenmoney } from './parse';
import { buildPlan } from './plan';
import { runImport } from './runImport';
import { undoImport } from './undoImport';

const stores: Store[] = [];
async function freshStore(): Promise<Store> {
  const store = await openStore('user-undo-1', { deviceId: 'device-test', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  stores.push(store);
  await ensureSeeded(store);
  return store;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  vi.restoreAllMocks();
});

async function planFor(store: Store, text: string) {
  const parsed = parseZenmoney(text);
  const ids = await computeIds(store.userId, parsed);
  const [wallets, categories, txs] = await Promise.all([store.db.wallets.toArray(), store.db.categories.toArray(), store.db.transactions.toArray()]);
  return buildPlan({ parsed, ids, baseCurrency: 'TJS', wallets, categories, existing: new Map(txs.map((t) => [t.id, t.deletedAt !== null])), rates: { USD: 10.9 } });
}

const live = (s: Store) => s.db.transactions.filter((t) => t.deletedAt === null).toArray();
const text = fixtureText('basic.csv');

describe('undoImport: отмена импорта', () => {
  it('отчёт запуска несёт журнал: что записано, какие кошельки и категории созданы', async () => {
    const store = await freshStore();
    const report = await runImport(store, await planFor(store, text));
    expect(report.journal?.txIds).toHaveLength(10);
    expect(report.journal?.walletIds).toHaveLength(2);
    expect(report.journal?.categoryIds).toHaveLength(1);
  });

  it('все операции файла уходят в удалённые, созданные кошельки и категории — в архив; чужое не тронуто', async () => {
    const store = await freshStore();
    const own = (await store.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
    await store.transactions.create({ kind: 'expense', walletId: own.id, amountMinor: 500, occurredOn: '2026-09-30', note: 'моя трата' });
    const report = await runImport(store, await planFor(store, text));
    expect((await live(store)).length).toBe(11);

    const r = await undoImport(store, report.journal!);
    expect(r).toMatchObject({ removedTxs: 10, archivedWallets: 2, archivedCategories: 1, failed: 0, keptInUse: 0 });
    const left = await live(store);
    expect(left.map((t) => t.note)).toEqual(['моя трата']);
    const created = (await store.db.wallets.toArray()).filter((w) => ['Карта Алиф', 'Доллары'].includes(w.name));
    expect(created.every((w) => w.archivedAt !== null)).toBe(true);
  });

  it('кошелёк, в который вы успели внести свою операцию, остаётся; уже удалённые операции пропускаются; повтор безопасен', async () => {
    const store = await freshStore();
    const report = await runImport(store, await planFor(store, text));
    const card = (await store.db.wallets.toArray()).find((w) => w.name === 'Карта Алиф')!;
    await store.transactions.create({ kind: 'expense', walletId: card.id, amountMinor: 100, occurredOn: '2026-10-01', note: 'после импорта' });
    await store.transactions.softDelete(report.journal!.txIds[0]!); // одну операцию удалили вручную

    const r = await undoImport(store, report.journal!);
    expect(r.removedTxs).toBe(9);
    expect(r.keptInUse).toBe(1); // «Карта Алиф» с вашей операцией
    expect(r.archivedWallets).toBe(1);
    expect((await live(store)).map((t) => t.note)).toEqual(['после импорта']);
    const again = await undoImport(store, report.journal!);
    expect(again.removedTxs).toBe(0);
  });

  it('загрузка того же файла после отмены ничего не возвращает: строки «уже есть, но удалены»', async () => {
    const store = await freshStore();
    const report = await runImport(store, await planFor(store, text));
    await undoImport(store, report.journal!);
    const plan = await planFor(store, text);
    expect(plan.counts.add).toBe(0);
    expect(plan.counts.existsDeleted).toBe(10);
  });
});
