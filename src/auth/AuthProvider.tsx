import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { describeAuthError, isNetworkError } from './authErrors';
import { LOCAL_USER, isSafeUserId, type AuthUser } from './config';
import { AUTH_STORAGE_KEY } from './supabaseClient';
import { clearLastUser, readLastUser, writeLastUser } from './lastUser';
import { checkNewPassword } from './passwordRules';
import { releasePushOnThisDevice } from '@/push/release';
import {
  classifyCodeRequestError,
  CODE_MISSING_TEXT,
  describeCodeVerifyError,
  EMAIL_EMPTY_TEXT,
  extractCode,
  isCodeComplete,
  isPlausibleEmail,
  normalizeEmail,
} from './emailCode';
import { clearLock } from '@/lock/lockStore';

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

/** `confirm: true` — регистрация прошла, но Supabase просит подтвердить почту по письму: войти можно только после этого. */
export type AuthResult = { ok: true; confirm?: boolean } | { ok: false; message: string };

/** Ровно та часть клиента Supabase, которую использует вход. Настоящий SupabaseClient ей подходит; в тестах — подмена. */
export type AuthClientLike = {
  auth: Pick<
    SupabaseClient['auth'],
    | 'getSession'
    | 'onAuthStateChange'
    | 'signInWithPassword'
    | 'signInWithOtp'
    | 'verifyOtp'
    | 'signUp'
    | 'signOut'
    | 'updateUser'
    | 'refreshSession'
  >;
};

export interface AuthApi {
  /** false — облако не настроено (локальный режим): входа и выхода нет. */
  cloud: boolean;
  state: AuthState;
  /** Пользователь, чьи данные открыты (в локальном режиме — фиксированный). null — никто. */
  user: AuthUser | null;
  signIn(email: string, password: string): Promise<AuthResult>;
  /**
   * Вход по коду, шаг 1: попросить код на почту. Новых пользователей НЕ создаёт (регистрации нет).
   * ok:true означает только «можно переходить к вводу кода»: на неизвестную почту ответ такой же, как на известную
   * (иначе по ответу можно было бы перебирать чужие адреса), просто код не придёт. Честно сообщаются нет сети, лимит попыток, сбой сервера.
   */
  requestEmailCode(email: string): Promise<AuthResult>;
  /** Вход по коду, шаг 2: проверить код из письма. Дальше всё как у входа по паролю. */
  verifyEmailCode(email: string, code: string): Promise<AuthResult>;
  /** Регистрация по почте и паролю. Если подтверждение почты не нужно — сразу входит. */
  signUp(email: string, password: string): Promise<AuthResult>;
  /** Выход с этого устройства. Локальная база пользователя СОХРАНЯЕТСЯ. Не бросает ошибок. */
  signOut(): Promise<void>;
  changePassword(password: string, repeat: string): Promise<AuthResult>;
}

const AuthContext = createContext<AuthApi | null>(null);

export const DEFAULT_BOOT_TIMEOUT_MS = 4000;

/** Сколько ждать ответа сети при выходе, мс. Дольше нет смысла: сессию на устройстве мы снимаем в любом случае. */
export const SIGN_OUT_WAIT_MS = 1000;

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
  // Номер «поколения» входа: растёт при выходе и входе. Запоздалый ответ getSession из прошлого поколения игнорируется,
  // иначе человек, уже нажавший «Выйти», вернулся бы в аккаунт сам (слабая сеть: getSession отвечает через минуту).
  const epochRef = useRef(0);
  // true — человек сам вышел и после этого не входил: события «сессия найдена» из прошлого (INITIAL_SESSION и т.п.) не верим.
  const leftRef = useRef(false);
  // Кто сейчас открыт: нужно при выходе, чтобы снять его «замок» (повторный вход по почте уже доказывает личность).
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = state.status === 'signed-in' || state.status === 'offline-known' ? state.user.id : null;
  // Одинаковые запросы, идущие прямо сейчас, склеиваются в один: двойное нажатие не шлёт второе письмо и не тратит код дважды.
  const inflightRef = useRef(new Map<string, Promise<AuthResult>>());

  useEffect(() => {
    if (!client) {
      setState({ status: 'signed-in', user: LOCAL_USER });
      return undefined;
    }
    let cancelled = false;
    const bootEpoch = epochRef.current;
    const stale = () => cancelled || epochRef.current !== bootEpoch;

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
      // После нашего выхода верим только настоящему новому входу (в том числе из другой вкладки).
      if (leftRef.current && event !== 'SIGNED_IN') return;
      const user = userOf(session);
      if (user) {
        if (event === 'SIGNED_IN') leftRef.current = false;
        signedIn(user);
      }
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
        if (!stale()) toOfflineOrSignedOut();
        return;
      }
      try {
        const result = await withTimeout(pending, bootTimeoutMs);
        if (stale()) return;
        if (result === TIMED_OUT) {
          // Сеть не отвечает. Если сессия всё же найдётся позже — onAuthStateChange поднимет состояние до signed-in.
          toOfflineOrSignedOut();
          void pending.then(
            (late) => {
              const user = userOf(late.data.session);
              if (!stale() && user) signedIn(user);
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
        if (!stale()) toOfflineOrSignedOut();
      }
    })();

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [client, bootTimeoutMs]);

  /** Общий конец любого входа: новое «поколение», запомнить человека, перейти в signed-in (тот же человек — тот же объект). */
  const enter = useCallback((user: AuthUser) => {
    epochRef.current++;
    leftRef.current = false;
    writeLastUser(user);
    setState((cur) =>
      cur.status === 'signed-in' && cur.user.id === user.id && cur.user.email === user.email ? cur : { status: 'signed-in', user },
    );
  }, []);

  const signIn = useCallback(
    async (emailRaw: string, password: string): Promise<AuthResult> => {
      const c = clientRef.current;
      if (!c) return { ok: false, message: 'Облако не подключено: вход не нужен' };
      const email = normalizeEmail(emailRaw); // та же очистка, что и при входе по коду: невидимые символы из вставки не должны ломать адрес
      if (email === '' || !email.includes('@')) return { ok: false, message: 'Введите почту, например name@example.com' };
      if (password === '') return { ok: false, message: 'Введите пароль' };
      try {
        const { data, error } = await c.auth.signInWithPassword({ email, password });
        if (error) return { ok: false, message: describeAuthError(error, 'sign-in') };
        const user = userOf(data.session ?? (data.user ? { user: data.user } : null));
        if (!user) return { ok: false, message: 'Не удалось войти. Попробуйте ещё раз.' };
        enter(user);
        return { ok: true };
      } catch (e) {
        return { ok: false, message: describeAuthError(e, 'sign-in') };
      }
    },
    [enter],
  );

  const requestEmailCode = useCallback((emailRaw: string): Promise<AuthResult> => {
    const c = clientRef.current;
    if (!c) return Promise.resolve({ ok: false, message: 'Облако не подключено: вход не нужен' });
    const email = normalizeEmail(emailRaw);
    if (!isPlausibleEmail(email)) return Promise.resolve({ ok: false, message: EMAIL_EMPTY_TEXT });
    const key = `request:${email}`;
    const running = inflightRef.current.get(key);
    if (running) return running;
    const task = (async (): Promise<AuthResult> => {
      try {
        // shouldCreateUser: false — регистрации в приложении нет, письмо с кодом нельзя использовать для создания аккаунта
        const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        if (!error) return { ok: true };
        const outcome = classifyCodeRequestError(error);
        return outcome.kind === 'neutral' ? { ok: true } : { ok: false, message: outcome.message };
      } catch (e) {
        const outcome = classifyCodeRequestError(e);
        return outcome.kind === 'neutral' ? { ok: true } : { ok: false, message: outcome.message };
      }
    })().finally(() => {
      inflightRef.current.delete(key);
    });
    inflightRef.current.set(key, task);
    return task;
  }, []);

  const verifyEmailCode = useCallback(
    (emailRaw: string, codeRaw: string): Promise<AuthResult> => {
      const c = clientRef.current;
      if (!c) return Promise.resolve({ ok: false, message: 'Облако не подключено: вход не нужен' });
      const email = normalizeEmail(emailRaw);
      if (!isPlausibleEmail(email)) return Promise.resolve({ ok: false, message: EMAIL_EMPTY_TEXT });
      const token = extractCode(codeRaw);
      if (!isCodeComplete(token)) return Promise.resolve({ ok: false, message: CODE_MISSING_TEXT });
      const key = `verify:${email}:${token}`;
      const running = inflightRef.current.get(key);
      if (running) return running;
      const task = (async (): Promise<AuthResult> => {
        try {
          const { data, error } = await c.auth.verifyOtp({ email, token, type: 'email' });
          if (error) return { ok: false, message: describeCodeVerifyError(error) };
          // Без сессии (токенов) входа нет, даже если сервер вернул пользователя.
          const user = userOf(data.session);
          if (!user) return { ok: false, message: 'Не удалось войти. Попробуйте ещё раз.' };
          enter(user);
          return { ok: true };
        } catch (e) {
          return { ok: false, message: describeCodeVerifyError(e) };
        }
      })().finally(() => {
        inflightRef.current.delete(key);
      });
      inflightRef.current.set(key, task);
      return task;
    },
    [enter],
  );

  const signUp = useCallback(async (emailRaw: string, password: string): Promise<AuthResult> => {
    const c = clientRef.current;
    if (!c) return { ok: false, message: 'Облако не подключено: регистрация не нужна' };
    const email = emailRaw.trim().toLowerCase();
    if (email === '' || !email.includes('@')) return { ok: false, message: 'Введите почту, например name@example.com' };
    const problem = checkNewPassword(password, password);
    if (problem) return { ok: false, message: problem };
    try {
      const { data, error } = await c.auth.signUp({ email, password });
      if (error) return { ok: false, message: describeAuthError(error, 'sign-up') };
      // Почта уже занята: при включённом подтверждении Supabase не выдаёт ошибку, а возвращает пользователя без «identities»
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { ok: false, message: 'Эта почта уже зарегистрирована. Войдите.' };
      }
      const user = userOf(data.session);
      if (!user) return { ok: true, confirm: true };
      epochRef.current++;
      leftRef.current = false;
      writeLastUser(user);
      setState({ status: 'signed-in', user });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: describeAuthError(e, 'sign-up') };
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const c = clientRef.current;
    if (!c) return;
    // Сначала забываем «последнего пользователя»: выход не должен оставлять чужие данные открываемыми без входа.
    const leavingUserId = userIdRef.current;
    epochRef.current++;
    leftRef.current = true;
    clearLastUser();
    const forgetSession = () => {
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } catch {
        // нет доступа к хранилищу — больше ничего сделать нельзя
      }
    };
    // Устройство отвязывается от напоминаний ДО выхода, пока сессия жива (иначе напоминания вышедшего придут на экран следующего
    // человека на этом телефоне). Не бросает ошибок и ждёт не дольше пары секунд.
    const full = c as unknown as SupabaseClient;
    if (typeof full.from === 'function') await releasePushOnThisDevice(full);
    try {
      // Сеть «есть, но не отвечает» не должна держать человека в аккаунте: ждём недолго, дальше снимаем сессию сами.
      const outcome = await withTimeout(c.auth.signOut({ scope: 'local' }), SIGN_OUT_WAIT_MS);
      // Сессия на устройстве должна исчезнуть при любом исходе, иначе после перезапуска человек «вернётся» сам.
      if (outcome === TIMED_OUT || outcome.error) forgetSession();
    } catch {
      forgetSession();
    }
    // Выход снимает «замок» этого пользователя: личность докажет следующий вход по почте. Делаем это после того, как сессия снята,
    // иначе пока шёл выход, под закрытой заслонкой могло бы мелькнуть содержимое.
    if (leavingUserId) clearLock(leavingUserId, true);
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
      requestEmailCode,
      verifyEmailCode,
      signUp,
      signOut,
      changePassword,
    }),
    [client, state, signIn, requestEmailCode, verifyEmailCode, signUp, signOut, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth: оберните приложение в <AuthProvider>');
  return ctx;
}
