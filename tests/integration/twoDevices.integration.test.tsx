/**
 * Атака 1. Два устройства одного человека, ПОЛНЫЙ путь: интерфейс A (настоящее приложение) → репозиторий → очередь →
 * сервер (в памяти, с теми же правилами, что schema.sql) → устройство B (настоящий движок) → интерфейс.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, renderAppRoot, type TestDeps } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { openStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { tapAmount } from '@/features/transactions/__fixtures__/opsKit';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import type { SessionAwareTransport } from '@/sync/session';
import { TransportError } from '@/sync/transport';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

interface Net {
  online: boolean;
}

function throughNet(inner: SessionAwareTransport, net: Net): SessionAwareTransport {
  const gate = () => {
    if (!net.online) throw new TransportError('network', 'Нет сети (тест)');
  };
  return {
    currentUserId: () => inner.currentUserId(),
    async pull(t, a, l) {
      gate();
      return inner.pull(t, a, l);
    },
    async push(t, r) {
      gate();
      return inner.push(t, r);
    },
  };
}

/** Устройство с интерфейсом: своя IndexedDB, свой deviceId, настоящий движок, своя «сеть». */
function uiDevice(server: MemoryServer, deviceId: string) {
  const td: TestDeps = makeTestDeps();
  const net: Net = { online: true };
  const engines: SyncEngine[] = [];
  td.deps.openStore = async (uid) => {
    const store = await openStore(uid, { deviceId, dexie: { indexedDB: td.factory, IDBKeyRange } });
    td.stores.push(store);
    return store;
  };
  td.deps.createTransport = () => throughNet(server.transportFor(ALICE.id), net);
  td.deps.createEngine = (o) => {
    const e = createSyncEngine(o);
    engines.push(e);
    return e;
  };
  return { td, net, engines, client: fakeAuthClient({ session: ALICE }).client };
}

/** Устройство без интерфейса: тот же стек, но действия делаются через репозитории. */
async function bareDevice(server: MemoryServer, deviceId: string) {
  const factory = new IDBFactory();
  const store = await openStore(ALICE.id, { deviceId, dexie: { indexedDB: factory, IDBKeyRange } });
  const net: Net = { online: true };
  const { ensureSeeded } = await import('@/db');
  const engine = createSyncEngine({
    store,
    transport: throughNet(server.transportFor(ALICE.id), net),
    afterFirstPull: async () => void (await ensureSeeded(store)),
  });
  return { store, engine, net };
}

const balancesOf = async (s: Store) => {
  const wallets = (await s.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await s.db.transactions.toArray());
};
const dirtyCount = async (s: Store) => {
  const c = await s.sync.counts();
  return c.pending + c.quarantined;
};
const badge = () => document.body.textContent ?? '';

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openA(server: MemoryServer, path = '/') {
  const a = uiDevice(server, 'dev-a');
  renderAppRoot(<AppRoutes />, { client: a.client, deps: a.td.deps, path });
  await waitFor(() => screen.getByRole('heading', { name: path === '/transactions' ? 'Операции' : 'Главная', level: 1 }), 15_000);
  await waitFor(() => {
    if (a.td.stores.length === 0 || a.engines.length === 0) throw new Error('ещё открывается');
  }, 10_000);
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 10_000);
  return a;
}

describe('атака 1: два устройства, полный путь', () => {
  it('A офлайн (добавил/правил/удалил через интерфейс) + B онлайн → сходятся, остатки равны, без дублей', async () => {
    const server = createMemoryServer();
    const a = await openA(server, '/transactions');
    const storeA = a.td.stores[0] as Store;
    const engineA = a.engines[0] as SyncEngine;
    // дождаться первой синхронизации A (затравка ушла на сервер)
    await waitFor(() => expect(server.dump(ALICE.id, 'wallets')).toHaveLength(1), 10_000);

    const b = await bareDevice(server, 'dev-b');
    await b.engine.syncNow();
    expect((await b.store.db.wallets.toArray()).map((w) => w.name)).toEqual(['Наличные']);

    // --- A теряет сеть ---
    a.net.online = false;
    await act(async () => void (await engineA.syncNow().catch(() => undefined)));

    // добавить операцию через интерфейс
    const addLink = () => screen.getAllByRole('link', { name: /Добавить операцию/ })[0] as HTMLElement;
    await user.click(addLink());
    await findByRole('dialog', { name: 'Новая операция' });
    await tapAmount('100');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'плов');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новая операция' })).toBeNull());

    // второй расход, потом правка суммы первого, потом удаление второго
    await user.click(addLink());
    await findByRole('dialog', { name: 'Новая операция' });
    await tapAmount('7');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'лишнее');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новая операция' })).toBeNull());

    const live = async () => (await storeA.db.transactions.toArray()).filter((t) => t.deletedAt === null);
    await eventually(async () => expect(await live()).toHaveLength(2));
    const plov = (await live()).find((t) => t.note === 'плов');
    const extra = (await live()).find((t) => t.note === 'лишнее');
    expect(plov?.amountMinor).toBe(10_000);
    // честный статус: очередь не пуста — «Синхронизировано» писать нельзя
    await waitFor(() => expect(badge()).toMatch(/Без сети/));
    expect(badge()).not.toMatch(/Синхронизировано/);
    expect(await dirtyCount(storeA)).toBeGreaterThanOrEqual(2);

    await user.click(await waitFor(() => screen.getByText(/плов/)));
    await findByRole('dialog', { name: 'Правка операции' });
    await user.clear(screen.getByRole('textbox', { name: /^Сумма/ }));
    await tapAmount('150');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(async () => expect((await storeA.db.transactions.get(plov!.id))?.amountMinor).toBe(15_000));

    await user.click(await waitFor(() => screen.getByText(/лишнее/)));
    await findByRole('dialog', { name: 'Правка операции' });
    await user.click(screen.getByRole('button', { name: 'Удалить операцию' }));
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Удалить' })));
    await eventually(async () => expect((await storeA.db.transactions.get(extra!.id))?.deletedAt).not.toBeNull());

    // --- B онлайн, пока A без сети: доход и расход, затем правка кошелька ---
    const cash = (await b.store.db.wallets.toArray())[0]!;
    const salary = (await b.store.db.categories.toArray()).find((c) => c.kind === 'income')!;
    await b.store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 500_000, categoryId: salary.id, occurredOn: '2026-10-05', note: 'аванс' });
    await b.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 7_000, occurredOn: '2026-10-06', note: 'такси' });
    await b.engine.syncNow();
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(2); // A ещё ничего не отправил

    // --- A возвращается в сеть ---
    a.net.online = true;
    await act(async () => void (await engineA.syncNow()));
    await b.engine.syncNow();
    await act(async () => void (await engineA.syncNow()));

    const snap = async (s: Store) =>
      (await s.db.transactions.toArray()).map((t) => `${t.id}|${t.amountMinor}|${t.note}|${t.deletedAt === null ? 'live' : 'del'}`).sort();
    expect(await snap(storeA)).toEqual(await snap(b.store));
    expect(await snap(storeA)).toHaveLength(4);
    expect([...(await balancesOf(storeA)).entries()]).toEqual([...(await balancesOf(b.store)).entries()]);
    // 0 + 500000 - 7000 - 15000 = 478000
    expect((await balancesOf(storeA)).get(cash.id)).toBe(478_000);
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(4);
    expect(await dirtyCount(storeA)).toBe(0);
    expect(await dirtyCount(b.store)).toBe(0);
    // интерфейс A показывает чужие операции и больше не показывает «ждёт отправки»
    await waitFor(() => expect(screen.getByText(/аванс/)).toBeInTheDocument());
    await waitFor(() => expect(badge()).toMatch(/Синхронизировано/));
    expect(badge()).not.toMatch(/ждёт отправки/);
    b.engine.dispose();
    b.store.close();
  }, 60_000);

  it('сразу после записи в интерфейсе бейдж не врёт «Синхронизировано», пока очередь не пуста', async () => {
    const server = createMemoryServer();
    const a = await openA(server, '/transactions');
    const storeA = a.td.stores[0] as Store;
    const engineA = a.engines[0] as SyncEngine;
    await waitFor(() => expect(badge()).toMatch(/Синхронизировано/), 10_000);
    const wallet = (await storeA.db.wallets.toArray())[0]!;

    // Запись «со стороны» (как из шита). Движок отправит её по таймеру (~1 с после правки): как только он начнёт цикл, бейдж сам
    // сменится на «Синхронизация…», и ложь, если она была, закончится. Поэтому смотрим, что бейдж показывал МЕЖДУ записью и началом цикла.
    // Раньше это меряли настоящими часами («ложь не дольше 300 мс»), и на загруженной машине тест краснел сам по себе; теперь окно
    // задано порядком событий, а не миллисекундами: к моменту начала отправки бейдж обязан был показать очередь и больше не врать.
    const shown: string[] = [];
    let sending = false;
    const unsubscribe = engineA.subscribe((s) => {
      if (s.phase === 'syncing') sending = true;
    });
    const watcher = new MutationObserver(() => {
      if (!sending) shown.push(badge());
    });
    watcher.observe(document.body, { subtree: true, childList: true, characterData: true });
    try {
      await act(async () => {
        await storeA.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 100, occurredOn: '2026-10-06', note: 'x' });
      });
      if (!sending) shown.push(badge());
      await waitFor(() => {
        if (!sending) throw new Error('движок ещё не начал отправку');
      }, 20_000);
    } finally {
      watcher.disconnect();
      unsubscribe();
    }

    const honest = (t: string) => !/Синхронизировано/.test(t);
    // На загруженной машине сама запись занимает дольше секунды: движок успевает начать отправку ДО первого снимка бейджа. Тогда
    // окна «между записью и началом отправки» не было вовсе и проверять нечего (раньше тест краснел от одной нагрузки).
    if (shown.length === 0) return;
    const firstHonest = shown.findIndex(honest);
    const trace = shown.map((t, i) => `${i}: ${honest(t) ? 'очередь показана' : 'Синхронизировано'}`).join(' | ');
    expect(firstHonest, `до начала отправки бейдж так и не показал очередь, хотя запись не отправлена: ${trace}`).toBeGreaterThanOrEqual(0);
    expect(shown.slice(firstHonest).every(honest), `бейдж показал очередь, а потом снова соврал «Синхронизировано» до отправки: ${trace}`).toBe(true);
  }, 40_000);
});
