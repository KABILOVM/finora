/**
 * Атака 5. Первая загрузка данных: обрывы сети посреди страницы, затравка двумя новыми устройствами одного человека,
 * человек с данными на сервере не получает затравку поверх.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALICE, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { act, screen, user, waitFor } from '@/components/testUtils';
import { ensureSeeded, newId, openStore, useWallets, type Store } from '@/db';
import type { LocalRow, Transaction } from '@/domain/types';
import { createSyncEngine, META_INITIAL_PULL, type SyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import type { SessionAwareTransport } from '@/sync/session';
import type { SyncTableName } from '@/sync/tables';
import { TransportError } from '@/sync/transport';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const text = () => document.body.textContent ?? '';
const Marker = () => {
  const w = useWallets({ includeArchived: true });
  return <div>ПРИЛОЖЕНИЕ ГОТОВО: {(w ?? []).length}</div>;
};

interface Hooks {
  /** Перед ответом на pull: можно бросить ошибку или вклиниться. */
  beforePull?: (table: SyncTableName, afterSeq: number, call: number) => Promise<void> | void;
  /** После успешного pull, до возврата ответа движку. */
  afterPull?: (table: SyncTableName, afterSeq: number, call: number) => Promise<void> | void;
}

function hooked(server: MemoryServer, h: Hooks, log: Array<[SyncTableName, number]> = []): SessionAwareTransport {
  const inner = server.transportFor(ALICE.id);
  let call = 0;
  return {
    currentUserId: () => inner.currentUserId(),
    push: (t, r) => inner.push(t, r),
    async pull(t, a, l) {
      const n = ++call;
      log.push([t, a]);
      await h.beforePull?.(t, a, n);
      const rows = await inner.pull(t, a, l);
      await h.afterPull?.(t, a, n);
      return rows;
    },
  };
}

async function newStore(id: string, factory = new IDBFactory()) {
  return openStore(ALICE.id, { deviceId: id, dexie: { indexedDB: factory, IDBKeyRange } });
}

async function bare(server: MemoryServer, id: string, h: Hooks = {}) {
  const store = await newStore(id);
  const engine = createSyncEngine({ store, transport: hooked(server, h), afterFirstPull: async () => void (await ensureSeeded(store)) });
  return { store, engine };
}

/** Много операций сразу (минуя интерфейс): строки той же формы, что делает репозиторий. */
async function bulkExpenses(store: Store, n: number, prefix = 'op'): Promise<void> {
  const wallet = (await store.db.wallets.toArray())[0]!;
  const base = await store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 100, occurredOn: '2026-10-01', note: `${prefix}-base` });
  const rows: LocalRow<Transaction>[] = Array.from({ length: n - 1 }, (_, i) => ({
    ...base,
    id: newId(),
    amountMinor: 100 + i,
    baseAmountMinor: 100 + i,
    occurredOn: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
    note: `${prefix}-${i}`,
  }));
  await store.db.transactions.bulkPut(rows);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('атака 5: первая загрузка', () => {
  it('обрыв сети на второй странице операций: экран загрузки не пускает в приложение, затравки нет, после «Повторить» всё загружено без дублей', async () => {
    const server = createMemoryServer();
    const src = await bare(server, 'dev-src');
    await src.engine.syncNow();
    await bulkExpenses(src.store, 560);
    await src.engine.syncNow();
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(560);
    const serverSeqs = (t: SyncTableName) => server.dump(ALICE.id, t).map((r) => r['server_seq']);
    const before = { w: serverSeqs('wallets'), c: serverSeqs('categories'), s: serverSeqs('settings') };

    const td = makeTestDeps();
    const pulls: Array<[SyncTableName, number]> = [];
    let failed = false;
    td.deps.openStore = async (uid) => {
      const s = await openStore(uid, { deviceId: 'dev-new', dexie: { indexedDB: td.factory, IDBKeyRange } });
      td.stores.push(s);
      return s;
    };
    td.deps.createTransport = () =>
      hooked(
        server,
        {
          beforePull: (t, a) => {
            if (t === 'transactions' && a > 0 && !failed) {
              failed = true;
              throw new TransportError('network', 'обрыв посреди страницы (тест)');
            }
          },
        },
        pulls,
      );
    const engines: SyncEngine[] = [];
    td.deps.createEngine = (o) => {
      const e = createSyncEngine(o);
      engines.push(e);
      return e;
    };
    renderAppRoot(<Marker />, { client: fakeAuthClient({ session: ALICE }).client, deps: td.deps });

    await waitFor(() => expect(text()).toMatch(/Нужен интернет для первой загрузки|Не удалось загрузить данные/), 15_000);
    expect(text()).not.toMatch(/ПРИЛОЖЕНИЕ ГОТОВО/);
    const store = td.stores[0] as Store;
    // пока загрузка не закончена: нет затравки поверх, нет отправки чужого
    expect((await store.db.settings.get(ALICE.id))?.deviceId).toBe('dev-src'); // пришло с сервера, не создано здесь
    expect((await store.sync.counts()).pending).toBe(0);
    expect(await store.db.categories.count()).toBeLessThanOrEqual(17);
    expect(await store.sync.getMeta(META_INITIAL_PULL)).toBeUndefined();
    const partial = await store.db.transactions.count();
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(560);

    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(text()).toMatch(/ПРИЛОЖЕНИЕ ГОТОВО/), 20_000);
    expect(await store.db.transactions.count()).toBe(560);
    // продолжили с сохранённого курса, а не с нуля: «повторная» страница операций начинается не с 0
    const txPulls = pulls.filter(([t]) => t === 'transactions').map(([, a]) => a);
    expect(txPulls.filter((a) => a === 0)).toHaveLength(1);
    // затравка не добавила ничего: на сервере те же строки с теми же номерами
    await act(async () => void (await (engines[0] as SyncEngine).syncNow()));
    expect({ w: serverSeqs('wallets'), c: serverSeqs('categories'), s: serverSeqs('settings') }).toEqual(before);
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(560);
    expect((await store.sync.counts()).pending).toBe(0);
    src.engine.dispose();
    src.store.close();
  }, 90_000);

  it('приложение закрыли посреди первой загрузки и открыли снова: загрузка продолжается, данные не двоятся', async () => {
    const server = createMemoryServer();
    const src = await bare(server, 'dev-src');
    await src.engine.syncNow();
    await bulkExpenses(src.store, 520);
    await src.engine.syncNow();

    const factory = new IDBFactory();
    const s1 = await newStore('dev-new', factory);
    let boom = true;
    const e1 = createSyncEngine({
      store: s1,
      transport: hooked(server, {
        beforePull: (t, a) => {
          if (t === 'transactions' && a > 0 && boom) throw new TransportError('server', 'закрыли вкладку');
        },
      }),
      afterFirstPull: async () => void (await ensureSeeded(s1)),
    });
    await e1.syncNow();
    expect(await s1.sync.getMeta(META_INITIAL_PULL)).toBeUndefined();
    e1.dispose();
    s1.close();
    boom = false;

    const s2 = await newStore('dev-new', factory);
    const e2 = createSyncEngine({ store: s2, transport: hooked(server, {}), afterFirstPull: async () => void (await ensureSeeded(s2)) });
    await e2.syncNow();
    expect(await s2.sync.getMeta(META_INITIAL_PULL)).toBe(true);
    expect(await s2.db.transactions.count()).toBe(520);
    expect(await s2.db.wallets.count()).toBe(1);
    expect(await s2.db.categories.count()).toBe(17);
    expect(server.dump(ALICE.id, 'wallets')).toHaveLength(1);
    expect(server.dump(ALICE.id, 'categories')).toHaveLength(17);
    e2.dispose();
    s2.close();
    src.engine.dispose();
    src.store.close();
  }, 60_000);

  it('два НОВЫХ устройства одного человека начинают одновременно на пустом сервере: затравка не плодит дубли', async () => {
    const server = createMemoryServer();
    const a = await bare(server, 'dev-a');
    const b = await bare(server, 'dev-b');
    await Promise.all([a.engine.syncNow(), b.engine.syncNow()]);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(server.dump(ALICE.id, 'settings')).toHaveLength(1);
    expect(server.dump(ALICE.id, 'wallets')).toHaveLength(1);
    expect(server.dump(ALICE.id, 'categories')).toHaveLength(17);
    for (const s of [a.store, b.store]) {
      expect(await s.db.wallets.count()).toBe(1);
      expect(await s.db.categories.count()).toBe(17);
      expect((await s.sync.counts()).pending).toBe(0);
      expect((await s.settings.get())?.defaultWalletId).toBe((await s.db.wallets.toArray())[0]!.id);
    }
  }, 30_000);

  // Убранный сценарий (отвергнут, не ошибка кода): второе устройство читало пустой сервер, пока первое затравило ВСЁ и человек уже сменил
  // основную валюту, а затравка второго потом перекрыла её сомони. Для этого первая загрузка второго устройства должна идти дольше,
  // чем человек добирается до смены валюты на первом (десятки секунд); последствие — валюта показывает TJS и меняется одним нажатием,
  // операции и суммы не страдают.

  it('у человека есть данные на сервере (кошелёк «Наличные» удалён, валюта USD): новое устройство ничего не затравляет', async () => {
    const server = createMemoryServer();
    const a = await bare(server, 'dev-a');
    await a.engine.syncNow();
    const cash = (await a.store.db.wallets.toArray())[0]!;
    const card = await a.store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 5_000, color: '#2563eb', icon: '💳' });
    await a.store.settings.update({ baseCurrency: 'USD', defaultWalletId: card.id });
    await a.store.wallets.archive(cash.id);
    const food = (await a.store.db.categories.toArray()).find((c) => c.name === 'Еда')!;
    await a.store.categories.update(food.id, { name: 'Моя еда' });
    await a.engine.syncNow();
    const seqs = () => JSON.stringify(['settings', 'wallets', 'categories'].map((t) => server.dump(ALICE.id, t as SyncTableName).map((r) => [r['id'], r['server_seq']])));
    const before = seqs();

    const b = await bare(server, 'dev-b');
    await b.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(seqs()).toBe(before);
    const sb = await b.store.settings.get();
    expect([sb?.baseCurrency, sb?.defaultWalletId]).toEqual(['USD', card.id]);
    expect((await b.store.db.categories.toArray()).filter((c) => c.name === 'Еда')).toHaveLength(0);
    expect((await b.store.db.wallets.toArray()).map((w) => w.name).sort()).toEqual(['Карта', 'Наличные']);
    expect((await b.store.sync.counts()).pending).toBe(0);
  }, 30_000);
});
