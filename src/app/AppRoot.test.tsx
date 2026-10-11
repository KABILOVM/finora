import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { useWallets } from '@/db';
import { LOCAL_USER_ID } from '@/auth/config';
import { readLastUser, writeLastUser } from '@/auth/lastUser';
import { META_INITIAL_PULL } from '@/sync/engine';
import { ALICE, BOB, fakeAuthClient, makeTestDeps, renderAppRoot, type FakeAuthOptions, type TestDeps } from './testkit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const Marker = () => <div>СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ</div>;

function WalletNames() {
  const wallets = useWallets({ includeArchived: true });
  return <ul aria-label="Кошельки">{(wallets ?? []).map((w) => <li key={w.id}>{w.name}</li>)}</ul>;
}

function cloud(opts: FakeAuthOptions = {}, td: TestDeps = makeTestDeps()) {
  const fake = fakeAuthClient(opts);
  return { fake, td };
}

/** Дать отложенному закрытию (setTimeout 0) отработать. */
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

async function typeCredentials(email: string, password: string) {
  const emailInput = screen.getByRole('textbox', { name: 'Почта' });
  await user.type(emailInput, email);
  const pass = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!pass) throw new Error('Нет поля пароля');
  await user.type(pass, password);
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.restoreAllMocks();
});

describe('локальный режим', () => {
  it('открывает базу фиксированного локального пользователя, делает затравку сразу, синхронизации нет', async () => {
    const td = makeTestDeps();
    renderAppRoot(
      <>
        <Marker />
        <WalletNames />
      </>,
      { deps: td.deps },
    );
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
    expect(td.opened).toEqual([LOCAL_USER_ID]);
    expect(td.engines).toHaveLength(0); // движка нет — «Синхронизировано» показывать нечему
    expect(td.stores[0] && (await td.stores[0].settings.get())?.baseCurrency).toBe('TJS');
  });

  it('вход не требуется и экрана входа нет', async () => {
    renderAppRoot(<Marker />, { deps: makeTestDeps().deps });
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Вход' })).toBeNull();
  });
});

describe('экран входа', () => {
  it('без входа показывается форма; регистрации нет; приложение закрыто', async () => {
    const { fake, td } = cloud({ session: null });
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    expect(await findByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeNull();
    expect(screen.queryByText(/регистрац|зарегистр|создать аккаунт/i)).toBeNull();
    expect(td.opened).toEqual([]); // чужая база не открывается, пока никто не вошёл
  });

  it('неверный пароль → сообщение по-русски, форма остаётся', async () => {
    const { fake, td } = cloud({ session: null });
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    await findByRole('heading', { name: 'Вход', level: 1 });
    await typeCredentials(ALICE.email, 'не-тот-пароль');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await findByRole('alert')).toHaveTextContent('Неверная почта или пароль');
    expect(screen.queryByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeNull();
    expect(screen.getByRole('button', { name: 'Войти' })).not.toBeDisabled();
  });

  it('без сети → «Нет связи: для первого входа нужен интернет»', async () => {
    const { fake, td } = cloud({ session: null, offline: true });
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    await findByRole('heading', { name: 'Вход', level: 1 });
    await typeCredentials(ALICE.email, ALICE.password);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await findByRole('alert')).toHaveTextContent('Нет связи: для первого входа нужен интернет');
  });

  it('верный пароль → первая загрузка → приложение; повторный запуск открывается сразу', async () => {
    const { fake, td } = cloud({ session: null });
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    await findByRole('heading', { name: 'Вход', level: 1 });
    await typeCredentials(ALICE.email, ALICE.password);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
    expect(td.opened).toEqual([ALICE.id]);
    expect(readLastUser()).toEqual({ id: ALICE.id, email: ALICE.email });
  });

  it('пустая почта не отправляется на сервер', async () => {
    const { fake, td } = cloud({ session: null });
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    await findByRole('heading', { name: 'Вход', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await findByRole('alert')).toHaveTextContent('Введите почту');
    expect(fake.calls.signIn).toBe(0);
  });
});

describe('первая загрузка данных', () => {
  it('пока облако не отдало данные — экран «Первая загрузка данных…», приложение закрыто, затравки ещё нет', async () => {
    let release: () => void = () => undefined;
    const td = makeTestDeps();
    td.control.hold = new Promise<void>((r) => (release = r));
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });

    expect(await findByRole('heading', { name: 'Первая загрузка данных…' })).toBeInTheDocument();
    expect(screen.queryByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeNull();
    // затравка делается ТОЛЬКО после первой загрузки (иначе свежие локальные настройки затёрли бы серверные)
    expect(await td.stores[0]?.settings.get()).toBeNull();

    release();
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
    expect((await td.stores[0]?.settings.get())?.baseCurrency).toBe('TJS');
    expect(await td.stores[0]?.sync.getMeta(META_INITIAL_PULL)).toBe(true);
  });

  it('без сети: «Нужен интернет для первой загрузки» + «Повторить»; появилась сеть → повтор → приложение', async () => {
    const td = makeTestDeps({ online: false });
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });

    expect(await findByRole('heading', { name: 'Нужен интернет для первой загрузки' })).toBeInTheDocument();
    expect(screen.queryByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeNull();

    td.control.online = true;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
    expect(td.engines[0]?.calls.syncNow).toEqual(['manual']);
  });

  it('ошибка загрузки показывается с причиной и кнопкой «Повторить»', async () => {
    const td = makeTestDeps();
    td.control.hold = new Promise<void>(() => undefined); // загрузка «идёт» и не заканчивается
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    await findByRole('heading', { name: 'Первая загрузка данных…' });
    act(() => td.engines[0]?.set({ phase: 'error', lastError: 'сервер сломался' }));
    expect(await findByRole('heading', { name: 'Не удалось загрузить данные' })).toBeInTheDocument();
    expect(screen.getByText(/сервер сломался/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeNull();
  });

  it('сессия закончилась во время первой загрузки → «Нужно войти заново» и кнопка входа', async () => {
    const td = makeTestDeps({ online: false });
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    await findByRole('heading', { name: 'Нужен интернет для первой загрузки' });
    act(() => td.engines[0]?.set({ phase: 'auth-required' }));
    expect(await findByRole('heading', { name: 'Нужно войти заново' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Войти заново' }));
    expect(await findByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
  });

  it('если первая загрузка уже была раньше — экрана загрузки нет, приложение сразу', async () => {
    const td = makeTestDeps({ online: false });
    const first = await td.deps.openStore(ALICE.id);
    await first.sync.setMeta(META_INITIAL_PULL, true);
    first.close();
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /Первая загрузка|Нужен интернет/ })).toBeNull();
  });
});

describe('старт без сети, пользователь уже входил на этом устройстве', () => {
  it('открываются ЕГО локальные данные, не зависая на заставке', async () => {
    const td = makeTestDeps({ online: false });
    const first = await td.deps.openStore(ALICE.id);
    await first.sync.setMeta(META_INITIAL_PULL, true);
    await first.wallets.create({ name: 'Офлайн-кошелёк', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#16a34a', icon: '💵' });
    first.close();
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const { fake } = cloud({ getSession: 'hang' }, td);
    renderAppRoot(<WalletNames />, { client: fake.client, deps: td.deps, bootTimeoutMs: 60 });
    await waitFor(() => expect(screen.getByText('Офлайн-кошелёк')).toBeInTheDocument());
    expect(td.opened.at(-1)).toBe(ALICE.id);
  });

  it('если первая загрузка так и не прошла — «Нужен интернет», а не пустое приложение', async () => {
    const td = makeTestDeps({ online: false });
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const { fake } = cloud({ getSession: 'hang' }, td);
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps, bootTimeoutMs: 60 });
    expect(await findByRole('heading', { name: 'Нужен интернет для первой загрузки' })).toBeInTheDocument();
    expect(screen.queryByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeNull();
  });

  it('позже сессия подтвердилась — данные не переоткрываются (тот же человек, тот же сеанс)', async () => {
    const td = makeTestDeps();
    const first = await td.deps.openStore(ALICE.id);
    await first.sync.setMeta(META_INITIAL_PULL, true);
    first.close();
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const { fake } = cloud({ getSession: 'hang' }, td);
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps, bootTimeoutMs: 40 });
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
    const openedBefore = td.opened.length;
    const enginesBefore = td.engines.length;
    act(() => fake.emit('TOKEN_REFRESHED', ALICE));
    await tick();
    expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument();
    expect(td.opened.length).toBe(openedBefore);
    expect(td.engines.length).toBe(enginesBefore);
  });
});

describe('ошибки открытия базы', () => {
  it('одна понятная страница: что случилось и что делать; «Повторить» открывает базу', async () => {
    const td = makeTestDeps();
    const realOpen = td.deps.openStore;
    let failures = 1;
    td.deps.openStore = async (id) => {
      if (failures-- > 0) throw new Error('Не удалось открыть локальную базу данных: SecurityError');
      return realOpen(id);
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAppRoot(<Marker />, { deps: td.deps });
    const alert = await findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось открыть хранилище данных');
    expect(alert).toHaveTextContent('приватной вкладке Safari');
    expect(screen.queryByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
  });

  it('если сломалась затравка — тот же экран ошибки, базы не остаются открытыми', async () => {
    const td = makeTestDeps();
    const realOpen = td.deps.openStore;
    td.deps.openStore = async (id) => {
      const store = await realOpen(id);
      store.categories.create = () => Promise.reject(new Error('диск переполнен'));
      return store;
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAppRoot(<Marker />, { deps: td.deps });
    expect(await findByRole('alert')).toHaveTextContent('Не удалось открыть хранилище данных');
    await tick();
    expect(td.stores.every((s) => !s.db.isOpen())).toBe(true);
  });

  it('в облачном режиме на экране ошибки можно выйти из аккаунта', async () => {
    const td = makeTestDeps();
    td.deps.openStore = () => Promise.reject(new Error('нет IndexedDB'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<Marker />, { client: fake.client, deps: td.deps });
    await findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Выйти из аккаунта' }));
    expect(await findByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
  });
});

describe('закрытие без утечек', () => {
  it('выход: движок остановлен и уничтожен, база закрыта, локальные данные на диске СОХРАНЕНЫ', async () => {
    const td = makeTestDeps();
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<WalletNames />, { client: fake.client, deps: td.deps });
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
    const engine = td.engines[0];
    const store = td.stores[0];
    expect(engine?.calls.start).toBeGreaterThan(0);

    await act(async () => void (await fake.client.auth.signOut({ scope: 'local' })));
    await findByRole('heading', { name: 'Вход', level: 1 });
    await tick();

    expect(engine?.calls.stop).toBeGreaterThan(0);
    expect(engine?.calls.dispose).toBe(1);
    expect(store?.db.isOpen()).toBe(false);
    // повторный вход возвращает всё мгновенно: база не удалена
    const reopened = await td.deps.openStore(ALICE.id);
    expect((await reopened.db.wallets.toArray()).map((w) => w.name)).toContain('Наличные');
    reopened.close();
  });

  it('StrictMode (двойной запуск эффектов): лишние базы и движки не остаются открытыми после размонтирования', async () => {
    const td = makeTestDeps();
    const { fake } = cloud({ session: ALICE }, td);
    const view = renderAppRoot(<Marker />, { client: fake.client, deps: td.deps, strict: true });
    await waitFor(() => expect(screen.getByText('СОДЕРЖИМОЕ ПРИЛОЖЕНИЯ')).toBeInTheDocument());
    view.unmount();
    await tick();
    expect(td.stores.length).toBeGreaterThanOrEqual(1);
    expect(td.stores.every((s) => !s.db.isOpen())).toBe(true);
    expect(td.engines.every((e) => e.calls.dispose === 1)).toBe(true);
  });

  it('размонтирование во время открытия базы: открывшаяся позже база всё равно закрывается', async () => {
    const td = makeTestDeps();
    const realOpen = td.deps.openStore;
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((r) => (finish = r));
    td.deps.openStore = async (id) => {
      await gate;
      return realOpen(id);
    };
    const view = renderAppRoot(<Marker />, { deps: td.deps });
    view.unmount();
    finish();
    await tick();
    await tick();
    expect(td.stores.length).toBe(1);
    expect(td.stores[0]?.db.isOpen()).toBe(false);
  });
});

describe('смена пользователя на одном устройстве', () => {
  it('данные не смешиваются: у каждого своя база, при возврате данные на месте', async () => {
    const td = makeTestDeps();
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<WalletNames />, { client: fake.client, deps: td.deps });
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());

    await td.stores[0]?.wallets.create({ name: 'Кошелёк Алисы', currency: 'TJS', kind: 'card', openingBalanceMinor: 500, color: '#2563eb', icon: '💳' });
    await waitFor(() => expect(screen.getByText('Кошелёк Алисы')).toBeInTheDocument());

    // Алиса выходит, входит Боб
    await act(async () => void (await fake.client.auth.signOut({ scope: 'local' })));
    await findByRole('heading', { name: 'Вход', level: 1 });
    await typeCredentials(BOB.email, BOB.password);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(td.opened).toEqual([ALICE.id, BOB.id]));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Кошельки' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument()); // его собственная затравка
    expect(screen.queryByText('Кошелёк Алисы')).toBeNull();
    const bobNames = (await td.stores[1]?.db.wallets.toArray())?.map((w) => w.name);
    expect(bobNames).toEqual(['Наличные']);

    // Боб выходит, Алиса возвращается — её кошелёк на месте
    await act(async () => void (await fake.client.auth.signOut({ scope: 'local' })));
    await findByRole('heading', { name: 'Вход', level: 1 });
    await typeCredentials(ALICE.email, ALICE.password);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(screen.getByText('Кошелёк Алисы')).toBeInTheDocument());
    expect(td.opened).toEqual([ALICE.id, BOB.id, ALICE.id]);
    // базы разных пользователей — разные физические базы
    expect(new Set(td.stores.map((s) => s.db.name)).size).toBe(2);
  });

  it('смена пользователя без выхода (другая сессия) перемонтирует сеанс: старая база закрыта', async () => {
    const td = makeTestDeps();
    const { fake } = cloud({ session: ALICE }, td);
    renderAppRoot(<WalletNames />, { client: fake.client, deps: td.deps });
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
    act(() => fake.emit('SIGNED_IN', BOB));
    await waitFor(() => expect(td.opened).toEqual([ALICE.id, BOB.id]));
    await tick();
    expect(td.stores[0]?.db.isOpen()).toBe(false);
    expect(td.engines[0]?.calls.dispose).toBe(1);
  });
});
