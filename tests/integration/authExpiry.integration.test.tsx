/**
 * Атака 6. Истечение токена посреди синхронизации (401): обновление сессии и повтор; «нужен вход» и возврат без потери очереди.
 * Настоящее приложение + настоящий движок + сервер в памяти.
 */
import { IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { newId, openStore, type Store } from '@/db';
import type { LocalRow, Transaction } from '@/domain/types';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import type { SessionAwareTransport } from '@/sync/session';
import type { SyncTableName } from '@/sync/tables';
import { TransportError } from '@/sync/transport';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const text = () => document.body.textContent ?? '';

interface Ctl {
  /** Токен «жив»: пока false, любой запрос получает 401. */
  tokenOk: boolean;
  /** Протухнуть на N-м push (считая с 1) к таблице. */
  expireOnPush?: { table: SyncTableName; nth: number };
  pushes: Array<{ table: SyncTableName; rows: number; ok: boolean }>;
  /** Умеет ли «обновление сессии» вернуть рабочий токен. */
  refreshWorks?: boolean;
}

function transportWith(server: MemoryServer, ctl: Ctl): SessionAwareTransport {
  const inner = server.transportFor(ALICE.id);
  const seen: Record<string, number> = {};
  return {
    currentUserId: async () => (ctl.tokenOk ? ALICE.id : undefined),
    async pull(t, a, l) {
      if (!ctl.tokenOk) throw new TransportError('auth', 'JWT expired', 'PGRST301');
      return inner.pull(t, a, l);
    },
    async push(t, r) {
      seen[t] = (seen[t] ?? 0) + 1;
      if (ctl.expireOnPush && ctl.expireOnPush.table === t && ctl.expireOnPush.nth === seen[t]) {
        ctl.tokenOk = false;
        delete ctl.expireOnPush;
      }
      if (!ctl.tokenOk) {
        ctl.pushes.push({ table: t, rows: r.length, ok: false });
        throw new TransportError('auth', 'JWT expired', 'PGRST301');
      }
      await inner.push(t, r);
      ctl.pushes.push({ table: t, rows: r.length, ok: true });
    },
  };
}

function setup(server: MemoryServer) {
  const td = makeTestDeps();
  const ctl: Ctl = { tokenOk: true, pushes: [] };
  const auth = fakeAuthClient({ session: ALICE });
  const engines: SyncEngine[] = [];
  const refresh = vi.fn(async () => {
    // как supabase-js: если refresh-токен жив — новый токен; тут «жив», пока человек не вышел
    if (ctl.refreshWorks) ctl.tokenOk = true;
    return { data: { session: ctl.refreshWorks ? { user: { id: ALICE.id } } : null, user: null }, error: ctl.refreshWorks ? null : new Error('refresh_token_not_found') };
  });
  (auth.client.auth as unknown as { refreshSession: unknown }).refreshSession = refresh;
  td.deps.openStore = async (uid) => {
    const s = await openStore(uid, { deviceId: 'dev-a', dexie: { indexedDB: td.factory, IDBKeyRange } });
    td.stores.push(s);
    return s;
  };
  td.deps.createTransport = () => transportWith(server, ctl);
  td.deps.createEngine = (o) => {
    const e = createSyncEngine(o);
    engines.push(e);
    return e;
  };
  return { td, ctl, auth, engines, refresh };
}
async function open(server: MemoryServer, refreshWorks: boolean) {
  const s = setup(server);
  s.ctl.refreshWorks = refreshWorks;
  renderAppRoot(<AppRoutes />, { client: s.auth.client, deps: s.td.deps, path: '/settings' });
  await waitFor(() => screen.getByRole('heading', { name: 'Настройки', level: 1 }), 15_000);
  await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);
  return { ...s, store: s.td.stores[0] as Store, engine: s.engines[0] as SyncEngine };
}

async function manyTx(store: Store, n: number, tag: string) {
  const wallet = (await store.db.wallets.toArray())[0]!;
  const base = await store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 100, occurredOn: '2026-10-01', note: `${tag}-0` });
  const rows: LocalRow<Transaction>[] = Array.from({ length: n - 1 }, (_, i) => ({
    ...base,
    id: newId(),
    note: `${tag}-${i + 1}`,
    clientUpdatedAt: new Date(Date.parse(base.clientUpdatedAt) + i + 1).toISOString(),
  }));
  await store.db.transactions.bulkPut(rows);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('атака 6: токен истёк посреди синхронизации', () => {
  it('401 на второй пачке операций: сессия обновляется один раз, цикл повторяется, на сервере все операции ровно по разу', async () => {
    const server = createMemoryServer();
    const a = await open(server, true);
    await act(async () => void (await manyTx(a.store, 260, 'п')));
    a.ctl.expireOnPush = { table: 'transactions', nth: 2 };
    await act(async () => void (await a.engine.syncNow()));
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(260), 20_000);
    expect(a.refresh).toHaveBeenCalledTimes(1);
    expect(a.ctl.pushes.filter((p) => !p.ok)).toHaveLength(1);
    expect(new Set(server.dump(ALICE.id, 'transactions').map((r) => r['id'])).size).toBe(260);
    await eventually(async () => expect((await a.store.sync.counts()).pending).toBe(0));
    await waitFor(() => expect(text()).toMatch(/Синхронизировано/));
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0, lastError: null });
  }, 90_000);

  it('сессию обновить нельзя: «Нужен вход», очередь цела и растёт; после повторного входа всё уходит, без дублей', async () => {
    const server = createMemoryServer();
    const a = await open(server, false);
    await act(async () => void (await manyTx(a.store, 230, 'в')));
    a.ctl.expireOnPush = { table: 'transactions', nth: 2 };
    await act(async () => void (await a.engine.syncNow()));
    await waitFor(() => expect(text()).toMatch(/Нужен вход/));
    expect(a.engine.getStatus().phase).toBe('auth-required');
    expect(text()).not.toMatch(/Синхронизировано/);
    const serverNow = server.dump(ALICE.id, 'transactions').length;
    expect(serverNow).toBeLessThan(230);
    const pending = (await a.store.sync.counts()).pending;
    expect(pending + serverNow).toBe(230);
    // пока нужен вход, человек продолжает вносить записи — они копятся в очереди и не пропадают
    const wal = (await a.store.db.wallets.toArray())[0]!;
    for (const n of ['пока-1', 'пока-2']) {
      await act(async () => void (await a.store.transactions.create({ kind: 'expense', walletId: wal.id, amountMinor: 500, occurredOn: '2026-10-02', note: n })));
    }
    expect((await a.store.sync.counts()).pending).toBe(pending + 2);
    await waitFor(() => expect(text()).toMatch(new RegExp(`Нужен вход · ${pending + 2} `)));

    // «Войти заново» → экран входа → вход тем же пользователем
    a.ctl.tokenOk = true;
    a.ctl.refreshWorks = true;
    await user.click(screen.getByRole('button', { name: 'Войти заново' }));
    await waitFor(() => screen.getByRole('heading', { name: 'Вход' }), 5000);
    await user.type(screen.getByRole('textbox', { name: /Почта/ }), ALICE.email);
    await user.type(document.querySelector<HTMLInputElement>('input[type="password"]')!, ALICE.password);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(232), 30_000);
    const store2 = a.td.stores[a.td.stores.length - 1] as Store;
    await eventually(async () => expect((await store2.sync.counts()).pending).toBe(0), 15_000);
    expect(new Set(server.dump(ALICE.id, 'transactions').map((r) => r['id'])).size).toBe(232);
    expect(await store2.db.transactions.count()).toBe(232);
  }, 120_000);

  it('«Нужен вход» без действий человека: токен ожил, вкладка снова на виду — синхронизация сама возвращается', async () => {
    const server = createMemoryServer();
    const a = await open(server, false);
    await act(async () => void (await manyTx(a.store, 3, 'в-фоне')));
    a.ctl.tokenOk = false;
    await act(async () => void (await a.engine.syncNow()));
    await waitFor(() => expect(text()).toMatch(/Нужен вход/));
    a.ctl.tokenOk = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 50));
    });
    await eventually(() => expect(a.engine.getStatus().phase).toBe('idle'), 10_000);
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(3);
    expect(a.engine.getStatus().pending).toBe(0);
  }, 60_000);

  it('401 на ПЕРВОЙ загрузке (токен истёк в момент входа): экран «Нужно войти заново», приложение закрыто, затравка не создана', async () => {
    const server = createMemoryServer();
    const s = setup(server);
    s.ctl.refreshWorks = false;
    s.ctl.tokenOk = false;
    renderAppRoot(<AppRoutes />, { client: s.auth.client, deps: s.td.deps, path: '/' });
    await waitFor(() => expect(text()).toMatch(/Нужно войти заново/), 15_000);
    const store = s.td.stores[0] as Store;
    expect(await store.db.settings.count()).toBe(0);
    expect(await store.db.wallets.count()).toBe(0);
    expect(screen.queryByRole('heading', { name: 'Главная' })).toBeNull();
    expect(server.dump(ALICE.id, 'settings')).toHaveLength(0);
  }, 40_000);
});
