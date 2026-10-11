/**
 * Атака 3. Импорт резервной копии → синхронизация. Через настоящий экран «Настройки → Загрузить копию (JSON)»:
 * импортированное доезжает до сервера и второго устройства один раз; повторный импорт не плодит дубли;
 * копия из ЛОКАЛЬНОГО режима (другой id пользователя) грузится в облачный аккаунт.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { LOCAL_USER_ID } from '@/auth/config';
import { act, fire, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { ensureSeeded, exportBackup, openStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import type { SessionAwareTransport } from '@/sync/session';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const text = () => document.body.textContent ?? '';
const balancesOf = async (s: Store) =>
  Object.fromEntries(computeBalances((await s.db.wallets.toArray()).filter((w) => w.deletedAt === null), await s.db.transactions.toArray()));

/** Локальный режим: один «пользователь устройства», копия делается в нём. */
async function makeLocalBackup(): Promise<string> {
  const store = await openStore(LOCAL_USER_ID, { deviceId: 'local-dev', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
  const cash = (await store.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  const usd = await store.wallets.create({ name: 'Копилка', currency: 'USD', kind: 'savings', openingBalanceMinor: 100_00, color: '#2563eb', icon: '💰' });
  const food = (await store.db.categories.toArray()).find((c) => c.name === 'Еда')!;
  await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 12_50, categoryId: food.id, occurredOn: '2026-10-01', note: 'обед' });
  await store.transactions.create({ kind: 'expense', walletId: usd.id, amountMinor: 5_00, categoryId: food.id, occurredOn: '2026-10-02', note: 'coffee', fx: { rate: 10.9, source: 'nbt' } });
  await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 109_00, toAmountMinor: 10_00, occurredOn: '2026-10-03', note: 'обмен' });
  const gone = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 99_00, occurredOn: '2026-10-04', note: 'удалённая' });
  await store.transactions.softDelete(gone.id);
  const json = JSON.stringify(await exportBackup(store));
  store.close();
  return json;
}

async function chooseFile(json: string, name = 'finora-backup.json') {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([json], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fire(input, new Event('change', { bubbles: true }));
}

function setup(server: MemoryServer) {
  const td = makeTestDeps();
  const engines: SyncEngine[] = [];
  td.deps.openStore = async (uid) => {
    const s = await openStore(uid, { deviceId: 'dev-a', dexie: { indexedDB: td.factory, IDBKeyRange } });
    td.stores.push(s);
    return s;
  };
  td.deps.createTransport = () => server.transportFor(ALICE.id) as SessionAwareTransport;
  td.deps.createEngine = (o) => {
    const e = createSyncEngine(o);
    engines.push(e);
    return e;
  };
  return { td, engines };
}

async function openSettings(server: MemoryServer) {
  const s = setup(server);
  renderAppRoot(<AppRoutes />, { client: fakeAuthClient({ session: ALICE }).client, deps: s.td.deps, path: '/settings' });
  await waitFor(() => screen.getByRole('heading', { name: 'Настройки', level: 1 }), 15_000);
  await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);
  return { ...s, store: s.td.stores[0] as Store, engine: s.engines[0] as SyncEngine };
}

async function bare(server: MemoryServer, id: string) {
  const store = await openStore(ALICE.id, { deviceId: id, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  const engine = createSyncEngine({ store, transport: server.transportFor(ALICE.id), afterFirstPull: async () => void (await ensureSeeded(store)) });
  return { store, engine };
}

const serverTx = (server: MemoryServer) => server.dump(ALICE.id, 'transactions').map((r) => `${r['id']}|${r['server_seq']}`).sort();
const sig = async (s: Store) =>
  JSON.stringify([
    (await s.db.wallets.toArray()).map((w) => `${w.id}|${w.name}|${w.currency}`).sort(),
    (await s.db.categories.toArray()).map((c) => `${c.id}|${c.name}`).sort(),
    (await s.db.transactions.toArray()).map((t) => `${t.id}|${t.amountMinor}|${t.toAmountMinor}|${t.baseAmountMinor}|${t.deletedAt ? 'x' : 'ok'}`).sort(),
  ]);

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('атака 3: импорт копии и синхронизация', () => {
  it('копия из локального режима → облачный аккаунт: доезжает до сервера и устройства B ровно один раз; повторный импорт ничего не плодит', async () => {
    const server = createMemoryServer();
    const json = await makeLocalBackup();
    const a = await openSettings(server);
    const walletsBefore = await a.store.db.wallets.count();

    await chooseFile(json);
    await findByRole('alertdialog', { name: 'Копия из другого аккаунта' });
    await user.click(screen.getByRole('button', { name: 'Загрузить в этот аккаунт' }));
    await waitFor(() => expect(text()).toMatch(/Копия загружена/));
    expect(text()).toMatch(/Добавлено: \d+ · обновлено: \d+/);

    // всё импортированное лежит на сервере
    await eventually(async () => expect((await a.store.sync.counts()).pending).toBe(0), 15_000);
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(4), 15_000);
    expect(server.dump(ALICE.id, 'wallets')).toHaveLength(walletsBefore + 2); // «Наличные» и «Копилка» из копии
    const seqBefore = serverTx(server);

    // второе устройство получает те же данные
    const b = await bare(server, 'dev-b');
    await b.engine.syncNow();
    expect(await sig(b.store)).toBe(await sig(a.store));
    expect(await balancesOf(b.store)).toEqual(await balancesOf(a.store));
    const usd = (await a.store.db.wallets.toArray()).find((w) => w.name === 'Копилка')!;
    // 100,00 − 5,00 + 10,00 = 105,00 $
    expect((await balancesOf(a.store))[usd.id]).toBe(105_00);

    // повторный импорт того же файла
    await chooseFile(json);
    await findByRole('alertdialog', { name: 'Копия из другого аккаунта' });
    await user.click(screen.getByRole('button', { name: 'Загрузить в этот аккаунт' }));
    await waitFor(() => expect(text()).toMatch(/Добавлено: 0 · обновлено: \d+/));
    expect((await a.store.sync.counts()).pending).toBe(0);
    await act(async () => void (await a.engine.syncNow()));
    await b.engine.syncNow();
    expect(serverTx(server)).toEqual(seqBefore); // ни одной новой версии на сервере
    expect(await a.store.db.transactions.count()).toBe(4);
    expect(await b.store.db.transactions.count()).toBe(4);
    expect(await a.store.db.wallets.count()).toBe(walletsBefore + 2);
    b.engine.dispose();
    b.store.close();
  }, 90_000);

  it('собственная копия этого же аккаунта: после правок на B загрузка старой копии на A не откатывает новое и не создаёт дублей', async () => {
    const server = createMemoryServer();
    const a = await openSettings(server);
    const cash = (await a.store.db.wallets.toArray())[0]!;
    await act(async () => {
      await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1000, occurredOn: '2026-10-02', note: 'старая-версия' });
    });
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(1), 15_000);
    const oldBackup = JSON.stringify(await exportBackup(a.store));

    // B правит операцию (и делает новую) уже ПОСЛЕ копии
    const b = await bare(server, 'dev-b');
    await b.engine.syncNow();
    const tx = (await b.store.db.transactions.toArray())[0]!;
    await b.store.transactions.update(tx.id, { amountMinor: 2500, note: 'новая-версия' });
    await b.engine.syncNow();
    await act(async () => void (await a.engine.syncNow()));
    expect((await a.store.db.transactions.get(tx.id))?.note).toBe('новая-версия');

    await chooseFile(oldBackup);
    await findByRole('alertdialog', { name: 'Загрузить копию?' });
    await user.click(screen.getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(text()).toMatch(/Копия загружена/));
    expect(text()).toMatch(/Добавлено: 0 · обновлено: 0/);
    await act(async () => void (await a.engine.syncNow()));
    await b.engine.syncNow();
    for (const s of [a.store, b.store]) {
      const t = await s.db.transactions.get(tx.id);
      expect([t?.amountMinor, t?.note]).toEqual([2500, 'новая-версия']);
      expect(await s.db.transactions.count()).toBe(1);
      expect((await s.sync.counts()).pending).toBe(0);
    }
    expect(server.dump(ALICE.id, 'transactions')[0]?.['note']).toBe('новая-версия');
    b.engine.dispose();
    b.store.close();
  }, 90_000);

  it('копия с более новой версией уже отправленной операции: заменяет её и уходит на сервер', async () => {
    const server = createMemoryServer();
    const a = await openSettings(server);
    const cash = (await a.store.db.wallets.toArray())[0]!;
    const created = await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1000, occurredOn: '2026-10-02', note: 'исходная' });
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(1), 15_000);
    await eventually(async () => expect((await a.store.sync.counts()).pending).toBe(0), 10_000);

    // файл с НОВОЙ версией той же операции (метка из ближайшего будущего: часы устройства её подхватят)
    const backup = await exportBackup(a.store);
    const newer = new Date(Date.now() + 2000).toISOString();
    backup.transactions = backup.transactions.map((t) => ({ ...t, amountMinor: 7777, baseAmountMinor: 7777, note: 'из-файла', clientUpdatedAt: newer, deviceId: 'dev-old-phone' }));
    await chooseFile(JSON.stringify(backup));
    await findByRole('alertdialog', { name: 'Загрузить копию?' });
    await user.click(screen.getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(text()).toMatch(/Копия загружена/));
    expect((await a.store.db.transactions.get(created.id))?.amountMinor).toBe(7777);
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')[0]?.['amount_minor']).toBe(7777), 15_000);
    await eventually(async () => expect((await a.store.sync.counts()).pending).toBe(0), 10_000);
  }, 60_000);

  it('один и тот же файл копии загружен и на телефоне, и на ноутбуке (оба в очереди): на сервере ровно одна версия, устройства сходятся', async () => {
    const server = createMemoryServer();
    const json = await makeLocalBackup();
    const a = await bare(server, 'dev-a');
    const b = await bare(server, 'dev-b');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const { importBackup } = await import('@/db');
    const { withoutSettings } = await import('@/features/settings/backupAccount');
    await importBackup(a.store, withoutSettings(JSON.parse(json)));
    await importBackup(b.store, withoutSettings(JSON.parse(json)));
    await Promise.all([a.engine.syncNow(), b.engine.syncNow()]);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(4);
    expect(new Set(server.dump(ALICE.id, 'transactions').map((r) => r['id'])).size).toBe(4);
    expect(await sig(a.store)).toBe(await sig(b.store));
    expect(await balancesOf(a.store)).toEqual(await balancesOf(b.store));
    expect((await a.store.sync.counts()).pending + (await b.store.sync.counts()).pending).toBe(0);
    a.engine.dispose();
    b.engine.dispose();
  }, 60_000);
});
