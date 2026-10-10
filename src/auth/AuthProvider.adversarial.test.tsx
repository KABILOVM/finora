/**
 * ЛОМАТЕЛЬ: вход и сессия. Каждый тест — попытка доказать поломку. Падающий тест = находка.
 */
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALICE, BOB, fakeAuthClient } from '@/app/testkit';
import { act, render, waitFor } from '@/components/testUtils';
import { AuthProvider, useAuth, type AuthApi } from './AuthProvider';
import { readLastUser, writeLastUser } from './lastUser';
import { readCloudConfig } from './config';

function sessionOf(a: { id: string; email: string }): Session {
  return { access_token: 't', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: a.id, email: a.email } } as unknown as Session;
}

function mount(client: SupabaseClient, bootTimeoutMs = 30) {
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
      if (!holder.api) throw new Error('нет провайдера');
      return holder.api;
    },
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('ATTACK: медленный getSession при старте + выход', () => {
  it('человек вышел, пока getSession ещё «висел»: запоздавший ответ НЕ должен вернуть его в аккаунт', async () => {
    // Слабая сеть: getSession (с обновлением токена) отвечает позже таймаута 30 мс.
    let resolveLate!: (v: { data: { session: Session | null }; error: null }) => void;
    const late = new Promise<{ data: { session: Session | null }; error: null }>((r) => {
      resolveLate = r;
    });
    const listeners = new Set<(e: AuthChangeEvent, s: Session | null) => void>();
    const client = {
      auth: {
        getSession: () => late,
        onAuthStateChange: (cb: (e: AuthChangeEvent, s: Session | null) => void) => {
          listeners.add(cb);
          return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
        },
        signOut: async () => ({ error: null }),
        signInWithPassword: vi.fn(),
        updateUser: vi.fn(),
        refreshSession: vi.fn(),
      },
    } as unknown as SupabaseClient;

    writeLastUser({ id: ALICE.id, email: ALICE.email });
    const auth = mount(client);
    await waitFor(() => expect(auth.api.state.status).toBe('offline-known'));

    // человек нажал «Выйти» в Настройках
    await act(async () => {
      await auth.api.signOut();
    });
    expect(auth.api.state.status).toBe('signed-out');
    expect(readLastUser()).toBeNull();

    // а теперь запоздавший getSession возвращает сессию, прочитанную ДО выхода
    await act(async () => {
      resolveLate({ data: { session: sessionOf(ALICE) }, error: null });
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(auth.api.state.status, 'после выхода человек не должен снова оказаться вошедшим').toBe('signed-out');
    expect(readLastUser(), 'запись «последний пользователь» не должна воскреснуть').toBeNull();
  });
});

describe('ATTACK: signOut зависает (сеть «есть, но не работает»)', () => {
  it('«Выйти» не должно ждать сеть вечно: через пару секунд человек уже на экране входа', async () => {
    const fake = fakeAuthClient({ session: ALICE });
    const hang = new Promise<never>(() => undefined);
    (fake.client.auth as unknown as { signOut: () => Promise<never> }).signOut = () => hang;
    const auth = mount(fake.client, 200);
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));

    void auth.api.signOut();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1500));
    });
    expect(auth.api.state.status, 'через 1,5 с после нажатия «Выйти» состояние всё ещё не изменилось').toBe('signed-out');
  });
});

describe('ATTACK: смена человека на лету', () => {
  it('событие SIGNED_IN другого человека меняет user, а запись lastUser следует за ним (не остаётся прежний)', async () => {
    const fake = fakeAuthClient({ session: ALICE });
    const auth = mount(fake.client, 200);
    await waitFor(() => expect(auth.api.state.status).toBe('signed-in'));
    act(() => fake.emit('SIGNED_IN', BOB));
    expect(auth.api.user?.id).toBe(BOB.id);
    expect(readLastUser()?.id).toBe(BOB.id);
  });
});

describe('ATTACK: настройки облака', () => {
  it('настоящий ключ anon (JWT), случайно содержащий «xxx», не должен считаться заготовкой из .env.example', () => {
    // JWT состоит из base64url-символов; три подряд буквы x/X встречаются у ~0,6% настоящих ключей.
    const realKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.abcXXXdefGHIjkl0123456789_-abcdefghijk';
    const cfg = readCloudConfig({ VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_ANON_KEY: realKey });
    expect(cfg, 'настоящее облако молча превращено в «локальный режим»').not.toBeNull();
  });

  it('адрес проекта, где ref случайно содержит «xxx», тоже настоящий', () => {
    const cfg = readCloudConfig({ VITE_SUPABASE_URL: 'https://qwxxxertyuiopasdfghj.supabase.co', VITE_SUPABASE_ANON_KEY: 'eyJhbGciOi.real.key' });
    expect(cfg).not.toBeNull();
  });
});
