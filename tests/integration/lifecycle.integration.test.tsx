/**
 * Стыки жизненного цикла: выход посреди отправки, React.StrictMode (двойной запуск эффектов) на первой загрузке,
 * устройство с отстающими часами.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { ensureSeeded, openStore, type Store } from '@/db';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryServer } from '@/sync/memoryServer';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const text = () => document.body.textContent ?? '';

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('жизненный цикл приложения', () => {
  it('«Выйти» в тот момент, когда запись уже в пути: нет необработанных ошибок, после входа запись не потеряна и не задвоена', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const server = createMemoryServer();
      const td = makeTestDeps();
      const auth = fakeAuthClient({ session: ALICE });
      let release: () => void = () => undefined;
      let hold: Promise<void> | null = null;
      let entered: () => void = () => undefined;
      const inFlight = new Promise<void>((r) => (entered = r));
      td.deps.openStore = async (uid) => {
        const s = await openStore(uid, { deviceId: 'dev-a', dexie: { indexedDB: td.factory, IDBKeyRange } });
        td.stores.push(s);
        return s;
      };
      td.deps.createTransport = () => {
        const inner = server.transportFor(ALICE.id);
        return {
          currentUserId: () => inner.currentUserId(),
          pull: (t, a, l) => inner.pull(t, a, l),
          push: async (t, r) => {
            if (t === 'transactions' && hold) {
              entered();
              await hold;
            }
            await inner.push(t, r);
          },
        } as typeof inner;
      };
      td.deps.createEngine = (o) => createSyncEngine(o);
      renderAppRoot(<AppRoutes />, { client: auth.client, deps: td.deps, path: '/settings' });
      await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);
      const store = td.stores[0] as Store;
      const cash = (await store.db.wallets.toArray())[0]!;

      hold = new Promise<void>((r) => (release = r));
      await act(async () => void (await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 321, occurredOn: '2026-10-05', note: 'в-пути' })));
      // Ждём САМОГО события — запись дошла до сервера и застряла там. Раньше после 4 с тест шёл дальше и без этого: на загруженной
      // машине выходило, что «запись в пути» не проверялась вовсе. Теперь не дождались — тест честно падает.
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      try {
        await act(async () => {
          await Promise.race([
            inFlight,
            new Promise<never>((_, reject) => {
              giveUp = setTimeout(() => reject(new Error('запись так и не оказалась «в пути» за 30 с')), 30_000);
            }),
          ]);
        });
      } finally {
        clearTimeout(giveUp);
      }
      // отправка зависла на сервере; человек нажимает «Выйти» (очередь не пуста → подтверждение)
      // страница настроек грузится отдельным куском кода: на медленном устройстве кнопка появляется позже бейджа в шапке
      await user.click(await findByRole('button', { name: 'Выйти' }));
      await findByRole('alertdialog', { name: 'Не всё отправлено в облако' });
      await user.click(screen.getByRole('button', { name: 'Всё равно выйти' }));
      await waitFor(() => screen.getByRole('heading', { name: 'Вход' }));
      hold = null;
      release(); // ответ сервера приходит уже после выхода
      await act(async () => void (await new Promise((r) => setTimeout(r, 200))));

      // вошли снова: запись цела, на сервере ровно одна
      await user.type(screen.getByRole('textbox', { name: /Почта/ }), ALICE.email);
      await user.type(document.querySelector<HTMLInputElement>('input[type="password"]')!, ALICE.password);
      await user.click(screen.getByRole('button', { name: 'Войти' }));
      await waitFor(() => screen.getByRole('heading', { name: 'Настройки', level: 1 }), 15_000);
      await eventually(() => expect(server.dump(ALICE.id, 'transactions')).toHaveLength(1), 15_000);
      const store2 = td.stores[td.stores.length - 1] as Store;
      await eventually(async () => expect((await store2.sync.counts()).pending).toBe(0), 15_000);
      expect((await store2.db.transactions.toArray()).map((t) => t.note)).toEqual(['в-пути']);
      expect(unhandled.map(String)).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 60_000);

  it('React.StrictMode на первой загрузке: на сервере по одному экземпляру затравки, работает один движок', async () => {
    const server = createMemoryServer();
    const td = makeTestDeps();
    const engines: SyncEngine[] = [];
    td.deps.createTransport = () => server.transportFor(ALICE.id);
    td.deps.createEngine = (o) => {
      const e = createSyncEngine(o);
      engines.push(e);
      return e;
    };
    renderAppRoot(<AppRoutes />, { client: fakeAuthClient({ session: ALICE }).client, deps: td.deps, path: '/', strict: true });
    await waitFor(() => screen.getByRole('heading', { name: 'Главная', level: 1 }), 15_000);
    await waitFor(() => expect(text()).toMatch(/Синхронизировано/), 15_000);
    expect([server.dump(ALICE.id, 'settings').length, server.dump(ALICE.id, 'wallets').length, server.dump(ALICE.id, 'categories').length]).toEqual([1, 1, 17]);
    const live = td.stores.at(-1) as Store;
    expect(await live.db.wallets.count()).toBe(1);
    expect(await live.db.categories.count()).toBe(17);
    expect((await live.sync.counts()).pending).toBe(0);
  }, 30_000);
});

describe('устройство с неверными часами', () => {
  it('часы телефона отстают на 2 часа: после правки существующей записи телефон, ноутбук и сервер обязаны показывать одно и то же', async () => {
    const server = createMemoryServer();
    const mk = async (id: string, now?: () => number) => {
      const store = await openStore(ALICE.id, { deviceId: id, now, dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
      const engine = createSyncEngine({ store, now, transport: server.transportFor(ALICE.id), afterFirstPull: async () => void (await ensureSeeded(store)) });
      return { store, engine };
    };
    const laptop = await mk('laptop');
    await laptop.engine.syncNow();
    const cash = (await laptop.store.db.wallets.toArray())[0]!;
    const tx = await laptop.store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500_00, occurredOn: '2026-10-05', note: 'аренда' });
    await laptop.engine.syncNow();

    const phone = await mk('phone', () => Date.now() - 2 * 3_600_000); // часы встали на 2 часа назад
    await phone.engine.syncNow();
    expect((await phone.store.db.transactions.get(tx.id))?.note).toBe('аренда');
    await phone.store.transactions.update(tx.id, { amountMinor: 450_00, note: 'аренда (скидка)' });
    for (let i = 0; i < 2; i++) {
      await phone.engine.syncNow();
      await laptop.engine.syncNow();
    }

    const view = async (s: Store) => {
      const r = (await s.db.transactions.get(tx.id))!;
      return `${r.amountMinor}|${r.note}`;
    };
    const onServer = server.dump(ALICE.id, 'transactions').find((r) => r['id'] === tx.id)!;
    const seen = { телефон: await view(phone.store), ноутбук: await view(laptop.store), сервер: `${onServer['amount_minor']}|${onServer['note']}` };
    expect(
      new Set(Object.values(seen)).size,
      `устройства расходятся навсегда и молча: ${JSON.stringify(seen)}; сервер проигнорировал правку со старой меткой, а телефон счёл её отправленной`,
    ).toBe(1);
    expect((await phone.store.sync.counts()).pending).toBe(0);
  }, 30_000);
});
