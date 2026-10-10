import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { describeAuthError, isNetworkError } from './authErrors';
import { LOCAL_USER, isSafeUserId, type AuthUser } from './config';
import { AUTH_STORAGE_KEY } from './supabaseClient';
import { clearLastUser, readLastUser, writeLastUser } from './lastUser';
import { checkNewPassword } from './passwordRules';

/**
 * Состояния входа:
 *  - booting       — смотрим, есть ли сохранённая сессия (не дольше bootTimeoutMs, чтобы офлайн старт не зависал);
 *  - signed-out    — никто не вошёл: показываем экран входа;
 *  - signed-in     — вошёл, сессия подтверждена (или локальный режим);
 *  - offline-known — сети нет (или сервер не ответил), но на этом устройстве уже есть вошедший ранее пользователь:
 *                    открываем ЕГО локальные данные, а синхронизация сама скажет «нужен вход», если сессия не жива.
 */
export type AuthState =
  | { status: 'booting' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'offline-known'; user: AuthUser };

export type AuthResult = { ok: true } | { ok: false; message: string };

/** Ровно та часть клиента Supabase, которую использует вход. Настоящий SupabaseClient ей подходит; в тестах — подмена. */
export type AuthClientLike = {
  auth: Pick<
    SupabaseClient['auth'],
    'getSession' | 'onAuthStateChange' | 'signInWithPassword' | 'signOut' | 'updateUser' | 'refreshSession'
  >;
};

export interface AuthApi {
  /** false — облако не настроено (локальный режим): входа и выхода нет. */
  cloud: boolean;
  state: AuthState;
  /** Пользователь, чьи данные открыты (в локальном режиме — фиксированный). null — никто. */
  user: AuthUser | null;
  signIn(email: string, password: string): Promise<AuthResult>;
  /** Выход с этого устройства. Локальная база пользователя СОХРАНЯЕТСЯ. Не бросает ошибок. */
  signOut(): Promise<void>;
  changePassword(password: string, repeat: string): Promise<AuthResult>;
}

const AuthContext = createContext<AuthApi | null>(null);

export const DEFAULT_BOOT_TIMEOUT_MS = 4000;

export interface AuthProviderProps {
  /** null — локальный режим. */
  client: AuthClientLike | null;
  /** Сколько ждать getSession при старте, мс. */
  bootTimeoutMs?: number;
  children?: ReactNode;
}

const TIMED_OUT = Symbol('timed-out');

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function userOf(session: { user?: { id?: unknown; email?: unknown } | null } | null | undefined): AuthUser | null {
  const u = session?.user;
  if (!u || !isSafeUserId(u.id)) return null;
  return { id: u.id, email: typeof u.email === 'string' ? u.email : '' };
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

export function AuthProvider({ client, bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(() =>
    client ? { status: 'booting' } : { status: 'signed-in', user: LOCAL_USER },
  );
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!client) {
      setState({ status: 'signed-in', user: LOCAL_USER });
      return undefined;
    }
    let cancelled = false;

    const signedIn = (user: AuthUser) => {
      writeLastUser(user);
      setState((cur) => {
        // тот же человек и то же состояние — не создаём новый объект, чтобы экраны не перерисовывались зря
        if (cur.status === 'signed-in' && cur.user.id === user.id && cur.user.email === user.email) return cur;
        return { status: 'signed-in', user };
      });
    };
    const signedOut = () => {
      clearLastUser();
      setState({ status: 'signed-out' });
    };

    // Внимание: внутри обработчика нельзя вызывать другие методы supabase.auth — только обновлять состояние.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT') {
        signedOut();
        return;
      }
      const user = userOf(session);
      if (user) signedIn(user);
    });

    const fallbackUser = (): AuthUser | null => readLastUser();
    const toOfflineOrSignedOut = () => {
      const known = fallbackUser();
      if (known) setState({ status: 'offline-known', user: known });
      else setState({ status: 'signed-out' });
    };

    void (async () => {
      let pending: ReturnType<typeof client.auth.getSession>;
      try {
        pending = client.auth.getSession();
      } catch {
        if (!cancelled) toOfflineOrSignedOut();
        return;
      }
      try {
        const result = await withTimeout(pending, bootTimeoutMs);
        if (cancelled) return;
        if (result === TIMED_OUT) {
          // Сеть не отвечает. Если сессия всё же найдётся позже — onAuthStateChange поднимет состояние до signed-in.
          toOfflineOrSignedOut();
          void pending.then(
            (late) => {
              const user = userOf(late.data.session);
              if (!cancelled && user) signedIn(user);
            },
            () => undefined,
          );
          return;
        }
        const user = userOf(result.data.session);
        if (user) {
          signedIn(user);
        } else if (result.error && isNetworkError(result.error)) {
          toOfflineOrSignedOut();
        } else if (isOffline() && fallbackUser()) {
          // сессии в хранилище нет, но человек входил здесь и не выходил, а сети нет — оставляем его данные доступными
          toOfflineOrSignedOut();
        } else {
          signedOut();
        }
      } catch {
        if (!cancelled) toOfflineOrSignedOut();
      }
    })();

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [client, bootTimeoutMs]);

  const signIn = useCallback(async (emailRaw: string, password: string): Promise<AuthResult> => {
    const c = clientRef.current;
    if (!c) return { ok: false, message: 'Облако не подключено: вход не нужен' };
    const email = emailRaw.trim().toLowerCase();
    if (email === '' || !email.includes('@')) return { ok: false, message: 'Введите почту, например name@example.com' };
    if (password === '') return { ok: false, message: 'Введите пароль' };
    try {
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, message: describeAuthError(error, 'sign-in') };
      const user = userOf(data.session ?? (data.user ? { user: data.user } : null));
      if (!user) return { ok: false, message: 'Не удалось войти. Попробуйте ещё раз.' };
      writeLastUser(user);
      setState({ status: 'signed-in', user });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: describeAuthError(e, 'sign-in') };
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const c = clientRef.current;
    if (!c) return;
    // Сначала забываем «последнего пользователя»: выход не должен оставлять чужие данные открываемыми без входа.
    clearLastUser();
    try {
      const { error } = await c.auth.signOut({ scope: 'local' });
      if (error) {
        // Сессия на устройстве должна исчезнуть при любом исходе, иначе после перезапуска человек «вернётся» сам.
        try {
          localStorage.removeItem(AUTH_STORAGE_KEY);
        } catch {
          // нет доступа к хранилищу — больше ничего сделать нельзя
        }
      }
    } catch {
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } catch {
        // см. выше
      }
    }
    setState({ status: 'signed-out' });
  }, []);

  const changePassword = useCallback(async (password: string, repeat: string): Promise<AuthResult> => {
    const c = clientRef.current;
    if (!c) return { ok: false, message: 'Облако не подключено: пароля нет' };
    const problem = checkNewPassword(password, repeat);
    if (problem) return { ok: false, message: problem };
    try {
      const { error } = await c.auth.updateUser({ password });
      if (error) return { ok: false, message: describeAuthError(error, 'password') };
      return { ok: true };
    } catch (e) {
      return { ok: false, message: describeAuthError(e, 'password') };
    }
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      cloud: client !== null,
      state,
      user: state.status === 'signed-in' || state.status === 'offline-known' ? state.user : null,
      signIn,
      signOut,
      changePassword,
    }),
    [client, state, signIn, signOut, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth: оберните приложение в <AuthProvider>');
  return ctx;
}
