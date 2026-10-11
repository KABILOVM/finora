/**
 * Атака 4. Конфликты валюты кошелька / вида категории между устройствами (reconcile) на уровне остатков и интерфейса.
 * Одно устройство меняет валюту ПУСТОГО кошелька (на одном устройстве это разрешено), другое, не зная об этом, пишет в него.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { screen, waitFor } from '@/components/testUtils';
import { ensureSeeded, openStore, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

interface Dev {
  store: Store;
  engine: SyncEngine;
  online: { v: boolean };
}

async function dev(server: MemoryServer, id: string): Promise<Dev> {
  const store = await openStore(ALICE.id, { deviceId: id, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  const online = { v: true };
  const inner = server.transportFor(ALICE.id);
  const engine = createSyncEngine({
    store,
    transport: {
      currentUserId: () => inner.currentUserId(),
      pull: async (t, a, l) => {
        if (!online.v) throw new (await import('@/sync/transport')).TransportError('network', 'нет сети');
        return inner.pull(t, a, l);
      },
      push: async (t, r) => {
        if (!online.v) throw new (await import('@/sync/transport')).TransportError('network', 'нет сети');
        return inner.push(t, r);
      },
    } as typeof inner,
    afterFirstPull: async () => void (await ensureSeeded(store)),
  });
  return { store, engine, online };
}

const balances = async (s: Store) =>
  Object.fromEntries(computeBalances((await s.db.wallets.toArray()).filter((w) => w.deletedAt === null), await s.db.transactions.toArray()));

/** Несколько кругов обмена до покоя: A, B, A, B. */
async function converge(a: Dev, b: Dev, order: 'ab' | 'ba' = 'ab') {
  const [x, y] = order === 'ab' ? [a, b] : [b, a];
  for (let i = 0; i < 3; i++) {
    await x.engine.syncNow();
    await y.engine.syncNow();
  }
}

const snapshot = async (s: Store) =>
  JSON.stringify({
    w: (await s.db.wallets.toArray()).map((w) => [w.id, w.currency, w.deletedAt]).sort(),
    c: (await s.db.categories.toArray()).map((c) => [c.id, c.kind]).sort(),
    t: (await s.db.transactions.toArray()).map((t) => [t.id, t.amountMinor, t.toAmountMinor]).sort(),
  });

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Два синхронных устройства и новый пустой кошелёк, уже разошедшийся на оба. */
async function twoWithWallet(currency: string, name = 'Кошелёк-2') {
  const server = createMemoryServer();
  const a = await dev(server, 'dev-a');
  await a.engine.syncNow();
  const b = await dev(server, 'dev-b');
  await b.engine.syncNow();
  const w = await a.store.wallets.create({ name, currency, kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
  await converge(a, b);
  return { server, a, b, wallet: w };
}

describe('атака 4: валюта кошелька и вид категории между устройствами', () => {
  for (const order of ['ab', 'ba'] as const) {
    it(`A меняет валюту пустого кошелька TJS→USD, B офлайн пишет в него расход в TJS (порядок обмена ${order}): сумма не меняет смысл, остатки равны`, async () => {
      const { a, b, wallet } = await twoWithWallet('TJS');
      b.online.v = false;
      await b.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 100_00, occurredOn: '2026-10-05', note: 'в-тенге' });
      await a.store.wallets.update(wallet.id, { currency: 'USD' });
      b.online.v = true;
      await converge(a, b, order);

      const ca = (await a.store.db.wallets.get(wallet.id))!.currency;
      const cb = (await b.store.db.wallets.get(wallet.id))!.currency;
      const tx = (await a.store.db.transactions.toArray())[0]!;
      expect(cb).toBe(ca);
      // расход записан в «сомони» (курс same к базовой TJS) → кошелёк обязан остаться TJS
      expect(tx.fxSource).toBe('same');
      expect(ca).toBe('TJS');
      expect(await snapshot(a.store)).toBe(await snapshot(b.store));
      expect(await balances(a.store)).toEqual(await balances(b.store));
      expect((await balances(a.store))[wallet.id]).toBe(-100_00);
      expect((await a.store.sync.counts()).pending + (await b.store.sync.counts()).pending).toBe(0);
    }, 30_000);
  }

  for (const order of ['ab', 'ba'] as const) {
    it(`A меняет валюту пустого кошелька USD→EUR, B офлайн пишет в него расход 10 $ (курс nbt), порядок ${order}: после обмена кошелёк не должен стать евро`, async () => {
      const { a, b, wallet } = await twoWithWallet('USD', 'Доллары-2');
      b.online.v = false;
      await b.store.transactions.create({
        kind: 'expense',
        walletId: wallet.id,
        amountMinor: 10_00,
        occurredOn: '2026-10-05',
        note: 'десять-долларов',
        fx: { rate: 10.9, source: 'nbt' },
      });
      await a.store.wallets.update(wallet.id, { currency: 'EUR' });
      b.online.v = true;
      await converge(a, b, order);

      const ca = (await a.store.db.wallets.get(wallet.id))!.currency;
      const cb = (await b.store.db.wallets.get(wallet.id))!.currency;
      expect(cb).toBe(ca);
      // операция введена как 10,00 USD со снимком 109,00 TJS; если кошелёк стал EUR — «10 $» молча превратились в «10 €»
      expect(ca, 'кошелёк с операцией в долларах стал евровым: сумма 10,00 теперь читается как 10,00 €').toBe('USD');
      expect(await snapshot(a.store)).toBe(await snapshot(b.store));
      expect((await a.store.sync.counts()).pending + (await b.store.sync.counts()).pending).toBe(0);
    }, 30_000);

    it(`A меняет валюту пустого кошелька TJS→USD, B офлайн переводит в него 100 сомони из «Наличных» (100→100), порядок ${order}: деньги не появляются из воздуха`, async () => {
      const { a, b, wallet } = await twoWithWallet('TJS');
      const cash = (await b.store.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
      b.online.v = false;
      await b.store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: wallet.id, amountMinor: 100_00, occurredOn: '2026-10-05', note: 'перевод' });
      await a.store.wallets.update(wallet.id, { currency: 'USD' });
      b.online.v = true;
      await converge(a, b, order);

      const ca = (await a.store.db.wallets.get(wallet.id))!.currency;
      expect(await snapshot(a.store)).toBe(await snapshot(b.store));
      const tx = (await a.store.db.transactions.toArray())[0]!;
      const from = (await a.store.db.wallets.get(cash.id))!.currency;
      // перевод 100→100 между кошельками РАЗНЫХ валют означал бы, что 100 сомони стали 100 долларов
      const created = from !== ca && tx.amountMinor === tx.toAmountMinor;
      expect(created, `кошелёк-получатель стал ${ca}, а «Наличные» ${from}: перевод ${tx.amountMinor}→${tx.toAmountMinor} создал деньги`).toBe(false);
      expect((await a.store.sync.counts()).pending + (await b.store.sync.counts()).pending).toBe(0);
    }, 30_000);
  }

  it('операции в долларах и в евро записали ОБА устройства (кошелёк оказался «общим»): валюта не переключается без конца, устройства сходятся', async () => {
    const { server, a, b, wallet } = await twoWithWallet('USD', 'Спорный');
    b.online.v = false;
    await b.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 10_00, occurredOn: '2026-10-05', note: 'b-доллары', fx: { rate: 10.9, source: 'nbt' } });
    await a.store.wallets.update(wallet.id, { currency: 'EUR' });
    await a.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 20_00, occurredOn: '2026-10-05', note: 'a-евро', fx: { rate: 12.1, source: 'nbt' } });
    b.online.v = true;
    for (let i = 0; i < 4; i++) await converge(a, b);

    const seqOf = () => server.dump(ALICE.id, 'wallets').find((r) => r['id'] === wallet.id)?.['server_seq'];
    const settledAt = seqOf();
    for (let i = 0; i < 3; i++) await converge(a, b); // дальнейшие круги ничего не меняют: на сервере та же версия кошелька
    expect(seqOf(), 'валюта кошелька продолжает переключаться между устройствами').toBe(settledAt);
    expect((await a.store.db.wallets.get(wallet.id))!.currency).toBe((await b.store.db.wallets.get(wallet.id))!.currency);
    expect(await snapshot(a.store)).toBe(await snapshot(b.store));
    expect((await a.store.sync.counts()).pending + (await b.store.sync.counts()).pending).toBe(0);
  }, 40_000);

  for (const order of ['ab', 'ba'] as const) {
    it(`A меняет вид пустой категории расход→доход, B офлайн вносит в неё расход (порядок ${order}): расход не оказывается в категории доходов`, async () => {
      const server = createMemoryServer();
      const a = await dev(server, 'dev-a');
      await a.engine.syncNow();
      const b = await dev(server, 'dev-b');
      await b.engine.syncNow();
      const cat = await a.store.categories.create({ name: 'Спорт', kind: 'expense', color: '#22c55e', icon: '🏃' });
      await converge(a, b);
      const cash = (await b.store.db.wallets.toArray())[0]!;
      b.online.v = false;
      await b.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 50_00, categoryId: cat.id, occurredOn: '2026-10-05', note: 'зал' });
      await a.store.categories.update(cat.id, { kind: 'income' });
      b.online.v = true;
      await converge(a, b, order);

      for (const s of [a.store, b.store]) {
        const c = (await s.db.categories.get(cat.id))!;
        const t = (await s.db.transactions.toArray())[0]!;
        expect(c.kind, `категория «${c.name}» стала ${c.kind}, а расход «${t.note}» лежит в ней`).toBe(t.kind);
      }
      expect(await snapshot(a.store)).toBe(await snapshot(b.store));
    }, 30_000);
  }

  it('интерфейс «Кошельки» на обоих устройствах показывает одну и ту же валюту и один и тот же остаток после конфликта', async () => {
    const { server, a, b, wallet } = await twoWithWallet('TJS', 'Конфликтный');
    b.online.v = false;
    await b.store.transactions.create({ kind: 'income', walletId: wallet.id, amountMinor: 250_00, categoryId: (await b.store.db.categories.toArray()).find((c) => c.kind === 'income')!.id, occurredOn: '2026-10-05', note: 'доход' });
    await a.store.wallets.update(wallet.id, { currency: 'USD' });
    b.online.v = true;
    await converge(a, b);

    // показываем интерфейс устройства B поверх его же базы и движка
    const td = makeTestDeps();
    td.deps.openStore = async () => b.store;
    td.deps.createEngine = () => b.engine;
    td.deps.createTransport = () => server.transportFor(ALICE.id);
    renderAppRoot(<AppRoutes />, { client: fakeAuthClient({ session: ALICE }).client, deps: td.deps, path: '/wallets' });
    await waitFor(() => screen.getByRole('heading', { name: 'Кошельки', level: 1 }), 15_000);
    const row = await waitFor(() => screen.getByText('Конфликтный'));
    const li = row.closest('li')!;
    const finalCurrency = (await a.store.db.wallets.get(wallet.id))!.currency;
    expect(li.textContent).toContain(finalCurrency);
    expect(finalCurrency).toBe('TJS');
    expect(li.textContent).toMatch(/250\s*с\./);
  }, 30_000);
});
