/**
 * ЛОМАТЕЛЬ: сборка сеанса (src/app). Настоящий движок + сервер в памяти + подменный вход.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { useWallets } from '@/db';
import { AccountSection } from '@/features/settings/AccountSection';
import { createSyncEngine } from '@/sync/engine';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import type { SyncTransport } from '@/sync/transport';
import { ALICE, BOB, eventually, fakeAuthClient, makeTestDeps, renderAppRoot, write, type TestDeps } from './testkit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

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

/** Транспорт, который, как настоящий клиент Supabase, ходит под ТЕКУЩЕЙ сессией (кто сейчас вошёл — тот и владелец запроса). */
function liveTransport(server: MemoryServer, who: () => string | undefined): SyncTransport {
  const cur = () => server.transportFor(who() ?? '00000000-0000-4000-8000-000000000000');
  return { pull: (t, a, l) => cur().pull(t, a, l), push: (t, r) => cur().push(t, r) };
}

function device(server: MemoryServer, who: () => string | undefined): TestDeps {
  const td = makeTestDeps();
  td.deps.createTransport = () => liveTransport(server, who);
  td.deps.createEngine = (opts) => createSyncEngine(opts);
  return td;
}

const tick = (ms = 30) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function signInUi(email: string, password: string) {
  await user.type(await findByRole('textbox', { name: 'Почта' }), email);
  const pass = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!pass) throw new Error('нет поля пароля');
  await user.type(pass, password);
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ATTACK: «Выйти и удалить данные с этого устройства»', () => {
  it('после удаления база Алисы действительно исчезла и не воскресла; повторный вход возвращает ТЕ ЖЕ данные без дублей', async () => {
    const server = createMemoryServer();
    const fake = fakeAuthClient({ session: ALICE });
    const td = device(server, () => fake.current?.id);
    renderAppRoot(
      <>
        <AccountSection />
        <WalletNames />
      </>,
      { client: fake.client, deps: td.deps },
    );
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument(), 8000);
    const store = td.stores[0]!;
    await write(() =>
      store.wallets.create({ name: 'Копилка', currency: 'USD', kind: 'savings', openingBalanceMinor: 777_00, color: '#2563eb', icon: '🪙' }),
    );
    await eventually(async () => {
      expect((await store.sync.counts()).pending).toBe(0);
      expect(server.dump(ALICE.id, 'wallets')).toHaveLength(2);
    }, 8000);

    // Кнопка включается, когда СТАТУС синхронизации показал «всё отправлено» — он обновляется чуть позже, чем база; человек это ждёт.
    const wipe = () => screen.getByRole('button', { name: 'Выйти и удалить данные с этого устройства' });
    await waitFor(() => expect(wipe()).toBeEnabled(), 8000);
    await user.click(wipe());
    await user.click(await findByRole('button', { name: 'Выйти и удалить' }));
    await findByRole('heading', { name: 'Вход', level: 1 });
    await tick(300);

    expect(td.deleted).toEqual([ALICE.id]);
    const names = (await td.factory.databases()).map((d) => d.name);
    expect(names, 'после удаления с устройства не должно остаться базы Алисы (даже пустой, пересозданной живым запросом)').not.toContain(`finora-v1-${ALICE.id}`);

    // тот же человек возвращается
    await signInUi(ALICE.email, ALICE.password);
    await waitFor(() => expect(screen.getByText('Копилка')).toBeInTheDocument(), 8000);
    expect(screen.getAllByText('Наличные')).toHaveLength(1);
    expect(screen.getAllByText('Копилка')).toHaveLength(1);
    expect(server.dump(ALICE.id, 'wallets')).toHaveLength(2);
  }, 40_000);
});

describe('ATTACK: на одном устройстве входит другой человек', () => {
  it('данные Алисы не попадают ни в базу Боба, ни в облако Боба (даже если у Алисы были неотправленные записи)', async () => {
    const server = createMemoryServer();
    const fake = fakeAuthClient({ session: ALICE });
    const td = device(server, () => fake.current?.id);
    renderAppRoot(<WalletNames />, { client: fake.client, deps: td.deps });
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument(), 8000);
    await eventually(() => expect(server.dump(ALICE.id, 'wallets')).toHaveLength(1), 8000);

    // сеть пропала, Алиса внесла секретный кошелёк (остался неотправленным)
    server.setOnline(false);
    const aliceStore = td.stores[0]!;
    await write(() =>
      aliceStore.wallets.create({ name: 'ТАЙНА-АЛИСЫ', currency: 'TJS', kind: 'cash', openingBalanceMinor: 5_000_00, color: '#2563eb', icon: '💵' }),
    );
    expect((await aliceStore.sync.counts()).pending).toBeGreaterThan(0);

    // на устройстве входит Боб (например, жена/брат), сеть вернулась
    server.setOnline(true);
    await act(async () => {
      fake.setSession(BOB);
      fake.emit('SIGNED_IN', BOB);
    });
    await waitFor(() => expect(screen.queryByText('ТАЙНА-АЛИСЫ')).toBeNull());
    await tick(1500);

    const bobWallets = server.dump(BOB.id, 'wallets').map((r) => r['name']);
    expect(bobWallets, 'в облако Боба не должно попасть ничего от Алисы').not.toContain('ТАЙНА-АЛИСЫ');
    const bobStore = td.stores[td.stores.length - 1]!;
    expect(bobStore.userId).toBe(BOB.id);
    const local = (await bobStore.db.wallets.toArray()).map((w) => w.name);
    expect(local).not.toContain('ТАЙНА-АЛИСЫ');
    expect(screen.queryByText('ТАЙНА-АЛИСЫ')).toBeNull();

    // Боб ушёл, вернулась Алиса: её неотправленный кошелёк уходит в ЕЁ облако ровно один раз
    await act(async () => {
      fake.setSession(ALICE);
      fake.emit('SIGNED_IN', ALICE);
    });
    await eventually(
      () => expect(server.dump(ALICE.id, 'wallets').filter((r) => r['name'] === 'ТАЙНА-АЛИСЫ')).toHaveLength(1),
      8000,
    );
    expect(server.dump(BOB.id, 'wallets').map((r) => r['name'])).not.toContain('ТАЙНА-АЛИСЫ');
  }, 40_000);
});
