import { StrictMode, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthProvider';
import { LOCAL_USER, LOCAL_USER_ID } from '@/auth/config';
import { fakeOtpClient } from '@/auth/otpTestkit';
import { act, findByRole, render, screen, user, waitFor } from '@/components/testUtils';
import { installFakeWebAuthn, type FakeWebAuthn } from '@/lock/fakeWebAuthn';
import { clearLock, lockKey, readLock, writeLock, type GraceSeconds } from '@/lock/lockStore';
import { createLockCredential } from '@/lock/webauthn';
import { ALICE, makeTestDeps, renderAppRoot } from './testkit';
import { LockGate } from './LockGate';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

let fake: FakeWebAuthn;
const mounts = { count: 0 };

beforeEach(() => {
  localStorage.clear();
  fake = installFakeWebAuthn();
  mounts.count = 0;
});
afterEach(() => {
  fake.restore();
  localStorage.clear();
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  vi.restoreAllMocks();
});

/** Дочерний экран: считает, сколько раз его создавали (замок не должен его пересоздавать). */
function Child() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounts.count++;
  }, []);
  return (
    <main>
      <button ref={ref} type="button">
        Кнопка приложения
      </button>
    </main>
  );
}

async function enableLock(userId = LOCAL_USER_ID, graceSeconds: GraceSeconds = 60): Promise<string> {
  const r = await createLockCredential({ id: userId });
  if (!r.ok) throw new Error('не создался ключ');
  writeLock(userId, { credentialId: r.credentialId, enabledAt: '2026-10-11T08:00:00.000Z', graceSeconds });
  return r.credentialId;
}

function mountLocal(children: ReactNode = <Child />) {
  return render(
    <AuthProvider client={null}>
      <LockGate user={LOCAL_USER}>{children}</LockGate>
    </AuthProvider>,
  );
}

const cover = () => screen.queryByRole('dialog', { name: 'Finora закрыта' });
const appButton = () => screen.queryByRole('button', { name: 'Кнопка приложения' });
const appButtonHidden = () => screen.getByRole('button', { name: 'Кнопка приложения', hidden: true });
/** Контейнер приложения: ближайший предок с inert. */
const inertAncestor = () => appButtonHidden().closest('[inert]');

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('замок включён: холодный старт', () => {
  it('заслонка есть уже в первой отрисовке (синхронно, без мигания); приложение под ней есть в DOM, но недоступно', async () => {
    await enableLock();
    fake.mode = 'decline';
    mountLocal();
    // никаких await между render и проверкой: это и есть «первый кадр»
    expect(cover()).not.toBeNull();
    expect(cover()).toHaveAttribute('aria-modal', 'true');
    expect(cover()!.querySelector('h2')?.textContent).toBe('Finora закрыта');
    expect(appButton()).toBeNull(); // скринридер и клавиатура содержимое не видят
    expect(appButtonHidden()).toBeInTheDocument(); // но оно не размонтировано
    expect(inertAncestor()).not.toBeNull();
    expect(inertAncestor()!.getAttribute('aria-hidden')).toBe('true');
    expect(mounts.count).toBe(1);
    await settle();
  });

  it('на заслонке: подпись, кнопка «Открыть по Face ID / отпечатку», «Не получается? Выйти и войти заново»; фокус у заслонки', async () => {
    await enableLock(ALICE.id);
    fake.mode = 'decline';
    const client = fakeOtpClient({ session: ALICE }).client;
    render(
      <AuthProvider client={client}>
        <LockGate user={{ id: ALICE.id, email: ALICE.email }}>
          <Child />
        </LockGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Не получается? Выйти и войти заново' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' })).toBeInTheDocument();
    expect(cover()!.contains(document.activeElement)).toBe(true);
    await settle();
  });

  it('замок не включён — заслонки нет, содержимое доступно и без inert', () => {
    mountLocal();
    expect(cover()).toBeNull();
    expect(appButton()).not.toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('замок включён у другого пользователя — этому заслонка не нужна', async () => {
    await enableLock(ALICE.id);
    mountLocal();
    expect(cover()).toBeNull();
  });

  it('в StrictMode (двойной запуск эффектов) заслонка одна, автозапрос не ломает открытие, содержимое не пересоздаётся', async () => {
    await enableLock();
    fake.mode = 'decline';
    render(
      <StrictMode>
        <AuthProvider client={null}>
          <LockGate user={LOCAL_USER}>
            <Child />
          </LockGate>
        </AuthProvider>
      </StrictMode>,
    );
    expect(screen.queryAllByRole('dialog', { name: 'Finora закрыта' })).toHaveLength(1);
    await settle();
    fake.mode = 'ok';
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    await waitFor(() => expect(cover()).toBeNull());
    expect(appButton()).not.toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
  });
});

describe('открыть можно только успешным подтверждением', () => {
  it('отказ / отмена не открывают: «Не подтверждено», заслонка на месте, можно нажать ещё раз', async () => {
    await enableLock();
    fake.mode = 'decline';
    mountLocal();
    await settle(); // автозапрос отказал молча
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    expect((await findByRole('alert')).textContent).toBe('Не подтверждено');
    expect(cover()).not.toBeNull();
    expect(appButton()).toBeNull();
    fake.mode = 'abort';
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Не подтверждено'));
    expect(cover()).not.toBeNull();
  });

  it.each(['wrong-credential', 'wrong-challenge', 'no-uv-flag', 'policy'] as const)('странный ответ системы (%s) тоже не открывает', async (mode) => {
    await enableLock();
    fake.mode = mode;
    mountLocal();
    await settle();
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    await findByRole('alert');
    expect(cover()).not.toBeNull();
  });

  it('успех открывает: заслонка уходит, inert снят, содержимое доступно и НЕ пересоздано', async () => {
    await enableLock();
    fake.mode = 'decline';
    mountLocal();
    await settle();
    const before = appButtonHidden();
    fake.mode = 'ok';
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    await waitFor(() => expect(cover()).toBeNull());
    expect(appButton()).not.toBeNull();
    expect(appButton()).toBe(before); // тот же элемент: приложение не перезапускалось
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(mounts.count).toBe(1);
  });

  it('автозапрос при показе: если система сразу подтвердила, заслонка уходит без нажатия; кнопка при этом тоже была', async () => {
    await enableLock();
    mountLocal();
    await waitFor(() => expect(cover()).toBeNull());
    expect(fake.getCalls).toHaveLength(1);
  });

  it('автозапрос и нажатие кнопки одновременно — одно окно системы', async () => {
    await enableLock();
    let release: () => void = () => undefined;
    fake.hold = new Promise<void>((r) => (release = r));
    mountLocal();
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    release();
    await waitFor(() => expect(cover()).toBeNull());
    expect(fake.getCalls).toHaveLength(1);
  });

  it('Esc не снимает заслонку', async () => {
    await enableLock();
    fake.mode = 'decline';
    mountLocal();
    await settle();
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    expect(cover()).not.toBeNull();
    expect(appButton()).toBeNull();
  });

  it('повреждённая запись: заслонка закрыта, открыть по ключу нечем, предлагается только выход; ничего не открывает само', async () => {
    localStorage.setItem(lockKey(LOCAL_USER_ID), '{битый json');
    mountLocal();
    expect(cover()).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть по Face ID / отпечатку' })).toBeNull();
    expect(screen.getByText(/Запись о замке на этом устройстве повреждена/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Не получается? Снять замок' })).toBeInTheDocument();
    await settle();
    expect(fake.getCalls).toHaveLength(0);
    expect(cover()).not.toBeNull();
  });

  it('пустая запись и запись без ключа — тоже закрыто', () => {
    for (const raw of ['', '{}', 'null', '[]']) {
      localStorage.setItem(lockKey(LOCAL_USER_ID), raw);
      const view = mountLocal();
      expect(cover(), `запись ${JSON.stringify(raw)}`).not.toBeNull();
      view.unmount();
    }
  });
});

describe('закрытие после ухода из приложения', () => {
  const T0 = new Date('2026-10-11T08:00:00Z').getTime();

  async function unlockedWith(grace: GraceSeconds) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await enableLock(LOCAL_USER_ID, grace);
    mountLocal();
    await waitFor(() => expect(cover()).toBeNull()); // автозапрос открыл (режим ok)
    fake.mode = 'decline'; // дальше открывать нечем — проверяем только закрытие
  }
  const away = (ms: number) => {
    setVisibility('hidden');
    vi.setSystemTime(T0 + ms);
    setVisibility('visible');
  };

  it('«сразу» (0): закрывается уже при скрытии (чтобы снимок в переключателе приложений не показал данные)', async () => {
    await unlockedWith(0);
    setVisibility('hidden');
    expect(cover()).not.toBeNull();
    expect(appButton()).toBeNull();
  });

  it('через 1 минуту: короткий уход не закрывает, на границе и дольше — закрывает', async () => {
    await unlockedWith(60);
    away(59_000);
    expect(cover()).toBeNull();
    expect(appButton()).not.toBeNull();
    setVisibility('hidden');
    vi.setSystemTime(T0 + 59_000 + 60_000);
    setVisibility('visible');
    expect(cover()).not.toBeNull();
  });

  it('через 5 минут: 4 минуты — не закрывает, 5 — закрывает', async () => {
    await unlockedWith(300);
    away(240_000);
    expect(cover()).toBeNull();
    setVisibility('hidden');
    vi.setSystemTime(T0 + 240_000 + 300_000);
    setVisibility('visible');
    expect(cover()).not.toBeNull();
  });

  it('pagehide / pageshow (возврат из кэша страниц) работают так же', async () => {
    await unlockedWith(60);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    vi.setSystemTime(T0 + 90_000);
    act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })));
    expect(cover()).not.toBeNull();
  });

  it('обычный pageshow при загрузке (не из кэша) ничего не закрывает; повторное событие того же возвращения — тоже', async () => {
    await unlockedWith(60);
    act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false })));
    expect(cover()).toBeNull();
    // возвращение: pageshow и visibilitychange приходят оба; второе не должно «сомневаться» и закрывать
    act(() => void window.dispatchEvent(new Event('pagehide')));
    vi.setSystemTime(T0 + 5_000);
    act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })));
    setVisibility('visible');
    expect(cover()).toBeNull();
  });

  it('часы ушли назад — при сомнении закрываем', async () => {
    await unlockedWith(300);
    setVisibility('hidden');
    vi.setSystemTime(T0 - 3_600_000);
    setVisibility('visible');
    expect(cover()).not.toBeNull();
  });

  it('после закрытия заслонку снимает только подтверждение; новое скрытие/возвращение её не снимает', async () => {
    await unlockedWith(0);
    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('hidden');
    setVisibility('visible');
    expect(cover()).not.toBeNull();
    fake.mode = 'ok';
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    await waitFor(() => expect(cover()).toBeNull());
  });

  it('приложение под заслонкой не пересоздаётся при закрытии и открытии', async () => {
    await unlockedWith(0);
    const node = appButton();
    setVisibility('hidden');
    expect(cover()).not.toBeNull();
    fake.mode = 'ok';
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    await waitFor(() => expect(cover()).toBeNull());
    expect(appButton()).toBe(node);
    expect(mounts.count).toBe(1);
  });

  it('замок выключен — уход и возвращение ничего не закрывают', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mountLocal();
    away(10 * 60_000);
    expect(cover()).toBeNull();
  });
});

describe('настройку меняют снаружи (настройки, другая вкладка)', () => {
  it('замок выключили, пока заслонка закрыта (например, в другой вкладке) — заслонка уходит; повторное включение не закрывает сразу', async () => {
    await enableLock();
    fake.mode = 'decline';
    mountLocal();
    await settle();
    expect(cover()).not.toBeNull();
    act(() => void clearLock(LOCAL_USER_ID));
    await waitFor(() => expect(cover()).toBeNull());
    fake.mode = 'ok';
    await enableLock();
    await settle();
    expect(cover()).toBeNull(); // человек в приложении, замок включили «на будущее»
    expect(readLock(LOCAL_USER_ID).kind).toBe('on');
  });

  it('включили замок в уже открытом приложении — экран не закрывается', async () => {
    mountLocal();
    await enableLock();
    await settle();
    expect(cover()).toBeNull();
  });
});

describe('окна и уведомления вне корня приложения', () => {
  function Sheet() {
    return createPortal(
      <div role="dialog" aria-label="Окно под заслонкой">
        <button type="button">Кнопка окна</button>
      </div>,
      document.body,
    );
  }

  it('окно, открытое до закрытия, и окно, появившееся под закрытой заслонкой, недоступны; после открытия всё как было', async () => {
    await enableLock();
    fake.mode = 'decline';
    vi.useFakeTimers({ toFake: ['Date'] });
    // замок включён, но приложение уже открыто с окном: имитируем «успешно открыли», потом «ушли и вернулись»
    mountLocal(
      <>
        <Child />
        <Sheet />
      </>,
    );
    await settle();
    const win = screen.getByRole('dialog', { name: 'Окно под заслонкой', hidden: true });
    expect(win.closest('[inert]')).not.toBeNull();
    // новое окно, появившееся уже под закрытой заслонкой (например, пришло по событию)
    const late = document.createElement('div');
    late.setAttribute('aria-label', 'позднее');
    late.innerHTML = '<button>Поздняя кнопка</button>';
    document.body.appendChild(late);
    await settle();
    expect(late.hasAttribute('inert')).toBe(true);
    expect(late.getAttribute('aria-hidden')).toBe('true');
    // открыли
    fake.mode = 'ok';
    await user.click(screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' }));
    await waitFor(() => expect(cover()).toBeNull());
    expect(late.hasAttribute('inert')).toBe(false);
    expect(late.hasAttribute('aria-hidden')).toBe(false);
    late.remove();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('то, что уже было aria-hidden, остаётся aria-hidden после снятия заслонки', async () => {
    const pre = document.createElement('div');
    pre.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pre);
    await enableLock();
    mountLocal(); // автозапрос откроет
    await waitFor(() => expect(cover()).toBeNull());
    expect(pre.getAttribute('aria-hidden')).toBe('true');
    expect(pre.hasAttribute('inert')).toBe(false);
    pre.remove();
  });
});

describe('«Не получается?»: запасной выход', () => {
  it('локальный режим: вопрос → «Отмена» возвращает, Esc возвращает, «Снять замок» снимает замок и записи не трогает', async () => {
    await enableLock();
    fake.mode = 'decline';
    mountLocal();
    await settle();
    await user.click(screen.getByRole('button', { name: 'Не получается? Снять замок' }));
    expect(screen.getByRole('heading', { name: 'Снять замок?' })).toBeInTheDocument();
    expect(screen.getByText(/Записи не удалятся/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.getByRole('heading', { name: 'Finora закрыта' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Не получается? Снять замок' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Finora закрыта' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Не получается? Снять замок' }));
    await user.click(screen.getByRole('button', { name: 'Снять замок' }));
    await waitFor(() => expect(cover()).toBeNull());
    expect(readLock(LOCAL_USER_ID)).toEqual({ kind: 'off' });
    expect(appButton()).not.toBeNull();
  });

  it('повреждённая запись в локальном режиме снимается тем же выходом', async () => {
    localStorage.setItem(lockKey(LOCAL_USER_ID), 'мусор');
    mountLocal();
    await user.click(screen.getByRole('button', { name: 'Не получается? Снять замок' }));
    await user.click(screen.getByRole('button', { name: 'Снять замок' }));
    await waitFor(() => expect(cover()).toBeNull());
    expect(localStorage.getItem(lockKey(LOCAL_USER_ID))).toBeNull();
  });

  it('если запись снять не удалось (хранилище не пишет) — заслонка остаётся и говорит об этом', async () => {
    await enableLock();
    fake.mode = 'decline';
    mountLocal();
    await settle();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    await user.click(screen.getByRole('button', { name: 'Не получается? Снять замок' }));
    await user.click(screen.getByRole('button', { name: 'Снять замок' }));
    expect((await findByRole('alert')).textContent).toMatch(/Не получилось/);
    expect(document.querySelector('[data-lock-cover]')).not.toBeNull(); // заслонка на месте
    expect(readLock(LOCAL_USER_ID).kind).toBe('on');
  });
});

describe('вся сборка: облако, выход через заслонку', () => {
  it('«Выйти и войти заново»: подтверждение → выход, замок этого пользователя снят, локальные данные НЕ удалены, показан экран входа', async () => {
    const otp = fakeOtpClient({ session: ALICE });
    const td = makeTestDeps();
    await enableLock(ALICE.id);
    fake.mode = 'decline';
    renderAppRoot(<Child />, { client: otp.client, deps: td.deps });
    const leaveButton = await findByRole('button', { name: 'Не получается? Выйти и войти заново' });
    expect(cover()).not.toBeNull();
    expect(appButton()).toBeNull();

    await user.click(leaveButton);
    expect(screen.getByRole('heading', { name: 'Выйти из аккаунта?' })).toBeInTheDocument();
    expect(screen.getByText(/Записи на устройстве сохранятся/)).toBeInTheDocument();
    expect(otp.calls.signOut).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(otp.calls.signOut).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Не получается? Выйти и войти заново' }));
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await findByRole('heading', { name: 'Вход', level: 1 });
    expect(otp.calls.signOut).toBe(1);
    expect(localStorage.getItem(lockKey(ALICE.id))).toBeNull();
    expect(td.deleted).toEqual([]);
    expect(cover()).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('содержимое приложения под заслонкой работает: движок синхронизации запущен и не останавливается', async () => {
    const otp = fakeOtpClient({ session: ALICE });
    const td = makeTestDeps();
    await enableLock(ALICE.id);
    fake.mode = 'decline';
    renderAppRoot(<Child />, { client: otp.client, deps: td.deps });
    await findByRole('dialog', { name: 'Finora закрыта' });
    await waitFor(() => expect(td.engines.length).toBe(1));
    await waitFor(() => expect(td.engines[0]!.calls.start).toBeGreaterThan(0));
    expect(td.engines[0]!.calls.stop).toBe(0);
    expect(td.engines[0]!.calls.dispose).toBe(0);
    // экран «Первая загрузка данных…» (то, что приложение показывает в это время) на месте, но недоступен
    expect(screen.getByText('Первая загрузка данных…').closest('[inert]')).not.toBeNull();
  });

  it('адрес страницы заслонку не обходит: при любом маршруте под ней по-прежнему закрыто', async () => {
    await enableLock();
    fake.mode = 'decline';
    const td = makeTestDeps();
    renderAppRoot(<Child />, { client: null, deps: td.deps, path: '/settings' });
    expect(cover()).not.toBeNull();
    await settle();
    expect(cover()).not.toBeNull();
  });
});
