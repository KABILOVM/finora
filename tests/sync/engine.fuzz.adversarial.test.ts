import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@/domain/types';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { USER, openDevice, spy, type Device, type Spy } from './engineHarness';

/**
 * Случайные сценарии: два телефона, у одного из них две вкладки на одной базе. Каждую строку правит только свой владелец,
 * поэтому по «последний побеждает» итог известен заранее: у всех устройств и на сервере должно лежать ровно то, что написал владелец.
 * Сбои: обрывы связи, 5xx, 401, потерянные ответы, задержки, «убитая» вкладка посреди цикла.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
};

interface Tab {
  owner: 'A' | 'B';
  dev: Device;
  sp: Spy;
  factory: IDBFactory;
  deviceId: string;
}

async function openTab(server: MemoryServer, owner: 'A' | 'B', deviceId: string, factory: IDBFactory): Promise<Tab> {
  let sp!: Spy;
  const dev = await openDevice(server, deviceId, { seed: true, factory, wrap: (inner) => (sp = spy(inner)).transport });
  return { owner, dev, sp, factory, deviceId };
}

type Expected = Pick<Transaction, 'walletId' | 'amountMinor' | 'note'> & { deleted: boolean };

async function scenario(seed: number): Promise<void> {
  const rand = rng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const server = createMemoryServer();
  const fa = new IDBFactory();
  const fb = new IDBFactory();
  const tabs: Tab[] = [await openTab(server, 'A', 'dev-a', fa), await openTab(server, 'A', 'dev-a', fa), await openTab(server, 'B', 'dev-b', fb)];

  // первая загрузка: A1 сеет данные, остальные получают их
  await (tabs[0] as Tab).dev.engine.syncNow();
  for (const t of tabs.slice(1)) await t.dev.engine.syncNow();

  const wallets = new Map<string, 'A' | 'B'>(); // id → владелец
  const expected = new Map<string, Expected & { owner: 'A' | 'B' }>();
  const baseWallet = await (tabs[0] as Tab).dev.store.db.wallets.orderBy('sortOrder').first();
  if (!baseWallet) throw new Error('нет кошелька');
  // кошелёк по умолчанию общий и правится только через затравку; операции в нём создают оба владельца
  const shared = baseWallet.id;

  const steps = Number(process.env['ADV_STEPS'] ?? 70);
  for (let step = 0; step < steps; step++) {
    const tab = pick(tabs);
    const roll = rand();
    try {
      if (roll < 0.28) {
        const walletId = rand() < 0.3 && [...wallets].some(([, o]) => o === tab.owner) ? pick([...wallets].filter(([, o]) => o === tab.owner))[0] : shared;
        const row = await tab.dev.store.transactions.create({
          kind: 'expense',
          walletId,
          amountMinor: 100 + Math.floor(rand() * 5000),
          occurredOn: '2026-10-05',
          note: `s${seed}-${step}`,
        });
        expected.set(row.id, { owner: tab.owner, walletId: row.walletId, amountMinor: row.amountMinor, note: row.note, deleted: false });
      } else if (roll < 0.36) {
        const w = await tab.dev.store.wallets.create({
          name: `К${seed}-${step}`,
          currency: 'TJS',
          kind: 'cash',
          openingBalanceMinor: 0,
          color: '#111111',
          icon: 'w',
        });
        wallets.set(w.id, tab.owner);
      } else if (roll < 0.5) {
        const mine = [...expected].filter(([, e]) => e.owner === tab.owner && !e.deleted);
        if (mine.length > 0) {
          const [id, e] = pick(mine);
          const amountMinor = 100 + Math.floor(rand() * 5000);
          const row = await tab.dev.store.transactions.update(id, { amountMinor, note: `e${step}` });
          expected.set(id, { ...e, amountMinor: row.amountMinor, note: row.note });
        }
      } else if (roll < 0.58) {
        const mine = [...expected].filter(([, e]) => e.owner === tab.owner && !e.deleted);
        if (mine.length > 0) {
          const [id, e] = pick(mine);
          await tab.dev.store.transactions.softDelete(id);
          expected.set(id, { ...e, deleted: true });
        }
      } else if (roll < 0.7) {
        await tab.dev.engine.syncNow();
      } else if (roll < 0.76) {
        server.failNext(pick(['network', 'server', 'auth'] as const), 1 + Math.floor(rand() * 2));
      } else if (roll < 0.82) {
        tab.sp.loseResponses = 1 + Math.floor(rand() * 2);
      } else if (roll < 0.86) {
        server.setLatency(Math.floor(rand() * 3));
      } else if (roll < 0.9) {
        server.setOnline(rand() < 0.5);
      } else {
        // вкладку «убили» посреди цикла: движок и база закрыты без предупреждения, потом открываются заново
        void tab.dev.engine.syncNow();
        await turns(1 + Math.floor(rand() * 40));
        tab.dev.engine.dispose();
        tab.dev.store.close();
        const fresh = await openTab(server, tab.owner, tab.deviceId, tab.factory);
        tabs[tabs.indexOf(tab)] = fresh;
      }
    } catch (e) {
      // отказ репозитория (например, проверка данных) — не поломка синхронизации; но всё прочее должно быть видно
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Настройки ещё не созданы|не найден|удалён/.test(msg)) throw e;
    }
    await sleep(2);
  }

  // всё восстановилось: сеть есть, задержек нет, одноразовые сбои выпиты
  server.setOnline(true);
  server.setLatency(0);
  for (const t of tabs) t.sp.loseResponses = 0;
  for (let round = 0; round < 6; round++) {
    for (const t of tabs) {

      await t.dev.engine.syncNow();
    }
  }

  // проверка
  if (process.env['ADV_VERBOSE']) console.log(`seed ${seed}: операций ${expected.size}, удалено ${[...expected.values()].filter((e) => e.deleted).length}`);
  for (const [id, e] of expected) {
    const onServer = server.dump(USER, 'transactions').find((r) => r['id'] === id);
    const label = `seed ${seed}, операция ${id.slice(0, 8)} (${e.note})`;
    expect(onServer, `${label}: нет на сервере`).toBeDefined();
    expect(onServer?.['amount_minor'], `${label}: сумма на сервере`).toBe(e.amountMinor);
    expect(onServer?.['note'], `${label}: заметка на сервере`).toBe(e.note);
    expect(onServer?.['deleted_at'] !== null, `${label}: удалена на сервере`).toBe(e.deleted);
    for (const t of tabs) {
      const local = await t.dev.store.db.transactions.get(id);
      expect(local, `${label}: нет на устройстве ${t.deviceId}`).toBeDefined();
      expect(local?.amountMinor, `${label}: сумма на ${t.deviceId}`).toBe(e.amountMinor);
      expect(local?.note, `${label}: заметка на ${t.deviceId}`).toBe(e.note);
      expect(local?.deletedAt !== null, `${label}: удалена на ${t.deviceId}`).toBe(e.deleted);
    }
  }
  for (const t of tabs) {
    const st = t.dev.engine.getStatus();
    expect({ seed, dev: t.deviceId, pending: st.pending, quarantined: st.quarantined, phase: st.phase }).toEqual({
      seed,
      dev: t.deviceId,
      pending: 0,
      quarantined: 0,
      phase: 'idle',
    });
  }
}

const SEEDS = Number(process.env['ADV_SEEDS'] ?? 12);

describe('случайные сбои: ничего не теряется и не задваивается', () => {
  for (let i = 1; i <= SEEDS; i++) {
    it(`seed ${i}`, async () => {
      await scenario(i * 7919);
    }, 120_000);
  }
});
