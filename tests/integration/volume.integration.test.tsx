/**
 * Атака 10. Большие объёмы: 5 000 операций. Первая загрузка на новом устройстве, открытие «Главной» и «Операций»,
 * реакция интерфейса на новую запись, отправка пачками. Время меряется в jsdom + fake-indexeddb, поэтому пороги щедрые:
 * они ловят «зависание» (квадратичный рост, чтение всего при каждом обновлении), а не медленный телефон.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { screen, user, waitFor } from '@/components/testUtils';
import { ensureSeeded, newId, openStore, type Store } from '@/db';
import type { LocalRow, Transaction } from '@/domain/types';
import { addDays } from '@/lib/dates';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { toWire, type SyncTableName } from '@/sync/tables';
import type { SyncTransport } from '@/sync/transport';
import { clickSave, tapAmount } from '@/features/transactions/__fixtures__/opsKit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const N = 5000;
const text = () => document.body.textContent ?? '';

/** Сервер с N операциями за ~2 года: кошельки, категории и операции заведены напрямую через транспорт (быстро). */
async function bigServer(): Promise<{ server: MemoryServer; expenseSum: number; wallet: string }> {
  const server = createMemoryServer();
  const store = await openStore(ALICE.id, { deviceId: 'dev-src', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  const src = createSyncEngine({ store, transport: server.transportFor(ALICE.id), afterFirstPull: async () => void (await ensureSeeded(store)) });
  await src.syncNow();
  const cash = (await store.db.wallets.toArray())[0]!;
  const cats = await store.db.categories.toArray();
  const exp = cats.filter((c) => c.kind === 'expense');
  const inc = cats.filter((c) => c.kind === 'income');
  const base = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-01', note: 'эталон' });
  const t0 = Date.parse(base.clientUpdatedAt);
  let expenseSum = 0;
  const rows: LocalRow<Transaction>[] = Array.from({ length: N - 1 }, (_, i) => {
    const isIncome = i % 7 === 0;
    const cat = isIncome ? inc[i % inc.length]! : exp[i % exp.length]!;
    const amount = 1_00 + ((i * 37) % 9_000);
    return {
      ...base,
      id: newId(),
      kind: isIncome ? 'income' : 'expense',
      categoryId: cat.id,
      amountMinor: amount,
      baseAmountMinor: amount,
      occurredOn: addDays('2026-10-10', -(i % 700)),
      note: `операция ${i}`,
      createdAt: new Date(t0 + i + 1).toISOString(),
      clientUpdatedAt: new Date(t0 + i + 1).toISOString(),
    };
  });
  const wire = [base as LocalRow<Transaction>, ...rows].map((r) => toWire('transactions', r));
  const t: SyncTransport = server.transportFor(ALICE.id);
  for (let i = 0; i < wire.length; i += 200) await t.push('transactions', wire.slice(i, i + 200));
  expenseSum = [base, ...rows].filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amountMinor, 0);
  src.dispose();
  store.close();
  return { server, expenseSum, wallet: cash.id };
}

function newDevice(server: MemoryServer, requests: Array<[SyncTableName, number]> = []) {
  const td = makeTestDeps();
  const engines: SyncEngine[] = [];
  td.deps.openStore = async (uid) => {
    const s = await openStore(uid, { deviceId: 'dev-new', dexie: { indexedDB: td.factory, IDBKeyRange } });
    td.stores.push(s);
    return s;
  };
  td.deps.createTransport = () => {
    const inner = server.transportFor(ALICE.id);
    return { currentUserId: () => inner.currentUserId(), push: (t, r) => inner.push(t, r), pull: (t, a, l) => (requests.push([t, a]), inner.pull(t, a, l)) } as typeof inner;
  };
  td.deps.createEngine = (o) => {
    const e = createSyncEngine(o);
    engines.push(e);
    return e;
  };
  return { td, engines };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('атака 10: 5 000 операций', () => {
  it('новое устройство: первая загрузка пачками по 500, затем «Главная» и «Операции» открываются; новая запись доходит до экрана быстро', async () => {
    const { server, wallet } = await bigServer();
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(N);
    const requests: Array<[SyncTableName, number]> = [];
    const d = newDevice(server, requests);

    const t0 = Date.now();
    renderAppRoot(<AppRoutes />, { client: fakeAuthClient({ session: ALICE }).client, deps: d.td.deps, path: '/' });
    await waitFor(() => screen.getByRole('heading', { name: 'Главная', level: 1 }), 120_000);
    const loaded = Date.now() - t0;
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 60_000);
    const homeReady = Date.now() - t0;
    const store = d.td.stores[0] as Store;
    expect(await store.db.transactions.count()).toBe(N);
    const txPulls = requests.filter(([t]) => t === 'transactions');
    // 5000 / 500 = 10 страниц + пустая после отправки (+1 запас на повторную проверку)
    expect(txPulls.length).toBeLessThanOrEqual(13);
    process.stderr.write(`[volume] первая загрузка ${loaded} мс, главная готова ${homeReady} мс, запросов операций ${txPulls.length}\n`);
    expect(homeReady, `главная с ${N} операциями готова за ${homeReady} мс`).toBeLessThan(60_000);

    // итог «Всего» совпадает с суммой из базы
    const bal = (await store.db.transactions.toArray()).reduce((s, t) => s + (t.kind === 'income' ? t.amountMinor : -t.amountMinor), 0);
    await waitFor(() => expect(document.querySelector('[data-testid="home-total"]')?.textContent?.replace(/\s/g, '')).toContain(String(Math.abs(Math.trunc(bal / 100))).replace(/\B(?=(\d{3})+(?!\d))/g, '')));

    // список операций
    const tList = Date.now();
    await user.click(screen.getAllByRole('link', { name: 'Операции' })[0] as HTMLElement);
    await waitFor(() => screen.getByRole('heading', { name: 'Операции', level: 1 }), 30_000);
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 60_000);
    const listReady = Date.now() - tList;
    process.stderr.write(`[volume] список операций ${listReady} мс\n`);
    expect(listReady, 'список зависает').toBeLessThan(30_000);
    const rowsInDom = document.querySelectorAll('section[aria-label] button').length;
    expect(rowsInDom, 'в страницу выведено слишком много строк сразу').toBeLessThanOrEqual(400);

    // новая запись через интерфейс доходит до экрана
    const tAdd = Date.now();
    await user.click(screen.getAllByRole('link', { name: /Добавить операцию/ })[0] as HTMLElement);
    await waitFor(() => screen.getByRole('dialog', { name: 'Новая операция' }), 10_000);
    await tapAmount('77');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'новая-среди-пяти-тысяч');
    await clickSave();
    await waitFor(() => expect(text()).toMatch(/новая-среди-пяти-тысяч/), 30_000);
    const addReady = Date.now() - tAdd;
    process.stderr.write(`[volume] запись → экран ${addReady} мс\n`);
    expect(addReady, 'новая запись не доходит до экрана').toBeLessThan(15_000);
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(N + 1), 30_000);
    void wallet;
  }, 300_000);

  it('отправка идёт пачками не больше 200 строк; число запросов растёт линейно', async () => {
    const server = createMemoryServer();
    const store = await openStore(ALICE.id, { deviceId: 'dev-a', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
    const sizes: Array<[SyncTableName, number]> = [];
    const inner = server.transportFor(ALICE.id);
    const engine = createSyncEngine({
      store,
      transport: { currentUserId: () => inner.currentUserId(), pull: (t, a, l) => inner.pull(t, a, l), push: (t, r) => (sizes.push([t, r.length]), inner.push(t, r)) } as typeof inner,
      afterFirstPull: async () => void (await ensureSeeded(store)),
    });
    await engine.syncNow();
    sizes.length = 0;
    const w = (await store.db.wallets.toArray())[0]!;
    const base = await store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 100, occurredOn: '2026-10-01', note: 'эталон' });
    const rows: LocalRow<Transaction>[] = Array.from({ length: 449 }, (_, i) => ({
      ...base,
      id: newId(),
      amountMinor: 100 + i,
      baseAmountMinor: 100 + i,
      clientUpdatedAt: new Date(Date.parse(base.clientUpdatedAt) + i + 1).toISOString(),
    }));
    await store.db.transactions.bulkPut(rows);
    await engine.syncNow();
    const txSizes = sizes.filter(([t]) => t === 'transactions').map(([, n]) => n);
    expect(Math.max(...txSizes)).toBeLessThanOrEqual(200);
    expect(txSizes.reduce((s, n) => s + n, 0)).toBe(450); // каждая строка ушла ровно раз
    expect(txSizes.length).toBe(3);
    expect(server.dump(ALICE.id, 'transactions')).toHaveLength(450);
    engine.dispose();
    store.close();
  }, 120_000);
});
