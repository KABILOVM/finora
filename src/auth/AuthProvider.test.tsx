import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALICE, BOB, fakeAuthClient, type FakeAuthOptions } from '@/app/testkit';
import { act, render, waitFor } from '@/components/testUtils';
import { AuthProvider, useAuth, type AuthApi } from './AuthProvider';
import { NO_CONNECTION_TEXT } from './authErrors';
import { LOCAL_USER_ID } from './config';
import { readLastUser, writeLastUser } from './lastUser';
import { AUTH_STORAGE_KEY } from './supabaseClient';

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

function mountAuth(client: SupabaseClient | null, bootTimeoutMs = 60) {
  const holder: { api: AuthApi | null } = { api: null };
  function Probe() {
    holder.api = useAuth();
    return null;
  }
  render(
    <AuthProvider client={client} bootTimeoutMs={bootTimeoutMs}>
      <Probe />
    </AuthProvider>,
  );
  return {
    get api(): AuthApi {
      if (!holder.api) throw new Error('AuthProvider не отрисован');
      return holder.api;
    },
  };
}

const setup = (opts: FakeAuthOptions = {}, bootTimeoutMs?: number) => {
  const fake = fakeAuthClient(opts);
  return { fake, auth: mountAuth(fake.client, bootTimeoutMs) };
};

beforeEach(() => {
  localStorage.clear();
  setOnLine(true);
});
afterEach(() => {
  localStorage.clear();
  setOnLine(true);
  vi.restoreAllMocks();
});

describe('локальный режим (клиента нет)', () => {
  it('сразу «вошёл» фиксированный локальный пользователь, облака нет', () => {
    const auth = mountAuth(null);
    expect(auth.api.cloud).toBe(false);
    expect(auth.api.state).toEqual({ status: 'signed-in', user: { id: LOCAL_USER_ID, email: '' } });
  });

  it('вход, выход и смена пароля — отказ с понятным текстом, ничего не падает', async () => {
    const auth = mountAuth(null);
    expect((await auth.api.signIn('a@b.c', 'x')).ok).toBe(false);
    expect((await auth.api.changePassword('12345678', '12345678')).ok).toBe(false);
    await auth.api.signOut();
    expect(auth.api.state.status).toBe('signed-in');
  });
});

describe('старт с облаком', () => {
  it('есть сохранённая сессия → signed-in, пользователь запомнен', async () => {
    const { auth } = setup({ session: ALICE });
    expect(auth.api.state.status).toBe('booting');
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    expect(auth.api.user).toEqual({ id: ALICE.id, email: ALICE.email });
    expect(readLastUser()).toEqual({ id: ALICE.id, email: ALICE.email });
  });

  it('сессии нет, сеть есть → signed-out, «последний пользователь» забыт', async () => {
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const { auth } = setup({ session: null });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
    expect(auth.api.user).toBeNull();
    expect(readLastUser()).toBeNull();
  });

  it('getSession зависла (нет сети), но здесь уже входили → offline-known за время таймаута, старт не виснет', async () => {
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const started = Date.now();
    const { auth } = setup({ getSession: 'hang' }, 80);
    expect(auth.api.state.status).toBe('booting');
    await waitFor(() => expect(auth.api.state.status).toBe('offline-known'));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(auth.api.user).toEqual({ id: ALICE.id, email: ALICE.email });
  });

  it('getSession зависла и это первый запуск → signed-out (экран входа), а не вечная заставка', async () => {
    const { auth } = setup({ getSession: 'hang' }, 60);
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
  });

  it('getSession ответила сетевой ошибкой + есть запомненный пользователь → offline-known', async () => {
    writeLastUser({ id: BOB.id, email: BOB.email });
    const { auth } = setup({ getSession: 'network' });
    await waitFor(() => expect(auth.api.state.status).toBe('offline-known'));
    expect(auth.api.user?.id).toBe(BOB.id);
  });

  it('браузер офлайн, сессии в хранилище нет, но пользователь запомнен → offline-known', async () => {
    setOnLine(false);
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const { auth } = setup({ session: null });
    await waitFor(() => expect(auth.api.state.status).toBe('offline-known'));
  });

  it('браузер офлайн и запомненного пользователя нет → signed-out', async () => {
    setOnLine(false);
    const { auth } = setup({ session: null });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
  });

  it('запомненная запись повреждена → не открываем чужое, signed-out', async () => {
    localStorage.setItem('finora:lastUser', '{"id":');
    const { auth } = setup({ getSession: 'hang' }, 40);
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
  });

  it('offline-known → после появления сессии (событие) становится signed-in для того же человека', async () => {
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const { fake, auth } = setup({ getSession: 'hang' }, 40);
    await waitFor(() => expect(auth.api.state.status).toBe('offline-known'));
    act(() => fake.emit('TOKEN_REFRESHED', ALICE));
    expect(auth.api.state).toEqual({ status: 'signed-in', user: { id: ALICE.id, email: ALICE.email } });
  });

  it('событие SIGNED_OUT (например, в другой вкладке) → экран входа, пользователь забыт', async () => {
    const { fake, auth } = setup({ session: ALICE });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    act(() => fake.emit('SIGNED_OUT', null));
    expect(auth.api.state.status).toBe('signed-out');
    expect(readLastUser()).toBeNull();
  });

  it('INITIAL_SESSION без сессии не выкидывает из offline-known', async () => {
    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const { fake, auth } = setup({ getSession: 'hang' }, 40);
    await waitFor(() => expect(auth.api.state.status).toBe('offline-known'));
    act(() => fake.emit('INITIAL_SESSION', null));
    expect(auth.api.state.status).toBe('offline-known');
  });
});

describe('signIn', () => {
  it('неверный пароль → «Неверная почта или пароль», остаёмся на входе', async () => {
    const { auth } = setup({ session: null });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
    const r = await auth.api.signIn(ALICE.email, 'не тот пароль');
    expect(r).toEqual({ ok: false, message: 'Неверная почта или пароль' });
    expect(auth.api.state.status).toBe('signed-out');
    expect(readLastUser()).toBeNull();
  });

  it('верный пароль → signed-in, пользователь запомнен; почта нормализуется (пробелы, регистр)', async () => {
    const { fake, auth } = setup({ session: null });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
    const r = await act(async () => auth.api.signIn('  Alice@Example.COM ', ALICE.password));
    expect(r).toEqual({ ok: true });
    expect(auth.api.state).toEqual({ status: 'signed-in', user: { id: ALICE.id, email: ALICE.email } });
    expect(readLastUser()).toEqual({ id: ALICE.id, email: ALICE.email });
    expect(fake.calls.signIn).toBe(1);
  });

  it('без сети → честная фраза про первый вход', async () => {
    const { auth } = setup({ session: null, offline: true });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
    const r = await auth.api.signIn(ALICE.email, ALICE.password);
    expect(r).toEqual({ ok: false, message: NO_CONNECTION_TEXT });
  });

  it('пустая почта, почта без @, пустой пароль — отказ ДО обращения к серверу', async () => {
    const { fake, auth } = setup({ session: null });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
    expect((await auth.api.signIn('', 'x')).ok).toBe(false);
    expect((await auth.api.signIn('без-собаки', 'x')).ok).toBe(false);
    expect((await auth.api.signIn(ALICE.email, '')).ok).toBe(false);
    expect(fake.calls.signIn).toBe(0);
  });

  it('если клиент бросил исключение — понятный текст, а не падение', async () => {
    const { fake, auth } = setup({ session: null });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-out'));
    vi.spyOn(fake.client.auth, 'signInWithPassword').mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await auth.api.signIn(ALICE.email, ALICE.password)).toEqual({ ok: false, message: NO_CONNECTION_TEXT });
  });
});

describe('signOut', () => {
  it('выходит с этого устройства (scope local), забывает пользователя, состояние signed-out', async () => {
    const { fake, auth } = setup({ session: ALICE });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    await act(async () => auth.api.signOut());
    expect(fake.calls.signOutArgs).toEqual([{ scope: 'local' }]);
    expect(auth.api.state.status).toBe('signed-out');
    expect(readLastUser()).toBeNull();
  });

  it('если сервер ответил ошибкой — сессия на устройстве всё равно снимается', async () => {
    const { fake, auth } = setup({ session: ALICE });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    localStorage.setItem(AUTH_STORAGE_KEY, '{"access_token":"x"}');
    fake.state.signOutFails = true;
    await act(async () => auth.api.signOut());
    expect(auth.api.state.status).toBe('signed-out');
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(readLastUser()).toBeNull();
  });

  it('если клиент бросил исключение — тоже выходим', async () => {
    const { fake, auth } = setup({ session: ALICE });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    vi.spyOn(fake.client.auth, 'signOut').mockRejectedValue(new Error('сеть'));
    await act(async () => auth.api.signOut());
    expect(auth.api.state.status).toBe('signed-out');
  });
});

describe('changePassword', () => {
  it('короткий пароль и несовпадение повтора отвергаются до запроса', async () => {
    const { fake, auth } = setup({ session: ALICE });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    expect(await auth.api.changePassword('1234567', '1234567')).toMatchObject({ ok: false });
    expect(await auth.api.changePassword('12345678', '123456789')).toEqual({ ok: false, message: 'Пароли не совпадают' });
    expect(fake.calls.updateUser).toBe(0);
  });

  it('тот же пароль → понятное сообщение; новый → ok', async () => {
    const { fake, auth } = setup({ session: ALICE });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    expect(await auth.api.changePassword(ALICE.password, ALICE.password)).toEqual({
      ok: false,
      message: 'Новый пароль совпадает со старым. Придумайте другой.',
    });
    expect(await auth.api.changePassword('совсем-новый-пароль', 'совсем-новый-пароль')).toEqual({ ok: true });
    expect(fake.state.lastPassword).toBe('совсем-новый-пароль');
  });

  it('без сети → фраза про связь', async () => {
    const { fake, auth } = setup({ session: ALICE });
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    fake.setOffline(true);
    expect(await auth.api.changePassword('новый-пароль-1', 'новый-пароль-1')).toEqual({
      ok: false,
      message: 'Нет связи. Проверьте интернет и повторите.',
    });
  });
});
