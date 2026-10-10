import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeLastUser } from '@/auth/lastUser';
import { ALICE, BOB, eventually, fakeAuthClient, makeTestDeps, renderAppRoot, write, type FakeAuthOptions, type TestDeps } from '@/app/testkit';
import { HeaderStatus } from '@/app/HeaderStatus';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { SYNC_TABLES } from '@/sync/tables';
import SettingsPage from './SettingsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

/** Помечает всё на устройстве как принятое сервером (в этих тестах настоящего сервера нет). */
async function markAllPushed(store: Store): Promise<void> {
  for (const table of SYNC_TABLES) {
    const rows = await store.sync.listDirty(table, 10_000);
    await store.sync.markPushed(
      table,
      rows.map((r) => ({ id: r.id, clientUpdatedAt: r.clientUpdatedAt, deviceId: r.deviceId })),
    );
  }
}

async function openCloudSettings(opts: { auth?: FakeAuthOptions; td?: TestDeps; bootTimeoutMs?: number } = {}) {
  const td = opts.td ?? makeTestDeps();
  const fake = fakeAuthClient({ session: ALICE, ...opts.auth });
  renderAppRoot(<SettingsPage />, { client: fake.client, deps: td.deps, path: '/settings', bootTimeoutMs: opts.bootTimeoutMs });
  await findByRole('heading', { name: 'Настройки', level: 1 });
  await waitFor(() => expect(td.stores.length).toBeGreaterThan(0));
  const engine = () => {
    const e = td.engines.at(-1);
    if (!e) throw new Error('Движок не создан');
    return e;
  };
  const store = () => {
    const s = td.stores.at(-1);
    if (!s) throw new Error('Хранилище не открыто');
    return s;
  };
  return { td, fake, engine, store };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Настройки: аккаунт', () => {
  it('показывает почту и не показывает плашку «Облако не подключено»', async () => {
    await openCloudSettings();
    expect(screen.getByText(ALICE.email)).toBeInTheDocument();
    expect(screen.queryByText('Облако не подключено.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });

  it('выход, когда всё отправлено: сразу на экран входа; локальная база СОХРАНЕНА', async () => {
    const { td, store, fake } = await openCloudSettings();
    await eventually(async () => expect(await store().sync.getMeta('initialPullDone')).toBe(true));
    await markAllPushed(store());
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(await findByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
    expect(fake.calls.signOutArgs).toEqual([{ scope: 'local' }]);
    expect(td.deleted).toEqual([]); // ничего не удалено
    const reopened = await td.deps.openStore(ALICE.id);
    expect((await reopened.db.wallets.toArray()).map((w) => w.name)).toEqual(['Наличные']);
    reopened.close();
  });

  it('выход с неотправленными записями: честное предупреждение; «Отмена» оставляет в аккаунте', async () => {
    const { store, fake } = await openCloudSettings();
    await eventually(async () => expect((await store().sync.counts()).pending).toBeGreaterThan(0)); // затравка ещё не отправлена
    const pending = (await store().sync.counts()).pending;
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    const dialog = await findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Не всё отправлено в облако');
    expect(dialog).toHaveTextContent(`Не отправлено: ${pending}`);
    expect(dialog).toHaveTextContent('в облако не попадут, пока вы снова не войдёте под этой же почтой');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(fake.calls.signOut).toBe(0);
    expect(screen.getByText(ALICE.email)).toBeInTheDocument();
  });

  it('выход с неотправленными записями после подтверждения: вышли, но записи на устройстве остались', async () => {
    const { td, store } = await openCloudSettings();
    await eventually(async () => expect((await store().sync.counts()).pending).toBeGreaterThan(0));
    await write(() =>
      store().wallets.create({ name: 'Не успел отправить', currency: 'TJS', kind: 'cash', openingBalanceMinor: 1, color: '#000000', icon: '💰' }),
    );
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Всё равно выйти' }));
    expect(await findByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
    const reopened = await td.deps.openStore(ALICE.id);
    expect((await reopened.db.wallets.toArray()).map((w) => w.name)).toContain('Не успел отправить');
    expect((await reopened.sync.counts()).pending).toBeGreaterThan(0); // и всё ещё ждут отправки
    reopened.close();
  });

  it('отвергнутые сервером записи тоже считаются «неотправленными»', async () => {
    const { store } = await openCloudSettings();
    await eventually(async () => expect((await store().sync.counts()).pending).toBeGreaterThan(0));
    const wallet = (await store().db.wallets.toArray())[0];
    await store().sync.quarantine('wallets', [wallet?.id ?? ''], 'нарушено ограничение');
    await markAllPushed(store());
    expect(await store().sync.counts()).toMatchObject({ pending: 0, quarantined: 1 });
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    const dialog = await findByRole('alertdialog');
    expect(dialog).toHaveTextContent('сервер не принял ещё 1 запись');
  });

  it('«Выйти и удалить данные» недоступно, пока статус показывает неотправленное', async () => {
    const { engine } = await openCloudSettings();
    act(() => engine().set({ pending: 3 }));
    const wipe = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'Выйти и удалить данные с этого устройства' });
      expect(b).toBeDisabled();
      return b;
    });
    expect(wipe).toBeDisabled();
    expect(screen.getByText(/Недоступно, пока не всё отправлено в облако/)).toBeInTheDocument();
  });

  it('«Выйти и удалить»: статус «чисто», но в базе есть неотправленное → отказ с объяснением, ничего не удалено', async () => {
    const { td, store, fake } = await openCloudSettings();
    await eventually(async () => expect((await store().sync.counts()).pending).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'Выйти и удалить данные с этого устройства' }));
    expect(await waitFor(() => screen.getByText(/Есть неотправленные записи: удалять данные с устройства нельзя/))).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(td.deleted).toEqual([]);
    expect(fake.calls.signOut).toBe(0);
  });

  it('«Выйти и удалить»: всё отправлено → подтверждение → вышли, база ЭТОГО пользователя удалена, чужая цела', async () => {
    const td = makeTestDeps();
    const bob = await td.deps.openStore(BOB.id);
    await bob.settings.ensure({ baseCurrency: 'TJS' });
    await bob.wallets.create({ name: 'Кошелёк Боба', currency: 'TJS', kind: 'cash', openingBalanceMinor: 7, color: '#000000', icon: '💰' });
    bob.close();

    const { store, fake } = await openCloudSettings({ td });
    await eventually(async () => expect(await store().sync.getMeta('initialPullDone')).toBe(true));
    await markAllPushed(store());
    await user.click(screen.getByRole('button', { name: 'Выйти и удалить данные с этого устройства' }));
    const dialog = await findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Удалить данные с этого устройства?');
    expect(dialog).toHaveTextContent('В облаке они сохранятся');
    await user.click(screen.getByRole('button', { name: 'Выйти и удалить' }));

    expect(await findByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
    await eventually(() => expect(td.deleted).toEqual([ALICE.id]));
    expect(fake.calls.signOutArgs).toEqual([{ scope: 'local' }]);

    const aliceAfter = await td.deps.openStore(ALICE.id);
    expect(await aliceAfter.db.wallets.count()).toBe(0); // пусто: база была удалена и создана заново
    expect(await aliceAfter.sync.getMeta('initialPullDone')).toBeUndefined();
    aliceAfter.close();
    const bobAfter = await td.deps.openStore(BOB.id);
    expect((await bobAfter.db.wallets.toArray()).map((w) => w.name)).toEqual(['Кошелёк Боба']);
    bobAfter.close();
  });

  it('«Выйти и удалить»: пока открыто окно подтверждения появилась новая запись → удаление отменяется', async () => {
    const { td, store, fake } = await openCloudSettings();
    await eventually(async () => expect(await store().sync.getMeta('initialPullDone')).toBe(true));
    await markAllPushed(store());
    await user.click(screen.getByRole('button', { name: 'Выйти и удалить данные с этого устройства' }));
    await findByRole('alertdialog');
    await write(() =>
      store().wallets.create({ name: 'Только что', currency: 'TJS', kind: 'cash', openingBalanceMinor: 1, color: '#000000', icon: '💰' }),
    );
    await user.click(screen.getByRole('button', { name: 'Выйти и удалить' }));
    expect(await waitFor(() => screen.getByText(/Появились неотправленные записи: данные не удалены/))).toBeInTheDocument();
    expect(td.deleted).toEqual([]);
    expect(fake.calls.signOut).toBe(0);
    expect(screen.getByText(ALICE.email)).toBeInTheDocument();
  });

  it('если проверить неотправленное не удалось — не выходим молча', async () => {
    const { store, fake } = await openCloudSettings();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(store().sync, 'counts').mockRejectedValue(new Error('IDB упал'));
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(await waitFor(() => screen.getByText(/Выход отменён, попробуйте ещё раз/))).toBeInTheDocument();
    expect(fake.calls.signOut).toBe(0);
  });

  it('старт без сети: пояснение, что работаем с данными устройства', async () => {
    const td = makeTestDeps({ online: false });
    const first = await td.deps.openStore(ALICE.id);
    await first.sync.setMeta('initialPullDone', true);
    first.close();
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    await openCloudSettings({ td, auth: { session: null, getSession: 'hang' }, bootTimeoutMs: 40 });
    expect(await waitFor(() => screen.getByText(/Нет связи с аккаунтом/))).toBeInTheDocument();
    expect(screen.getByText(ALICE.email)).toBeInTheDocument();
  });
});

describe('Настройки: смена пароля', () => {
  async function openSheet() {
    const ctx = await openCloudSettings();
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }));
    await findByRole('dialog', { name: 'Смена пароля' });
    const [first, second] = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    if (!first || !second) throw new Error('Нет полей пароля');
    return { ...ctx, first, second };
  }

  it('короткий пароль и несовпадение — ошибка без обращения к серверу', async () => {
    const { first, second, fake } = await openSheet();
    await user.type(first, '1234567');
    await user.type(second, '1234567');
    await user.click(screen.getAllByRole('button', { name: 'Сменить пароль' }).at(-1) as HTMLElement);
    expect(await findByRole('alert')).toHaveTextContent('не короче 8 символов');
    await user.clear(first);
    await user.clear(second);
    await user.type(first, 'правильный-пароль');
    await user.type(second, 'правильный-парол');
    await user.click(screen.getAllByRole('button', { name: 'Сменить пароль' }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Пароли не совпадают'));
    expect(fake.calls.updateUser).toBe(0);
  });

  it('тот же пароль — понятное сообщение; новый — «Пароль изменён» и шит закрывается', async () => {
    const { first, second, fake } = await openSheet();
    await user.type(first, ALICE.password);
    await user.type(second, ALICE.password);
    await user.click(screen.getAllByRole('button', { name: 'Сменить пароль' }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Новый пароль совпадает со старым'));

    await user.clear(first);
    await user.clear(second);
    await user.type(first, 'новый-крепкий-пароль');
    await user.type(second, 'новый-крепкий-пароль');
    await user.click(screen.getAllByRole('button', { name: 'Сменить пароль' }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Смена пароля' })).toBeNull());
    expect(screen.getByText('Пароль изменён')).toBeInTheDocument();
    expect(fake.state.lastPassword).toBe('новый-крепкий-пароль');
  });
});

describe('Настройки: синхронизация (облако)', () => {
  it('статус человеческим языком: всё отправлено / не было / ждёт / нет сети / ошибка / нужен вход', async () => {
    const { engine } = await openCloudSettings();
    await eventually(() => expect(engine().getStatus().lastSyncedAt).not.toBeNull());
    act(() => engine().set({ phase: 'idle', pending: 0, quarantined: 0 }));
    await waitFor(() => expect(screen.getByText('Всё отправлено в облако')).toBeInTheDocument());
    expect(screen.getByText(/Последняя успешная синхронизация: Сегодня, \d{2}:\d{2}/)).toBeInTheDocument();

    act(() => engine().set({ lastSyncedAt: null }));
    await waitFor(() => expect(screen.getByText('Ещё не синхронизировалось')).toBeInTheDocument());
    expect(screen.queryByText('Всё отправлено в облако')).toBeNull();
    expect(screen.getByText(/ещё не было/)).toBeInTheDocument();

    act(() => engine().set({ pending: 2 }));
    await waitFor(() => expect(screen.getByText('Ждут отправки: 2 записи')).toBeInTheDocument());

    act(() => engine().set({ phase: 'offline' }));
    await waitFor(() => expect(screen.getByText('Нет связи с облаком')).toBeInTheDocument());

    act(() => engine().set({ phase: 'error', lastError: 'сервер перегружен' }));
    await waitFor(() => expect(screen.getByText('Не удалось синхронизировать')).toBeInTheDocument());
    expect(screen.getByText(/сервер перегружен/)).toBeInTheDocument();

    act(() => engine().set({ phase: 'auth-required' }));
    await waitFor(() => expect(screen.getByText('Нужно войти заново')).toBeInTheDocument());
  });

  it('нужен вход: вместо «Синхронизировать сейчас» — «Войти заново», данные устройства остаются', async () => {
    const { td, engine } = await openCloudSettings();
    act(() => engine().set({ phase: 'auth-required' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Войти заново' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Синхронизировать сейчас' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Войти заново' }));
    expect(await findByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
    expect(td.deleted).toEqual([]);
  });

  it('«Синхронизировать сейчас» запускает синхронизацию вручную', async () => {
    const { engine } = await openCloudSettings();
    await user.click(screen.getByRole('button', { name: 'Синхронизировать сейчас' }));
    await eventually(() => expect(engine().calls.syncNow).toContain('manual'));
  });

  it('отвергнутые сервером записи: список с причиной и кнопка «Повторить» → store.sync.retryQuarantined', async () => {
    const { engine, store } = await openCloudSettings();
    await eventually(async () => expect((await store().sync.counts()).pending).toBeGreaterThan(0));
    const wallet = (await store().db.wallets.toArray())[0];
    await write(() => store().sync.quarantine('wallets', [wallet?.id ?? ''], 'нарушено ограничение wallets_name_check'));
    act(() => engine().set({ quarantined: 1 }));

    expect(await waitFor(() => screen.getByText('Сервер не принял записи: 1'))).toBeInTheDocument();
    expect(screen.getByText('Кошелёк «Наличные»')).toBeInTheDocument();
    expect(screen.getByText(/нарушено ограничение wallets_name_check/)).toBeInTheDocument();

    const syncCallsBefore = engine().calls.syncNow.length;
    const spy = vi.spyOn(store().sync, 'retryQuarantined');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await eventually(async () => expect((await store().db.wallets.toArray())[0]?.syncError).toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(engine().calls.syncNow.length).toBe(syncCallsBefore + 1);
    await waitFor(() => expect(screen.queryByText('Сервер не принял записи: 1')).toBeNull());
  });

  it('если «Повторить» не удалось — сообщение, экран жив', async () => {
    const { engine, store } = await openCloudSettings();
    await eventually(async () => expect((await store().sync.counts()).pending).toBeGreaterThan(0));
    const wallet = (await store().db.wallets.toArray())[0];
    await write(() => store().sync.quarantine('wallets', [wallet?.id ?? ''], 'ошибка'));
    act(() => engine().set({ quarantined: 1 }));
    await waitFor(() => screen.getByText('Сервер не принял записи: 1'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(store().sync, 'retryQuarantined').mockRejectedValue(new Error('IDB'));
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await waitFor(() => screen.getByText('Не удалось повторить отправку. Попробуйте ещё раз.'))).toBeInTheDocument();
  });
});

describe('Индикаторы в шапке (облако)', () => {
  it('SyncBadge получает ПОЛНЫЙ статус: отвергнутые сервером видны, «Синхронизировано» не врёт', async () => {
    const td = makeTestDeps();
    const fake = fakeAuthClient({ session: ALICE });
    renderAppRoot(<HeaderStatus />, { client: fake.client, deps: td.deps });
    await waitFor(() => expect(td.engines.length).toBe(1));
    const engine = td.engines[0];
    if (!engine) throw new Error('нет движка');
    await eventually(() => expect(engine.getStatus().lastSyncedAt).not.toBeNull());
    await waitFor(() => expect(screen.getByText('Синхронизировано')).toBeInTheDocument());

    act(() => engine.set({ quarantined: 2 }));
    await waitFor(() => expect(screen.getByText('Не принято сервером: 2')).toBeInTheDocument());
    expect(screen.queryByText('Синхронизировано')).toBeNull();

    act(() => engine.set({ quarantined: 0, pending: 3, phase: 'offline' }));
    await waitFor(() => expect(screen.getByText('Без сети · 3 записи в очереди')).toBeInTheDocument());
  });

  it('локальный режим: нейтральный бейдж «Только на устройстве», никакой «Синхронизации»', async () => {
    renderAppRoot(<HeaderStatus />, { deps: makeTestDeps().deps });
    await waitFor(() => expect(screen.getByText('Только на устройстве')).toBeInTheDocument());
    expect(screen.queryByText('Синхронизировано')).toBeNull();
    expect(screen.queryByText(/Без сети|Синхронизация/)).toBeNull();
  });
});
