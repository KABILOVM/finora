import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import type { Store } from '@/db';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { newWatch, reconcile } from '@/sync/reconcile';
import { TransportError } from '@/sync/transport';
import { openDevice, type Device } from './engineHarness';

/**
 * Согласование после синхронизации: «валюту кошелька / вид категории нельзя менять, если по ним есть операции» проверяют только
 * локальные репозитории, а строки сливаются по одной. Поэтому смена на одном телефоне и операция на другом (без сети)
 * не должны менять смысл суммы. Операции главнее: кошелёк (категория) возвращается к тому, под что они записаны.
 */

interface Phones {
  server: MemoryServer;
  a: Device;
  b: Device;
  /** Телефон B теряет связь (его запросы падают как сетевые). */
  setBOffline(offline: boolean): void;
}

async function phones(): Promise<Phones> {
  const server = createMemoryServer();
  let bOffline = false;
  const a = await openDevice(server, 'dev-a', { seed: true });
  const b = await openDevice(server, 'dev-b', {
    seed: true,
    wrap: (inner) => ({
      pull: async (t, s, l) => (bOffline ? Promise.reject(new TransportError('network', 'офлайн')) : inner.pull(t, s, l)),
      push: async (t, r) => (bOffline ? Promise.reject(new TransportError('network', 'офлайн')) : inner.push(t, r)),
    }),
  });
  await a.engine.syncNow();
  await b.engine.syncNow();
  return { server, a, b, setBOffline: (v) => void (bOffline = v) };
}

const newWallet = (d: Device, name: string, currency = 'TJS') =>
  d.store.wallets.create({ name, currency, kind: 'card', openingBalanceMinor: 0, color: '#111111', icon: 'c' });

/** Несколько кругов синхронизации обоих телефонов: хватает, чтобы всё разошлось. */
async function settleAll(p: Phones, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await p.a.engine.syncNow();
    await p.b.engine.syncNow();
  }
}

const walletRow = (d: Device, id: string) => d.store.db.wallets.get(id);
const serverWallet = (p: Phones, id: string) => p.server.dump('11111111-1111-4111-8111-111111111111', 'wallets').find((r) => r['id'] === id);
const serverCategory = (p: Phones, id: string) => p.server.dump('11111111-1111-4111-8111-111111111111', 'categories').find((r) => r['id'] === id);

async function balanceOf(d: Device, walletId: string): Promise<number | undefined> {
  const wallets = await d.store.db.wallets.toArray();
  const txs = await d.store.db.transactions.toArray();
  return computeBalances(wallets, txs).get(walletId);
}

describe('валюта кошелька и операция с другого телефона', () => {
  it('расход в сомони, а кошелёк стал долларовым: кошелёк возвращается в сомони везде, сумма читается верно', async () => {
    const p = await phones();
    const w = await newWallet(p.a, 'Карта');
    await settleAll(p, 1);

    p.setBOffline(true);
    await p.a.store.wallets.update(w.id, { currency: 'USD' }); // операций по кошельку у A ещё нет — разрешено
    await p.a.engine.syncNow();
    const tx = await p.b.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 100_000, occurredOn: '2026-10-05', note: 'продукты' });
    p.setBOffline(false);
    await settleAll(p);

    for (const d of [p.a, p.b]) {
      expect((await walletRow(d, w.id))?.currency, d.deviceId).toBe('TJS');
      expect(await balanceOf(d, w.id), `${d.deviceId}: остаток`).toBe(-100_000);
      const row = await d.store.db.transactions.get(tx.id);
      expect(row, d.deviceId).toMatchObject({ amountMinor: 100_000, fxSource: 'same', baseCurrency: 'TJS', deletedAt: null, note: 'продукты' });
      expect(d.engine.getStatus(), d.deviceId).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    }
    expect(serverWallet(p, w.id)?.['currency']).toBe('TJS');
  });

  it('обратная сторона: кошелёк стал сомонским, а расход записан в долларах по курсу — кошелёк возвращается в доллары', async () => {
    const p = await phones();
    const w = await newWallet(p.a, 'Доллары', 'USD');
    await settleAll(p, 1);

    p.setBOffline(true);
    await p.a.store.wallets.update(w.id, { currency: 'TJS' }); // «заведён долларовым по ошибке»
    await p.a.engine.syncNow();
    const tx = await p.b.store.transactions.create({
      kind: 'expense',
      walletId: w.id,
      amountMinor: 10_000, // 100 долларов
      occurredOn: '2026-10-05',
      fx: { rate: 10.5, source: 'manual' },
    });
    expect(tx).toMatchObject({ baseAmountMinor: 105_000, baseCurrency: 'TJS' });
    p.setBOffline(false);
    await settleAll(p);

    for (const d of [p.a, p.b]) {
      expect((await walletRow(d, w.id))?.currency, d.deviceId).toBe('USD');
      expect(await balanceOf(d, w.id), `${d.deviceId}: остаток`).toBe(-10_000);
      expect(await d.store.db.transactions.get(tx.id), d.deviceId).toMatchObject({ amountMinor: 10_000, baseAmountMinor: 105_000, fxSource: 'manual' });
    }
    expect(serverWallet(p, w.id)?.['currency']).toBe('USD');
  });

  it('другие правки чужой версии кошелька сохраняются: возвращается только валюта', async () => {
    const p = await phones();
    const w = await newWallet(p.a, 'Карта');
    await settleAll(p, 1);

    p.setBOffline(true);
    await p.a.store.wallets.update(w.id, { currency: 'USD', name: 'Карта Visa', color: '#abcdef' });
    await p.a.engine.syncNow();
    await p.b.store.transactions.create({ kind: 'income', walletId: w.id, amountMinor: 5_000, occurredOn: '2026-10-05' });
    p.setBOffline(false);
    await settleAll(p);

    for (const d of [p.a, p.b]) {
      expect(await walletRow(d, w.id), d.deviceId).toMatchObject({ currency: 'TJS', name: 'Карта Visa', color: '#abcdef' });
    }
  });

  it('исправление стабильно: лишние круги синхронизации ничего не меняют на сервере', async () => {
    const p = await phones();
    const w = await newWallet(p.a, 'Карта');
    await settleAll(p, 1);
    p.setBOffline(true);
    await p.a.store.wallets.update(w.id, { currency: 'USD' });
    await p.a.engine.syncNow();
    await p.b.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 1_000, occurredOn: '2026-10-05' });
    p.setBOffline(false);
    await settleAll(p);

    const before = JSON.stringify(p.server.dump('11111111-1111-4111-8111-111111111111', 'wallets'));
    await settleAll(p, 3);
    expect(JSON.stringify(p.server.dump('11111111-1111-4111-8111-111111111111', 'wallets'))).toBe(before);
  });

  it('без конфликта ничего не переписывается: смена валюты, а потом операции в новой валюте на том же телефоне', async () => {
    const p = await phones();
    const w = await newWallet(p.a, 'Карта');
    await settleAll(p, 1);

    await p.a.store.wallets.update(w.id, { currency: 'USD' });
    const tx = await p.a.store.transactions.create({
      kind: 'expense',
      walletId: w.id,
      amountMinor: 2_000,
      occurredOn: '2026-10-05',
      fx: { rate: 10.5, source: 'manual' },
    });
    await settleAll(p);

    for (const d of [p.a, p.b]) {
      expect(await walletRow(d, w.id), d.deviceId).toMatchObject({ currency: 'USD', deviceId: 'dev-a' }); // версию A никто не переписывал
      expect((await d.store.db.transactions.get(tx.id))?.amountMinor, d.deviceId).toBe(2_000);
    }
  });

  it('если по кошельку операции в разных валютах и неясно, на что вернуть, кошелёк не трогают', async () => {
    const p = await phones();
    const w = await newWallet(p.a, 'Карта', 'USD');
    await p.a.engine.syncNow();
    const { db } = p.a.store;
    const base = await db.transactions.toArray();
    expect(base).toHaveLength(0);
    // две операции «в базовой валюте», но с разными базовыми валютами: так могло получиться только из-за двух конфликтов подряд
    const stamp = '2026-10-05T10:00:00.000Z';
    const mk = (id: string, baseCurrency: string) => ({
      id,
      kind: 'expense' as const,
      walletId: w.id,
      toWalletId: null,
      amountMinor: 100,
      toAmountMinor: null,
      categoryId: null,
      occurredOn: '2026-10-05',
      note: '',
      baseCurrency,
      baseAmountMinor: 100,
      fxRate: 1,
      fxSource: 'same',
      createdAt: stamp,
      clientUpdatedAt: stamp,
      deviceId: 'dev-x',
      deletedAt: null,
      dirty: 0 as const,
      serverSeq: 1,
      syncError: null,
    });
    await db.transactions.bulkPut([mk('aaaaaaaa-0000-4000-8000-000000000001', 'TJS'), mk('aaaaaaaa-0000-4000-8000-000000000002', 'RUB')]);
    const watch = newWatch();
    watch.walletFacts.set(w.id, new Set(['same:TJS', 'same:RUB']));
    expect(await reconcile(p.a.store, watch)).toBe(0);
    expect((await walletRow(p.a, w.id))?.currency).toBe('USD');
  });

  it('согласование не ломает синхронизацию: «чужое» хранилище без внутреннего доступа — просто ничего не делает', async () => {
    const watch = newWatch();
    watch.pinnedCurrency.set('x', 'TJS');
    expect(await reconcile({} as Store, watch)).toBe(0);
  });
});

describe('вид категории и операция с другого телефона', () => {
  async function foodCategory(p: Phones) {
    const cat = await p.a.store.db.categories.where('kind').equals('expense').filter((c) => c.deletedAt === null).first();
    if (!cat) throw new Error('в затравке нет категории расходов');
    return cat;
  }

  it('категория стала «доходом», а на другом телефоне в неё записан расход: категория возвращается в «расходы»', async () => {
    const p = await phones();
    const cat = await foodCategory(p);
    const wallet = (await p.b.store.db.wallets.toArray())[0]!;
    await settleAll(p, 1);

    p.setBOffline(true);
    await p.a.store.categories.update(cat.id, { kind: 'income' }); // операций по категории у A нет — разрешено
    await p.a.engine.syncNow();
    const tx = await p.b.store.transactions.create({ kind: 'expense', walletId: wallet.id, categoryId: cat.id, amountMinor: 700, occurredOn: '2026-10-05' });
    p.setBOffline(false);
    await settleAll(p);

    for (const d of [p.a, p.b]) {
      expect((await d.store.db.categories.get(cat.id))?.kind, d.deviceId).toBe('expense');
      expect(await d.store.db.transactions.get(tx.id), d.deviceId).toMatchObject({ kind: 'expense', categoryId: cat.id, amountMinor: 700, deletedAt: null });
      expect(d.engine.getStatus(), d.deviceId).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    }
    expect(serverCategory(p, cat.id)?.['kind']).toBe('expense');
  });

  it('без конфликта вид не возвращают: A удалил все операции категории и сменил вид — на B это принимается', async () => {
    const p = await phones();
    const cat = await foodCategory(p);
    const wallet = (await p.a.store.db.wallets.toArray())[0]!;
    const tx = await p.a.store.transactions.create({ kind: 'expense', walletId: wallet.id, categoryId: cat.id, amountMinor: 700, occurredOn: '2026-10-05' });
    await settleAll(p, 2);
    expect(await p.b.store.db.transactions.get(tx.id)).toBeDefined();

    await p.a.store.transactions.softDelete(tx.id);
    await p.a.store.categories.update(cat.id, { kind: 'income' });
    await settleAll(p);

    for (const d of [p.a, p.b]) {
      expect(await d.store.db.categories.get(cat.id), d.deviceId).toMatchObject({ kind: 'income', deviceId: 'dev-a' });
    }
  });
});

describe('операция, отвергнутая сервером сама по себе, не возвращается в очередь из-за родителя', () => {
  it('собственный отказ остаётся в карантине, пока человек не исправит запись', async () => {
    const server = createMemoryServer();
    const d = await openDevice(server, 'dev-a', {
      seed: true,
      wrap: (inner) => ({
        pull: (t, a, l) => inner.pull(t, a, l),
        async push(table, rows) {
          if (table === 'transactions' && rows.some((r) => r['note'] === 'плохая')) throw new TransportError('rejected', 'CHECK (имитация)', '23514');
          return inner.push(table, rows);
        },
      }),
    });
    await d.engine.syncNow();
    const w = await newWallet(d, 'Кошелёк');
    const bad = await d.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 100, occurredOn: '2026-10-05', note: 'плохая' });
    await d.engine.syncNow();
    await d.engine.syncNow();
    expect(d.engine.getStatus().quarantined).toBe(1);
    expect((await d.store.db.transactions.get(bad.id))?.syncError).toMatch(/Сервер не принял запись/);

    await d.store.transactions.update(bad.id, { note: 'хорошая' });
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
    expect(server.dump('11111111-1111-4111-8111-111111111111', 'transactions')).toHaveLength(1);
  });
});
