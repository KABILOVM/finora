/**
 * Атака 8. Курсы + операции: операция в чужой валюте, курс обновился, операцию правят (сумма/заметка) — снимок не переоценивается;
 * смена основной валюты — старые операции остаются в прежней, итоги не смешивают валюты молча. Через интерфейс и два устройства.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, pick, renderAppRoot } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { ensureSeeded, openStore, type Store } from '@/db';
import { tapAmount, RATES_NOW, table } from '@/features/transactions/__fixtures__/opsKit';
import { todayLocal } from '@/lib/dates';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const text = () => document.body.textContent ?? '';
const rates = (usd: number) =>
  createRateService({
    providers: [],
    storage: createMemoryRateStorage({ v: 1, tables: [table({ perUnit: { TJS: 1, USD: usd, EUR: 12 } })], manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError: null }),
    now: () => RATES_NOW,
  });

/** Устройство с интерфейсом; cloud=null — локальный режим. */
function uiDevice(server: MemoryServer | null, deviceId: string, usd: number) {
  const td = makeTestDeps();
  const engines: SyncEngine[] = [];
  td.deps.openStore = async (uid) => {
    const s = await openStore(uid, { deviceId, dexie: { indexedDB: td.factory, IDBKeyRange } });
    td.stores.push(s);
    return s;
  };
  td.deps.createRates = () => rates(usd);
  if (server) {
    td.deps.createTransport = () => server.transportFor(ALICE.id);
    td.deps.createEngine = (o) => {
      const e = createSyncEngine(o);
      engines.push(e);
      return e;
    };
  }
  return { td, engines, client: server ? fakeAuthClient({ session: ALICE }).client : null };
}

async function openUi(d: ReturnType<typeof uiDevice>, path: string, heading: string) {
  renderAppRoot(<AppRoutes />, { client: d.client, deps: d.td.deps, path });
  await waitFor(() => screen.getByRole('heading', { name: heading, level: 1 }), 15_000);
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 10_000);
  return d.td.stores[0] as Store;
}

async function usdWalletWithExpense(store: Store, usdAmount: number, rate: number, note: string) {
  const w = await store.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 1_000_00, color: '#2563eb', icon: '💲' });
  const tx = await store.transactions.create({
    kind: 'expense',
    walletId: w.id,
    amountMinor: usdAmount * 100,
    occurredOn: todayLocal(),
    note,
    fx: { rate, source: 'nbt' },
  });
  return { w, tx };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const snap = (t: { baseCurrency: string; baseAmountMinor: number; fxRate: number | null; fxSource: string | null }) => [t.baseCurrency, t.baseAmountMinor, t.fxRate, t.fxSource];

describe('атака 8: курсы, снимки и основная валюта', () => {
  it('курс вырос до 11,5; правка ЗАМЕТКИ не трогает снимок; правка СУММЫ идёт по курсу дня внесения (как и сказано в окне)', async () => {
    const d = uiDevice(null, 'dev-a', 11.5);
    // подготовка данных ДО открытия интерфейса: операция внесена по курсу 10,9
    const open = d.td.deps.openStore;
    let txId = '';
    d.td.deps.openStore = async (uid) => {
      const s = await open(uid);
      await ensureSeeded(s);
      txId = (await usdWalletWithExpense(s, 10, 10.9, 'кофе-в-долларах')).tx.id;
      return s;
    };
    const store = await openUi(d, '/transactions', 'Операции');
    const before = (await store.db.transactions.get(txId))!;
    expect(snap(before)).toEqual(['TJS', 109_00, 10.9, 'nbt']);

    // правка заметки
    await user.click(await waitFor(() => screen.getByText(/кофе-в-долларах/)));
    await findByRole('dialog', { name: 'Правка операции' });
    expect(document.querySelector('[data-testid="fx-notice"]')?.textContent).toMatch(/10,9/);
    expect(document.querySelector('[data-testid="fx-notice"]')?.textContent).not.toMatch(/11,5/);
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), '!');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(async () => expect((await store.db.transactions.get(txId))?.note).toBe('кофе-в-долларах!'));
    expect(snap((await store.db.transactions.get(txId))!)).toEqual(snap(before));

    // правка суммы 10 → 20 $
    await user.click(await waitFor(() => screen.getByText(/кофе-в-долларах!/)));
    await findByRole('dialog', { name: 'Правка операции' });
    await user.clear(screen.getByRole('textbox', { name: /^Сумма/ }));
    await tapAmount('20');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(async () => expect((await store.db.transactions.get(txId))?.amountMinor).toBe(20_00));
    const after = (await store.db.transactions.get(txId))!;
    expect(snap(after)).toEqual(['TJS', 218_00, 10.9, 'nbt']);
  }, 60_000);

  it('два устройства: курсы у них разные (10,9 и 11,5); правка заметки на втором устройстве не меняет снимок, суммы месяца на обоих равны', async () => {
    const server = createMemoryServer();
    const a = uiDevice(server, 'dev-a', 10.9);
    const storeA = await openUi(a, '/', 'Главная');
    await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);
    const { tx } = await usdWalletWithExpense(storeA, 10, 10.9, 'для-синхронизации');
    await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(1), 15_000);

    // устройство B с «новым» курсом 11,5: получает операцию и правит заметку и дату
    const factory = new IDBFactory();
    const storeB = await openStore(ALICE.id, { deviceId: 'dev-b', dexie: { indexedDB: factory, IDBKeyRange } });
    const engB = createSyncEngine({ store: storeB, transport: server.transportFor(ALICE.id), afterFirstPull: async () => void (await ensureSeeded(storeB)) });
    await engB.syncNow();
    await storeB.transactions.update(tx.id, { note: 'правка-на-B' });
    await engB.syncNow();
    await a.engines[0]!.syncNow();
    const rowA = (await storeA.db.transactions.get(tx.id))!;
    const rowB = (await storeB.db.transactions.get(tx.id))!;
    expect(rowA.note).toBe('правка-на-B');
    expect(snap(rowA)).toEqual(['TJS', 109_00, 10.9, 'nbt']);
    expect(snap(rowB)).toEqual(snap(rowA));
    expect(server.dump(ALICE.id, 'transactions')[0]?.['base_amount_minor']).toBe(109_00);
    engB.dispose();
    storeB.close();
  }, 60_000);

  it('смена основной валюты TJS→USD через «Настройки»: старые операции остаются в сомони, итоги месяца их не смешивают и честно говорят «Не учтено»; на втором устройстве то же', async () => {
    const server = createMemoryServer();
    const a = uiDevice(server, 'dev-a', 10.9);
    const open = a.td.deps.openStore;
    a.td.deps.openStore = open; // база открывается обычным путём, данные заводим после первой загрузки
    const storeA = await openUi(a, '/settings', 'Настройки');
    await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);
    const cash = (await storeA.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
    const today = todayLocal();
    await storeA.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 300_00, occurredOn: today, note: 'старый-расход' });
    const usdW = await storeA.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' });
    await storeA.transactions.create({ kind: 'expense', walletId: usdW.id, amountMinor: 10_00, occurredOn: today, note: 'старый-в-долларах', fx: { rate: 10.9, source: 'nbt' } });

    // меняем основную валюту так, как человек
    await waitFor(() => screen.getByRole('combobox', { name: /Основная валюта/ }));
    pick(screen.getByRole('combobox', { name: /Основная валюта/ }), 'USD');
    await findByRole('alertdialog', { name: 'Сменить валюту учёта на USD?' });
    await user.click(screen.getByRole('button', { name: 'Сменить' }));
    await eventually(async () => expect((await storeA.settings.get())?.baseCurrency).toBe('USD'));

    // новая операция в долларовом кошельке: теперь это основная валюта
    await storeA.transactions.create({ kind: 'expense', walletId: usdW.id, amountMinor: 5_00, occurredOn: today, note: 'новый-в-долларах' });
    const fresh = (await storeA.db.transactions.toArray()).find((t) => t.note === 'новый-в-долларах')!;
    expect(snap(fresh)).toEqual(['USD', 5_00, 1, 'same']);
    const olds = (await storeA.db.transactions.toArray()).filter((t) => t.note.startsWith('старый'));
    expect(olds.map((t) => t.baseCurrency)).toEqual(['TJS', 'TJS']);
    expect(olds.map((t) => t.baseAmountMinor).sort((x, y) => x - y)).toEqual([109_00, 300_00]);

    // главная: итоги месяца только в USD, про остальное сказано вслух
    await user.click(screen.getAllByRole('link', { name: 'Главная' })[0] as HTMLElement);
    await waitFor(() => screen.getByRole('heading', { name: 'Главная', level: 1 }));
    const month = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[aria-label="Итоги месяца"]');
      if (!el) throw new Error('нет карточки итогов');
      return el;
    });
    await waitFor(() => expect(month.textContent).toMatch(/Не учтено 2 операции/));
    expect(month.textContent).toMatch(/в другой основной валюте/);
    const expenses = Array.from(month.querySelectorAll('div')).find((n) => n.querySelector('dt')?.textContent === 'Расходы')!;
    expect(expenses.textContent).toMatch(/5/);
    expect(expenses.textContent).not.toMatch(/300|109|409/);

    // второе устройство получает те же снимки
    await eventually(async () => expect((await storeA.sync.counts()).pending).toBe(0), 15_000);
    const factory = new IDBFactory();
    const storeB = await openStore(ALICE.id, { deviceId: 'dev-b', dexie: { indexedDB: factory, IDBKeyRange } });
    const engB = createSyncEngine({ store: storeB, transport: server.transportFor(ALICE.id), afterFirstPull: async () => void (await ensureSeeded(storeB)) });
    await engB.syncNow();
    expect((await storeB.settings.get())?.baseCurrency).toBe('USD');
    const byNote = async (s: Store) => Object.fromEntries((await s.db.transactions.toArray()).map((t) => [t.note, snap(t)]));
    expect(await byNote(storeB)).toEqual(await byNote(storeA));
    engB.dispose();
    storeB.close();
  }, 90_000);
});
