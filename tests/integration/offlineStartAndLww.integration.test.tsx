/**
 * Два стыка: (1) запуск приложения без сети у человека, который уже входил («offline-known») → сеть вернулась без перезапуска сеанса;
 * (2) правки РАЗНЫХ полей одной записи на двух устройствах офлайн.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { act, screen, waitFor } from '@/components/testUtils';
import { ensureSeeded, openStore, type Store } from '@/db';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const text = () => document.body.textContent ?? '';

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('запуск без сети у человека, который уже входил', () => {
  it('данные открываются, статус «Без сети», запись уходит в очередь; когда сессия подтвердилась — сеанс не перезапускается, очередь уходит на сервер', async () => {
    const server = createMemoryServer();
    const net = { online: true };
    const td = makeTestDeps();
    const engines: SyncEngine[] = [];
    td.deps.openStore = async (uid) => {
      const s = await openStore(uid, { deviceId: 'dev-a', dexie: { indexedDB: td.factory, IDBKeyRange } });
      td.stores.push(s);
      return s;
    };
    td.deps.createTransport = () => {
      const inner = server.transportFor(ALICE.id);
      return {
        currentUserId: () => inner.currentUserId(),
        pull: async (t, a, l) => (net.online ? inner.pull(t, a, l) : Promise.reject(new TransportError('network', 'нет сети'))),
        push: async (t, r) => (net.online ? inner.push(t, r) : Promise.reject(new TransportError('network', 'нет сети'))),
      } as typeof inner;
    };
    td.deps.createEngine = (o) => {
      const e = createSyncEngine(o);
      engines.push(e);
      return e;
    };

    // первый сеанс — онлайн: первая загрузка и затравка
    const online = fakeAuthClient({ session: ALICE });
    const first = renderAppRoot(<AppRoutes />, { client: online.client, deps: td.deps, path: '/' });
    await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);
    first.unmount();
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));

    // второй сеанс — без сети: getSession не отвечает сетью
    net.online = false;
    const offline = fakeAuthClient({ session: ALICE, getSession: 'network' });
    td.stores.length = 0;
    renderAppRoot(<AppRoutes />, { client: offline.client, deps: td.deps, path: '/' });
    await waitFor(() => screen.getByRole('heading', { name: 'Главная', level: 1 }), 15_000);
    const store = (await waitFor(() => td.stores[0] ?? Promise.reject(new Error('нет базы')))) as Store;
    const cash = (await store.db.wallets.toArray())[0]!;
    await act(async () => void (await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 700, occurredOn: '2026-10-05', note: 'в-метро' })));
    await waitFor(() => expect(text()).toMatch(/Без сети · 1 запись в очереди/), 10_000);
    expect(text()).not.toMatch(/Синхронизировано/);

    // сеть вернулась, сессия подтвердилась позже (событие от клиента входа)
    net.online = true;
    const storesBefore = td.stores.length;
    await act(async () => {
      offline.emit('SIGNED_IN', ALICE);
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 50));
    });
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(1), 15_000);
    expect(td.stores.length, 'сеанс перезапущен: база открыта заново').toBe(storesBefore);
    await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 10_000);
  }, 60_000);
});

describe('правки РАЗНЫХ полей одной операции на двух устройствах офлайн', () => {
  // Находка F6: сервер хранит запись целиком с одной меткой, поэтому раньше побеждала версия «целиком», и вторая правка молча
  // пропадала. Теперь правки разных ГРУПП полей объединяются на клиенте (src/db/mergeGroups.ts, syncMerge.ts): сервер и схема
  // прежние, объединённая запись получает новую метку и едет на сервер как обычная правка.
  //
  // Проверяем в обе стороны: кто синхронизируется первым (A с суммой или B с заметкой).
  const orders = [
    { name: 'A синхронизируется первым', first: 'a' },
    { name: 'B синхронизируется первым', first: 'b' },
  ] as const;

  it.each(orders)('A исправил сумму, B позже поправил заметку ($name): обе правки на обоих устройствах и на сервере', async ({ first }) => {
    const server = createMemoryServer();
    const mk = async (id: string) => {
      const store = await openStore(ALICE.id, { deviceId: id, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
      const engine = createSyncEngine({ store, transport: server.transportFor(ALICE.id), afterFirstPull: async () => void (await ensureSeeded(store)) });
      return { store, engine };
    };
    const a = await mk('dev-a');
    await a.engine.syncNow();
    const b = await mk('dev-b');
    await b.engine.syncNow();
    const cash = (await a.store.db.wallets.toArray())[0]!;
    const tx = await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100_00, occurredOn: '2026-10-05', note: 'такси' });
    await a.engine.syncNow();
    await b.engine.syncNow();

    // оба офлайн: A правит СУММУ (опечатка в нуле), позже B правит только ЗАМЕТКУ
    await a.store.transactions.update(tx.id, { amountMinor: 10_00 });
    await new Promise((r) => setTimeout(r, 5));
    await b.store.transactions.update(tx.id, { note: 'такси из аэропорта' });
    const order = first === 'a' ? [a, b] : [b, a];
    for (let i = 0; i < 2; i++) for (const d of order) await d.engine.syncNow();

    const ra = (await a.store.db.transactions.get(tx.id))!;
    const rb = (await b.store.db.transactions.get(tx.id))!;
    expect([ra.amountMinor, ra.note]).toEqual([rb.amountMinor, rb.note]);
    expect([ra.amountMinor, ra.note], 'одна из правок потеряна при слиянии разных частей записи').toEqual([10_00, 'такси из аэропорта']);
    expect(ra.baseAmountMinor).toBe(10_00); // снимок базовой валюты едет вместе с суммой
    const onServer = server.dump(ALICE.id, 'transactions').find((r) => r['id'] === tx.id)!;
    expect([onServer['amount_minor'], onServer['note'], onServer['base_amount_minor']]).toEqual([10_00, 'такси из аэропорта', 10_00]);
    for (const d of [a, b]) expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0, lastError: null });
    for (const r of [ra, rb]) {
      expect(r.dirty).toBe(0);
      expect('dirtyGroups' in r).toBe(false);
    }
  }, 30_000);

  it('сумма на A, заметка и дата на B, имя кошелька на C: всё складывается из трёх офлайн-устройств', async () => {
    const server = createMemoryServer();
    const mk = async (id: string) => {
      const store = await openStore(ALICE.id, { deviceId: id, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
      const engine = createSyncEngine({ store, transport: server.transportFor(ALICE.id), afterFirstPull: async () => void (await ensureSeeded(store)) });
      return { store, engine };
    };
    const [a, b, c] = [await mk('dev-a'), await mk('dev-b'), await mk('dev-c')] as const;
    for (const d of [a, b, c]) await d.engine.syncNow();
    const cash = (await a.store.db.wallets.toArray())[0]!;
    const tx = await a.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500_00, occurredOn: '2026-10-05', note: 'плов' });
    for (const d of [a, b, c]) await d.engine.syncNow();

    await a.store.transactions.update(tx.id, { amountMinor: 50_00 });
    await b.store.transactions.update(tx.id, { note: 'плов с чаем', occurredOn: '2026-10-06' });
    await c.store.wallets.update(cash.id, { name: 'Кошелёк C' });
    for (let i = 0; i < 3; i++) for (const d of [c, a, b]) await d.engine.syncNow();

    for (const d of [a, b, c]) {
      expect(await d.store.db.transactions.get(tx.id), d.store.deviceId).toMatchObject({ amountMinor: 50_00, note: 'плов с чаем', occurredOn: '2026-10-06', dirty: 0 });
      expect((await d.store.db.wallets.get(cash.id))?.name, d.store.deviceId).toBe('Кошелёк C');
    }
    expect(server.dump(ALICE.id, 'transactions').find((r) => r['id'] === tx.id)).toMatchObject({ amount_minor: 50_00, note: 'плов с чаем', occurred_on: '2026-10-06' });
  }, 30_000);
});
