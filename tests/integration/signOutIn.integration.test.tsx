/**
 * Атака 2. Выход / вход на одном устройстве: тот же и другой пользователь. Неотправленное не теряется и не уходит
 * в чужой аккаунт; «Выйти и удалить данные» не стирает неотправленное. Настоящее приложение + настоящий движок.
 */
import { IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, BOB, eventually, fakeAuthClient, makeTestDeps, renderAppRoot, type TestDeps } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { FinoraDB, openStore, type Store } from '@/db';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import type { SessionAwareTransport } from '@/sync/session';
import { TransportError } from '@/sync/transport';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

type Auth = ReturnType<typeof fakeAuthClient>;

/** Транспорт, который берёт пользователя из «общей сессии браузера» (как supabase-js): кто сейчас вошёл — тот и пишет. */
function sessionFollowing(server: MemoryServer, auth: Auth, net: { online: boolean }): SessionAwareTransport {
  const target = () => {
    if (!net.online) throw new TransportError('network', 'Нет сети (тест)');
    const u = auth.current;
    if (!u) throw new TransportError('auth', 'Нет сессии');
    return server.transportFor(u.id);
  };
  return {
    currentUserId: async () => auth.current?.id ?? null,
    pull: async (t, a, l) => target().pull(t, a, l),
    push: async (t, r) => target().push(t, r),
  };
}

function setup(server: MemoryServer, session: typeof ALICE | null = ALICE) {
  const td: TestDeps = makeTestDeps();
  const net = { online: true };
  const auth = fakeAuthClient({ session });
  const engines: SyncEngine[] = [];
  const stores: Store[] = [];
  td.deps.openStore = async (uid) => {
    const s = await openStore(uid, { deviceId: 'dev-one', dexie: { indexedDB: td.factory, IDBKeyRange } });
    stores.push(s);
    return s;
  };
  td.deps.createTransport = () => sessionFollowing(server, auth, net);
  td.deps.createEngine = (o) => {
    const e = createSyncEngine(o);
    engines.push(e);
    return e;
  };
  td.deps.deleteLocalData = async (uid) => {
    td.deleted.push(uid);
    await new FinoraDB(uid, { indexedDB: td.factory, IDBKeyRange }).delete();
  };
  return { td, net, auth, engines, stores };
}

const text = () => document.body.textContent ?? '';
const liveStore = (s: { stores: Store[] }) => s.stores[s.stores.length - 1] as Store;

async function untilSynced(s: ReturnType<typeof setup>) {
  await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);
  await eventually(async () => expect((await liveStore(s).sync.counts()).pending).toBe(0), 10_000);
}

async function login(email: string, password: string) {
  await waitFor(() => screen.getByRole('heading', { name: 'Вход' }), 5000);
  await user.type(screen.getByRole('textbox', { name: /Почта/ }), email);
  await user.type(document.querySelector<HTMLInputElement>('input[type="password"]')!, password);
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}

async function addNote(store: Store, note: string, amountMinor = 4200) {
  const w = (await store.db.wallets.toArray())[0]!;
  await act(async () => {
    await store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor, occurredOn: '2026-10-06', note });
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('атака 2: выход и вход', () => {
  it('выход с неотправленной записью → вход ДРУГИМ пользователем: данные не смешались, запись не ушла в чужой аккаунт; вернулись тем же — запись цела и уходит', async () => {
    const server = createMemoryServer();
    const s = setup(server);
    renderAppRoot(<AppRoutes />, { client: s.auth.client, deps: s.td.deps, path: '/settings' });
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await untilSynced(s);

    // сеть пропала, человек записал расход
    s.net.online = false;
    await addNote(liveStore(s), 'секрет-Алисы');
    await eventually(async () => expect((await liveStore(s).sync.counts()).pending).toBe(1));
    await waitFor(() => expect(text()).toMatch(/Выйти и стереть данные/));
    await waitFor(() => expect(screen.getByRole('button', { name: /Выйти и стереть данные/ })).toBeDisabled());

    // «Выйти» → предупреждение; «Отмена» оставляет в аккаунте
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await findByRole('alertdialog', { name: 'Не всё отправлено в облако' });
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(s.auth.current?.id).toBe(ALICE.id);

    // «Выйти и удалить» заблокирована, а прямое нажатие ничего не удаляет
    await user.click(screen.getByRole('button', { name: /Выйти и стереть данные/ }));
    expect(s.td.deleted).toEqual([]);

    // Всё равно выйти
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await findByRole('alertdialog', { name: 'Не всё отправлено в облако' });
    await user.click(screen.getByRole('button', { name: 'Всё равно выйти' }));
    // сеть вернулась до входа Боба (иначе его «первая загрузка» ждала бы интернет)
    s.net.online = true;
    await login(BOB.email, BOB.password);
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await untilSynced(s);

    const bobStore = liveStore(s);
    expect(bobStore.userId).toBe(BOB.id);
    expect((await bobStore.db.transactions.toArray()).map((t) => t.note)).not.toContain('секрет-Алисы');
    await act(async () => void (await (s.engines[s.engines.length - 1] as SyncEngine).syncNow()));
    expect(server.dump(BOB.id, 'transactions')).toHaveLength(0);
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(0);
    // у Боба свои настройки/кошелёк с id, выведенными от ЕГО userId
    expect(server.dump(BOB.id, 'wallets')).toHaveLength(1);

    // Боб выходит, Алиса входит обратно
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await login(ALICE.email, ALICE.password);
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await waitFor(() => expect(liveStore(s).userId).toBe(ALICE.id));
    await eventually(async () => expect((await server.dump(ALICE.id, 'transactions')).map((r) => r['note'])).toEqual(['секрет-Алисы']), 15_000);
    expect(server.dump(BOB.id, 'transactions')).toHaveLength(0);
    await untilSynced(s);
    expect((await liveStore(s).db.transactions.toArray()).map((t) => t.note)).toEqual(['секрет-Алисы']);
  }, 90_000);

  it('«Выйти и удалить данные»: всё отправлено → база стёрта, при входе данные возвращаются с сервера без дублей', async () => {
    const server = createMemoryServer();
    const s = setup(server);
    renderAppRoot(<AppRoutes />, { client: s.auth.client, deps: s.td.deps, path: '/settings' });
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await untilSynced(s);
    await addNote(liveStore(s), 'уже-в-облаке');
    await eventually(async () => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(1), 15_000);
    await untilSynced(s);
    const walletsBefore = server.dump(ALICE.id, 'wallets').length;
    const catsBefore = server.dump(ALICE.id, 'categories').length;

    await waitFor(() => expect(screen.getByRole('button', { name: /Выйти и стереть данные/ })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: /Выйти и стереть данные/ }));
    await findByRole('alertdialog', { name: 'Удалить данные с этого устройства?' });
    await user.click(screen.getByRole('button', { name: 'Выйти и удалить' }));
    await waitFor(() => expect(s.td.deleted).toEqual([ALICE.id]));
    await waitFor(() => screen.getByRole('heading', { name: 'Вход' }));
    const names = await indexedDB.databases();
    expect(names.map((d) => d.name)).not.toContain(`finora-v1-${ALICE.id}`);

    await login(ALICE.email, ALICE.password);
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await untilSynced(s);
    const st = liveStore(s);
    expect((await st.db.transactions.toArray()).map((t) => t.note)).toEqual(['уже-в-облаке']);
    expect(server.dump(ALICE.id, 'wallets')).toHaveLength(walletsBefore);
    expect(server.dump(ALICE.id, 'categories')).toHaveLength(catsBefore);
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(1);
    expect((await st.db.wallets.toArray()).length).toBe(walletsBefore);
  }, 90_000);

  it('запись сделана в тот миг, когда открыт диалог «Выйти и удалить»: перед удалением данные перепроверяются', async () => {
    const server = createMemoryServer();
    const s = setup(server);
    renderAppRoot(<AppRoutes />, { client: s.auth.client, deps: s.td.deps, path: '/settings' });
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await untilSynced(s);
    await waitFor(() => expect(screen.getByRole('button', { name: /Выйти и стереть данные/ })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: /Выйти и стереть данные/ }));
    await findByRole('alertdialog', { name: 'Удалить данные с этого устройства?' });
    // пока диалог открыт, «в фоне» появилась запись (например, из другой вкладки)
    s.net.online = false;
    await addNote(liveStore(s), 'свежая-запись');
    await user.click(screen.getByRole('button', { name: 'Выйти и удалить' }));
    await act(async () => void (await new Promise((r) => setTimeout(r, 300))));
    expect(s.td.deleted).toEqual([]);
    expect(s.auth.current?.id).toBe(ALICE.id);
    expect((await liveStore(s).db.transactions.toArray()).map((t) => t.note)).toEqual(['свежая-запись']);
  }, 60_000);

  it('другая вкладка вошла под Бобом, пока вкладка Алисы открыта: данные Алисы в аккаунт Боба НЕ уходят, у Боба Алисиных данных нет', async () => {
    const server = createMemoryServer();
    const s = setup(server);
    renderAppRoot(<AppRoutes />, { client: s.auth.client, deps: s.td.deps, path: '/settings' });
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await untilSynced(s);
    s.net.online = false;
    await addNote(liveStore(s), 'только-Алисе');
    // «другая вкладка»: общая сессия браузера теперь принадлежит Бобу, события нашей вкладке не дошли
    s.auth.setSession(BOB);
    s.net.online = true;
    await act(async () => void (await (s.engines[0] as SyncEngine).syncNow()));
    expect(server.dump(BOB.id, 'transactions')).toHaveLength(0);
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(0);
    await waitFor(() => expect(text()).toMatch(/Нужен вход/));
    expect((await liveStore(s).sync.counts()).pending).toBe(1);
    expect(text()).not.toMatch(/Синхронизировано/);
  }, 60_000);
});
