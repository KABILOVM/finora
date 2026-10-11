/**
 * Стык «локальный режим → облако»: человек вёл учёт без входа, потом владелец подключил облако (две переменные + пересборка).
 * Приложение открывает базу ВОШЕДШЕГО пользователя; база локального режима осталась на устройстве, но интерфейс её больше не открывает.
 */
import { IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { LOCAL_USER_ID } from '@/auth/config';
import { screen, waitFor } from '@/components/testUtils';
import { ensureSeeded, openStore } from '@/db';
import { createSyncEngine } from '@/sync/engine';
import { createMemoryServer } from '@/sync/memoryServer';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('переключение режима: локальные данные на устройстве', () => {
  it('на устройстве есть недели учёта без входа; после подключения облака интерфейс сообщает об этом или предлагает перенос (иначе данные «пропали» молча)', async () => {
    const td = makeTestDeps();
    const dexie = { indexedDB: td.factory, IDBKeyRange };
    // «до облака»: настоящий локальный пользователь устройства
    const local = await openStore(LOCAL_USER_ID, { deviceId: 'device-test-1', dexie });
    await ensureSeeded(local);
    const cash = (await local.db.wallets.toArray())[0]!;
    for (let i = 0; i < 30; i++) {
      await local.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1000 + i, occurredOn: '2026-10-01', note: `недели-учёта-${i}` });
    }
    local.close();

    // «после»: тот же браузер, та же IndexedDB, облако подключено, человек входит
    const server = createMemoryServer();
    td.deps.createTransport = () => server.transportFor(ALICE.id);
    td.deps.createEngine = (o) => createSyncEngine(o);
    renderAppRoot(<AppRoutes />, { client: fakeAuthClient({ session: ALICE }).client, deps: td.deps, path: '/' });
    await waitFor(() => screen.getByRole('heading', { name: 'Главная', level: 1 }), 15_000);
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 10_000);

    const homeText = document.body.textContent ?? '';
    // данные локального режима физически на месте
    const still = await openStore(LOCAL_USER_ID, { deviceId: 'device-test-1', dexie });
    expect(await still.db.transactions.count()).toBe(30);
    still.close();
    // но в облачном аккаунте их нет, а человеку об этом не сказано ни словом
    expect(td.stores.length).toBe(1);
    expect(await td.stores[0]!.db.transactions.count()).toBe(0);
    expect(homeText, 'на устройстве остались 30 операций локального режима; ни плашки, ни предложения перенести их').toMatch(/локальн|перенес|перенос|без входа/i);
  }, 40_000);
});
