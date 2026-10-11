/**
 * Вторая вкладка записала операцию в ту же базу (у неё свой хранилище, и её движок ничего не отправил — закрыта сразу
 * после записи или без сети). Первая вкладка не должна продолжать писать «Синхронизировано», пока в базе есть неотправленное.
 */
import { IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { screen, waitFor } from '@/components/testUtils';
import { openStore, type Store } from '@/db';
import { createSyncEngine } from '@/sync/engine';
import { createMemoryServer } from '@/sync/memoryServer';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const text = () => document.body.textContent ?? '';

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('соседняя вкладка того же устройства', () => {
  it('запись из другой вкладки видна в интерфейсе первой, а её бейдж не говорит «Синхронизировано», пока запись не отправлена', async () => {
    const server = createMemoryServer();
    const td = makeTestDeps();
    const dexie = { indexedDB: td.factory, IDBKeyRange };
    td.deps.openStore = async (uid) => {
      const s = await openStore(uid, { deviceId: 'dev-phone', dexie });
      td.stores.push(s);
      return s;
    };
    td.deps.createTransport = () => server.transportFor(ALICE.id);
    td.deps.createEngine = (o) => createSyncEngine(o);
    renderAppRoot(<AppRoutes />, { client: fakeAuthClient({ session: ALICE }).client, deps: td.deps, path: '/transactions' });
    await waitFor(() => screen.getByRole('heading', { name: 'Операции', level: 1 }), 15_000);
    await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);

    // вторая вкладка: своё хранилище на той же базе, без движка (не отправляет)
    const tab2: Store = await openStore(ALICE.id, { deviceId: 'dev-phone', dexie });
    const cash = (await tab2.db.wallets.toArray())[0]!;
    await tab2.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1500, occurredOn: new Date().toISOString().slice(0, 10), note: 'из-второй-вкладки' });

    // интерфейс первой вкладки обновился сам
    await waitFor(() => expect(text()).toMatch(/из-второй-вкладки/), 15_000);
    // Движок первой вкладки о чужой записи не знает и сам её не отправит (его ближайший цикл — по интервалу в минуту), поэтому честно
    // показать очередь бейдж может только по базе. Ждём не «300 мс» (на загруженной машине это мало), а самого события: бейдж обязан
    // перестать говорить «Синхронизировано», пока запись не отправлена. Если он так и не перестанет — тест упадёт по сроку ожидания.
    await waitFor(() => expect(text(), 'бейдж первой вкладки: «Синхронизировано», а в базе есть неотправленная запись соседней вкладки').not.toMatch(/Синхронизировано/), 15_000);
    expect((await tab2.sync.counts()).pending, 'запись соседней вкладки действительно ещё не отправлена').toBeGreaterThan(0);
    tab2.close();
  }, 40_000);
});
