// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, fakeAuthClient, ALICE, renderAppRoot } from '@/app/testkit';
import type { SessionDeps } from '@/app/deps';
import { act } from '@/components/testUtils';
import { pinToday, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import AutoPostRunner from '@/features/recurring/AutoPostRunner';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer } from '@/sync/memoryServer';
import { openDevice, type Device } from '../../tests/sync/engineHarness';
import { resetAutoPostState } from './autoPostState';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

/**
 * Атака «второе устройство открылось раньше, чем успело синхронизироваться» — на НАСТОЯЩЕМ AutoPostRunner и настоящем движке.
 * Ноутбук давно не открывали; на телефоне человек пропустил платёж / поправил сумму. Ноутбук открывают в день платежа: сеть
 * отвечает не мгновенно, а проход автопроведения идёт сразу при открытии — по устаревшим данным.
 * Правильное поведение: сначала узнать, что уже решил человек на другом устройстве, и только потом проводить.
 */

const DUE = '2026-10-15'; // pinToday: четверг 15 октября 2026, полдень
const PHONE_AT = Date.UTC(2026, 9, 10, 12, 0, 0);

beforeEach(() => {
  pinToday();
  resetAutoPostState();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

async function setup() {
  const server = createMemoryServer({ now: () => Date.now() });
  const phoneClock = { t: PHONE_AT };
  const phone = await openDevice(server, 'phone', { seed: true, now: () => phoneClock.t });
  await phone.engine.syncNow();
  const laptop = await openDevice(server, 'laptop', { seed: true });
  await laptop.engine.syncNow();
  const cash = (await phone.store.db.wallets.orderBy('sortOrder').first())!;
  const rule = await phone.store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, frequency: 'monthly', startOn: DUE, note: 'Аренда', autoPost: 1 });
  for (let i = 0; i < 3; i++) {
    await phone.engine.syncNow();
    await laptop.engine.syncNow();
  }
  return { server, phone, phoneClock, laptop, rule };
}

/**
 * Открывает приложение на ноутбуке: его хранилище, настоящий движок. Сеть «закрыта» (запросы ждут), пока проход автопроведения
 * не отработал по локальным данным: так порядок «сначала проход, потом первая синхронизация» не зависит от загрузки машины.
 * Приложение, которое сначала ждёт первую синхронизацию, ничего не проведёт до открытия сети: тогда ждём не дольше 3 секунд.
 * Возвращает движок приложения.
 */
async function openLaptopApp(server: ReturnType<typeof createMemoryServer>, laptop: Device): Promise<SyncEngine> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let engine: SyncEngine | null = null;
  const deps: SessionDeps = {
    openStore: async () => laptop.store,
    createTransport: () => {
      const inner = server.transportFor(ALICE.id);
      return { ...inner, pull: async (...a) => (await gate, inner.pull(...a)), push: async (...a) => (await gate, inner.push(...a)) };
    },
    createEngine: (o) => (engine = createSyncEngine(o)),
    createRates: () => createRateService({ providers: [], storage: createMemoryRateStorage() }),
    deleteLocalData: async () => undefined,
    countLocalModeData: async () => 0,
  };
  const auth = fakeAuthClient({ session: ALICE });
  renderAppRoot(<AutoPostRunner />, { client: auth.client, deps });
  await eventually(() => {
    if (!engine) throw new Error('приложение ещё открывается');
  });
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && (await laptop.store.db.transactions.count()) === 0) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
  }
  release(); // сеть открылась: первая синхронизация идёт уже после прохода автопроведения
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1_000));
  });
  return engine!;
}

const live = async (d: Device) => (await d.store.db.transactions.toArray()).filter((t) => t.deletedAt === null).map((t) => t.amountMinor);

describe('AutoPostRunner на устройстве, которое открылось раньше первой синхронизации', () => {
  it('платёж, который человек пропустил на телефоне, не появляется в операциях после открытия ноутбука', async () => {
    const { server, phone, phoneClock, laptop, rule } = await setup();
    phoneClock.t = PHONE_AT + 1_000;
    await phone.store.transactions.skipOccurrence(rule.id, DUE);
    await phone.engine.syncNow();

    const engine = await openLaptopApp(server, laptop);
    for (let i = 0; i < 3; i++) {
      await engine.syncNow();
      await phone.engine.syncNow();
    }

    expect(await live(laptop), 'на ноутбуке пропущенный платёж стал операцией').toEqual([]);
    expect(await live(phone), 'на телефоне пропущенный платёж стал операцией').toEqual([]);
  }, 40_000);

  it('сумма, которую человек исправил на телефоне при «Провести», не затирается ноутбуком', async () => {
    const { server, phone, phoneClock, laptop, rule } = await setup();
    phoneClock.t = PHONE_AT + 1_000;
    await phone.store.transactions.createFromRule(rule.id, DUE, { amountMinor: 4_800 });
    await phone.engine.syncNow();

    const engine = await openLaptopApp(server, laptop);
    for (let i = 0; i < 3; i++) {
      await engine.syncNow();
      await phone.engine.syncNow();
    }

    expect(await live(phone), 'платёж записан по сумме правила, а не по той, что человек провёл').toEqual([4_800]);
    expect(await live(laptop)).toEqual([4_800]);
  }, 40_000);
  it('контроль: если ноутбук успел синхронизироваться ДО открытия приложения, пропуск сохраняется (тест настроен верно)', async () => {
    const { server, phone, phoneClock, laptop, rule } = await setup();
    phoneClock.t = PHONE_AT + 1_000;
    await phone.store.transactions.skipOccurrence(rule.id, DUE);
    await phone.engine.syncNow();
    await laptop.engine.syncNow(); // ноутбук узнал про пропуск заранее

    const engine = await openLaptopApp(server, laptop);
    for (let i = 0; i < 3; i++) {
      await engine.syncNow();
      await phone.engine.syncNow();
    }

    expect(await live(laptop)).toEqual([]);
    expect(await live(phone)).toEqual([]);
  }, 40_000);
});
