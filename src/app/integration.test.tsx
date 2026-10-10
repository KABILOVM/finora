/**
 * Сборка приложения с НАСТОЯЩИМ движком синхронизации и сервером в памяти (никакой сети).
 * Проверяет договор между src/app и src/sync: первая загрузка, затравка после неё, отсутствие дублей на втором устройстве.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWallets } from '@/db';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { createSyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { ALICE, eventually, fakeAuthClient, makeTestDeps, renderAppRoot, write, type TestDeps } from './testkit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const Marker = () => <div>ПРИЛОЖЕНИЕ ГОТОВО</div>;
function WalletNames() {
  const wallets = useWallets({ includeArchived: true });
  return (
    <ul aria-label="Кошельки">
      {(wallets ?? []).map((w) => (
        <li key={w.id}>{w.name}</li>
      ))}
    </ul>
  );
}

/** «Устройство»: свои зависимости (своя база) + настоящий движок, ходящий на общий сервер в памяти. */
function device(server: MemoryServer): TestDeps {
  const td = makeTestDeps();
  td.deps.createTransport = () => server.transportFor(ALICE.id);
  td.deps.createEngine = (opts) => createSyncEngine(opts);
  return td;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('настоящий движок + сервер в памяти', () => {
  it('первая загрузка → затравка → отправка; второе устройство получает те же данные БЕЗ дублей', async () => {
    const server = createMemoryServer();
    const a = device(server);
    const first = renderAppRoot(<WalletNames />, { client: fakeAuthClient({ session: ALICE }).client, deps: a.deps });
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
    await eventually(() => expect(server.dump(ALICE.id, 'wallets').map((r) => r['name'])).toEqual(['Наличные']), 8000);
    await write(() =>
      (a.stores[0] as NonNullable<(typeof a.stores)[number]>).wallets.create({
        name: 'Кошелёк Алисы',
        currency: 'USD',
        kind: 'card',
        openingBalanceMinor: 12_300,
        color: '#2563eb',
        icon: '💳',
      }),
    );
    await eventually(() => expect(server.dump(ALICE.id, 'wallets').map((r) => r['name']).sort()).toEqual(['Кошелёк Алисы', 'Наличные']), 8000);
    first.unmount();

    // второе устройство того же человека: чистая база
    const b = device(server);
    renderAppRoot(<WalletNames />, { client: fakeAuthClient({ session: ALICE }).client, deps: b.deps });
    await waitFor(() => expect(screen.getByText('Кошелёк Алисы')).toBeInTheDocument(), 8000);
    expect(screen.getAllByText('Наличные')).toHaveLength(1);
    const walletsB = await (b.stores[0] as NonNullable<(typeof b.stores)[number]>).db.wallets.toArray();
    expect(walletsB.map((w) => w.name).sort()).toEqual(['Кошелёк Алисы', 'Наличные']);
    // затравка на втором устройстве не создавала НОВЫХ строк: на сервере по-прежнему 2 кошелька
    expect(server.dump(ALICE.id, 'wallets')).toHaveLength(2);
    expect(server.dump(ALICE.id, 'settings')).toHaveLength(1);
  }, 30_000);

  it('нет сети на первой загрузке: экран «Нужен интернет…», приложение закрыто; сеть вернулась → «Повторить» открывает', async () => {
    const server = createMemoryServer();
    server.setOnline(false);
    const b = device(server);
    renderAppRoot(<Marker />, { client: fakeAuthClient({ session: ALICE }).client, deps: b.deps });
    expect(await findByRole('heading', { name: 'Нужен интернет для первой загрузки' })).toBeInTheDocument();
    expect(screen.queryByText('ПРИЛОЖЕНИЕ ГОТОВО')).toBeNull();
    // пока данные не загружены, локальная база не засеяна: нет риска дублей
    expect(await (b.stores[0] as NonNullable<(typeof b.stores)[number]>).settings.get()).toBeNull();

    server.setOnline(true);
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByText('ПРИЛОЖЕНИЕ ГОТОВО')).toBeInTheDocument(), 8000);
    expect((await (b.stores[0] as NonNullable<(typeof b.stores)[number]>).settings.get())?.baseCurrency).toBe('TJS');
    await eventually(() => expect(server.dump(ALICE.id, 'settings')).toHaveLength(1), 8000);
  }, 30_000);

  it('локальный режим не создаёт движок синхронизации вообще', async () => {
    const a = makeTestDeps();
    const createEngine = vi.fn(a.deps.createEngine);
    a.deps.createEngine = createEngine;
    renderAppRoot(<Marker />, { deps: a.deps });
    await waitFor(() => expect(screen.getByText('ПРИЛОЖЕНИЕ ГОТОВО')).toBeInTheDocument());
    await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
    expect(createEngine).not.toHaveBeenCalled();
  });
});
