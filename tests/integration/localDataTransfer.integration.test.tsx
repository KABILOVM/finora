/**
 * Перенос записей локального режима (учёт без входа) в аккаунт после подключения облака: плашка на «Главной», кнопка переноса,
 * записи доезжают до сервера один раз, стартовые категории не двоятся, отказ запоминается.
 */
import { IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, renderAppRoot, type TestDeps } from '@/app/testkit';
import { LOCAL_USER_ID } from '@/auth/config';
import { screen, user, waitFor } from '@/components/testUtils';
import { ensureSeeded, openStore } from '@/db';
import { createSyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const text = () => document.body.textContent ?? '';

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Устройство, на котором вели учёт без входа (30 операций, один свой кошелёк и одна своя категория). */
async function localDevice(td: TestDeps) {
  const local = await openStore(LOCAL_USER_ID, { deviceId: 'device-test-1', dexie: { indexedDB: td.factory, IDBKeyRange } });
  await ensureSeeded(local);
  const cash = (await local.db.wallets.toArray())[0]!;
  const food = (await local.db.categories.toArray()).find((c) => c.name === 'Еда')!;
  const jar = await local.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#2563eb', icon: '💰' });
  for (let i = 0; i < 30; i++) {
    await local.transactions.create({ kind: 'expense', walletId: i % 2 ? cash.id : jar.id, amountMinor: 1000 + i, categoryId: food.id, occurredOn: '2026-10-01', note: `недели-учёта-${i}` });
  }
  local.close();
}

function cloudDeps(td: TestDeps, server: MemoryServer) {
  td.deps.openStore = async (uid) => {
    const s = await openStore(uid, { deviceId: 'device-test-1', dexie: { indexedDB: td.factory, IDBKeyRange } });
    td.stores.push(s);
    return s;
  };
  td.deps.createTransport = () => server.transportFor(ALICE.id);
  td.deps.createEngine = (o) => createSyncEngine(o);
}

async function openHome(td: TestDeps) {
  renderAppRoot(<AppRoutes />, { client: fakeAuthClient({ session: ALICE }).client, deps: td.deps, path: '/' });
  await waitFor(() => screen.getByRole('heading', { name: 'Главная', level: 1 }), 15_000);
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 10_000);
}

describe('перенос записей локального режима в аккаунт', () => {
  it('плашка предлагает перенос; после него записи в аккаунте и на сервере ровно один раз, стартовые категории не двоятся', async () => {
    const td = makeTestDeps();
    const server = createMemoryServer();
    await localDevice(td);
    cloudDeps(td, server);
    await openHome(td);

    expect(text()).toMatch(/Есть записи, сделанные без входа \(31 запись\)/); // 30 операций и «Копилка»
    await user.click(screen.getByRole('button', { name: 'Перенести в аккаунт' }));
    await waitFor(() => expect(text()).toMatch(/Записи, сделанные без входа, перенесены в аккаунт/), 15_000);

    const account = td.stores.find((s) => s.userId === ALICE.id)!;
    expect(await account.db.transactions.count()).toBe(30);
    expect((await account.db.wallets.toArray()).map((w) => w.name).sort()).toEqual(['Копилка', 'Наличные']);
    expect(await account.db.categories.count()).toBe(17); // «Еда» из локального режима слилась со своей, а не удвоилась
    await eventually(async () => expect((await account.sync.counts()).pending).toBe(0), 15_000);
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(30), 15_000);
    expect(server.dump(ALICE.id, 'categories')).toHaveLength(17);

    // локальная база не тронута
    const local = await openStore(LOCAL_USER_ID, { deviceId: 'device-test-1', dexie: { indexedDB: td.factory, IDBKeyRange } });
    expect(await local.db.transactions.count()).toBe(30);
    local.close();
  }, 60_000);

  it('после переноса при следующем запуске плашки нет; повторный перенос ничего не плодит', async () => {
    const td = makeTestDeps();
    const server = createMemoryServer();
    await localDevice(td);
    cloudDeps(td, server);
    const first = renderAppRootFor(td);
    await waitFor(() => screen.getByRole('button', { name: 'Перенести в аккаунт' }), 15_000);
    await user.click(screen.getByRole('button', { name: 'Перенести в аккаунт' }));
    await waitFor(() => expect(text()).toMatch(/перенесены в аккаунт/), 15_000);
    first.unmount();

    renderAppRootFor(td);
    await waitFor(() => screen.getByRole('heading', { name: 'Главная', level: 1 }), 15_000);
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 10_000);
    expect(text()).not.toMatch(/сделанные без входа/);
  }, 60_000);

  it('«Не переносить»: плашка исчезает и не возвращается; в аккаунт ничего не попало', async () => {
    const td = makeTestDeps();
    const server = createMemoryServer();
    await localDevice(td);
    cloudDeps(td, server);
    const first = renderAppRootFor(td);
    await waitFor(() => screen.getByRole('button', { name: 'Не переносить' }), 15_000);
    await user.click(screen.getByRole('button', { name: 'Не переносить' }));
    await waitFor(() => expect(text()).not.toMatch(/сделанные без входа/));
    const account = td.stores.find((s) => s.userId === ALICE.id)!;
    expect(await account.db.transactions.count()).toBe(0);
    first.unmount();

    renderAppRootFor(td);
    await waitFor(() => screen.getByRole('heading', { name: 'Главная', level: 1 }), 15_000);
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 10_000);
    expect(text()).not.toMatch(/сделанные без входа/);
  }, 60_000);

  it('перенос не удался: понятное сообщение, в аккаунте ничего не изменилось, плашка остаётся и перенос можно повторить', async () => {
    const td = makeTestDeps();
    const server = createMemoryServer();
    await localDevice(td);
    cloudDeps(td, server);
    const realOpen = td.deps.openStore;
    let broken = true;
    td.deps.openStore = async (uid) => {
      if (uid === LOCAL_USER_ID && broken) throw new Error('IDB упал');
      return realOpen(uid);
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openHome(td);
    await user.click(screen.getByRole('button', { name: 'Перенести в аккаунт' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось перенести записи'), 10_000);
    const account = td.stores.find((s) => s.userId === ALICE.id)!;
    expect(await account.db.transactions.count()).toBe(0);
    expect(text()).toMatch(/Есть записи, сделанные без входа/);

    broken = false;
    await user.click(screen.getByRole('button', { name: 'Перенести в аккаунт' }));
    await waitFor(() => expect(text()).toMatch(/перенесены в аккаунт/), 15_000);
    expect(await account.db.transactions.count()).toBe(30);
  }, 60_000);

  it('учёта без входа не было: плашки нет, пустая локальная база не создаётся', async () => {
    const td = makeTestDeps();
    cloudDeps(td, createMemoryServer());
    await openHome(td);
    expect(text()).not.toMatch(/сделанные без входа/);
    const names = await (td.factory as unknown as { databases(): Promise<{ name: string }[]> }).databases();
    expect(names.map((d) => d.name).filter((n) => n.includes(LOCAL_USER_ID))).toEqual([]);
  }, 40_000);
});

function renderAppRootFor(td: TestDeps) {
  return renderAppRoot(<AppRoutes />, { client: fakeAuthClient({ session: ALICE }).client, deps: td.deps, path: '/' });
}
