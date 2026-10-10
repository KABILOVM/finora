/**
 * Помощники ТОЛЬКО для тестов: подменный вход (без сети), подменный движок синхронизации, зависимости с отдельной
 * fake-indexeddb на каждый тест и отрисовка всего приложения. В боевой код не попадает (его никто не импортирует).
 */
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@/components/testUtils';
import { ToastProvider } from '@/components/Toast';
import { FinoraDB, openStore, type Store } from '@/db';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import { META_INITIAL_PULL, type CreateSyncEngineOptions, type SyncEngine } from '@/sync/engine';
import type { SyncStatus, SyncTransport } from '@/sync/transport';
import { AppRoot } from './AppRoot';
import type { SessionDeps } from './deps';

// ---------- подменный вход ----------

export interface FakeAccount {
  id: string;
  email: string;
  password: string;
}

export const ALICE: FakeAccount = { id: '11111111-1111-4111-8111-111111111111', email: 'alice@example.com', password: 'alice-password' };
export const BOB: FakeAccount = { id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.com', password: 'bob-password' };

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

function authError(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { name, ...extra });
}

export interface FakeAuthOptions {
  accounts?: FakeAccount[];
  /** Кто уже вошёл (сессия лежит в хранилище). */
  session?: FakeAccount | null;
  /** 'hang' — getSession не отвечает никогда; 'network' — отвечает сетевой ошибкой. */
  getSession?: 'ok' | 'hang' | 'network';
  /** true — любая сетевая операция падает («нет сети»). */
  offline?: boolean;
}

export function fakeAuthClient(options: FakeAuthOptions = {}) {
  const accounts = options.accounts ?? [ALICE, BOB];
  let current: FakeAccount | null = options.session ?? null;
  const listeners = new Set<Listener>();
  const calls = { signIn: 0, signOut: 0, updateUser: 0, refreshSession: 0, getSession: 0, signOutArgs: [] as unknown[] };
  const state = {
    offline: options.offline ?? false,
    getSession: options.getSession ?? 'ok',
    lastPassword: null as string | null,
    /** true — signOut возвращает ошибку сети и сессию НЕ снимает. */
    signOutFails: false,
  };

  const sessionOf = (a: FakeAccount | null): Session | null =>
    a
      ? ({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: a.id, email: a.email },
        } as unknown as Session)
      : null;
  const emit = (event: AuthChangeEvent, a: FakeAccount | null) => {
    for (const l of [...listeners]) l(event, sessionOf(a));
  };
  const networkError = () => authError('AuthRetryableFetchError', 'Failed to fetch', { status: 0 });

  const auth = {
    async getSession() {
      calls.getSession++;
      if (state.getSession === 'hang') return new Promise<never>(() => undefined);
      if (state.getSession === 'network') return { data: { session: null }, error: networkError() };
      return { data: { session: sessionOf(current) }, error: null };
    },
    onAuthStateChange(cb: Listener) {
      listeners.add(cb);
      queueMicrotask(() => {
        if (listeners.has(cb)) cb('INITIAL_SESSION', sessionOf(current));
      });
      return { data: { subscription: { unsubscribe: () => void listeners.delete(cb) } } };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      calls.signIn++;
      if (state.offline) return { data: { user: null, session: null }, error: networkError() };
      const found = accounts.find((a) => a.email === email && a.password === password);
      if (!found) {
        return {
          data: { user: null, session: null },
          error: authError('AuthApiError', 'Invalid login credentials', { status: 400, code: 'invalid_credentials' }),
        };
      }
      current = found;
      const session = sessionOf(found);
      emit('SIGNED_IN', found);
      return { data: { user: session?.user ?? null, session }, error: null };
    },
    async signOut(args?: unknown) {
      calls.signOut++;
      calls.signOutArgs.push(args);
      if (state.signOutFails) return { error: networkError() };
      current = null;
      emit('SIGNED_OUT', null);
      return { error: null };
    },
    async updateUser({ password }: { password: string }) {
      calls.updateUser++;
      if (state.offline) return { data: { user: null }, error: networkError() };
      if (current && password === current.password) {
        return {
          data: { user: null },
          error: authError('AuthApiError', 'New password should be different from the old password.', { status: 422, code: 'same_password' }),
        };
      }
      state.lastPassword = password;
      return { data: { user: null }, error: null };
    },
    async refreshSession() {
      calls.refreshSession++;
      return { data: { session: sessionOf(current), user: null }, error: current ? null : authError('AuthSessionMissingError', 'no session') };
    },
  };

  return {
    client: { auth } as unknown as SupabaseClient,
    calls,
    state,
    /** Сеть появилась / пропала. */
    setOffline(v: boolean) {
      state.offline = v;
    },
    /** Событие от «сервера»: например, сессия обновилась после появления сети. */
    emit,
    setSession(a: FakeAccount | null) {
      current = a;
    },
    get current() {
      return current;
    },
  };
}

// ---------- подменный движок синхронизации ----------

export interface FakeEngine extends SyncEngine {
  options: CreateSyncEngineOptions;
  calls: { start: number; stop: number; dispose: number; syncNow: string[] };
  /** Изменить статус и оповестить подписчиков. */
  set(patch: Partial<SyncStatus>): void;
  /** Выполнить «первую загрузку»: затравка, отметка в базе, статус «всё отправлено». */
  completeFirstPull(): Promise<void>;
}

export interface FakeEngineControl {
  /** Пока false, движок «без сети»: первая загрузка не проходит. */
  online: boolean;
}

export function makeFakeEngine(options: CreateSyncEngineOptions, control: FakeEngineControl): FakeEngine {
  let status: SyncStatus = { phase: 'idle', pending: 0, quarantined: 0, lastSyncedAt: null, lastError: null };
  const listeners = new Set<(s: SyncStatus) => void>();
  const calls: FakeEngine['calls'] = { start: 0, stop: 0, dispose: 0, syncNow: [] };
  const set = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    for (const l of [...listeners]) l(status);
  };
  const run = async () => {
    if (!control.online) {
      set({ phase: 'offline' });
      return;
    }
    set({ phase: 'syncing' });
    try {
      if ((await options.store.sync.getMeta(META_INITIAL_PULL)) !== true) {
        await options.afterFirstPull?.();
        await options.store.sync.setMeta(META_INITIAL_PULL, true);
      }
      set({ phase: 'idle', lastSyncedAt: new Date().toISOString(), lastError: null });
    } catch (e) {
      set({ phase: 'error', lastError: e instanceof Error ? e.message : String(e) });
    }
  };
  return {
    options,
    calls,
    set,
    completeFirstPull: run,
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => void listeners.delete(listener);
    },
    getStatus: () => status,
    async syncNow(reason) {
      calls.syncNow.push(reason ?? '');
      await run();
    },
    start() {
      calls.start++;
      void run();
    },
    stop() {
      calls.stop++;
    },
    dispose() {
      calls.dispose++;
    },
  };
}

// ---------- зависимости сеанса для тестов ----------

export interface TestDepsOptions {
  /** Сеть для движка: false — первая загрузка не проходит. */
  online?: boolean;
}

export interface TestDeps {
  deps: SessionDeps;
  factory: IDBFactory;
  control: FakeEngineControl;
  engines: FakeEngine[];
  /** Открытые сейчас (и уже закрытые) хранилища в порядке открытия. */
  stores: Store[];
  opened: string[];
  deleted: string[];
}

export function makeTestDeps(options: TestDepsOptions = {}): TestDeps {
  const factory = new IDBFactory();
  const control: FakeEngineControl = { online: options.online ?? true };
  const engines: FakeEngine[] = [];
  const stores: Store[] = [];
  const opened: string[] = [];
  const deleted: string[] = [];
  const dexie = { indexedDB: factory, IDBKeyRange };
  const transport: SyncTransport = {
    pull: () => Promise.reject(new Error('Сеть в тестах запрещена')),
    push: () => Promise.reject(new Error('Сеть в тестах запрещена')),
  };
  const deps: SessionDeps = {
    async openStore(userId) {
      opened.push(userId);
      const store = await openStore(userId, { deviceId: 'device-test-1', dexie });
      stores.push(store);
      return store;
    },
    createTransport: () => transport,
    createEngine(opts) {
      const engine = makeFakeEngine(opts, control);
      engines.push(engine);
      return engine;
    },
    createRates: () => createRateService({ providers: [], storage: createMemoryRateStorage() }),
    async deleteLocalData(userId) {
      deleted.push(userId);
      await new FinoraDB(userId, dexie).delete();
    },
  };
  return { deps, factory, control, engines, stores, opened, deleted };
}

// ---------- отрисовка ----------

export interface RenderAppOptions {
  client?: SupabaseClient | null;
  deps?: SessionDeps;
  path?: string;
  /** state первой записи истории (например, { background } для шита поверх страницы). */
  state?: unknown;
  bootTimeoutMs?: number;
}

/** Всё приложение целиком вокруг переданного содержимого (обычно <AppRoutes />). */
export function renderAppRoot(ui: ReactNode, options: RenderAppOptions = {}) {
  const { client = null, deps, path = '/', state, bootTimeoutMs } = options;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[state === undefined ? path : { pathname: path, state }]}>
        <AppRoot client={client} deps={deps} bootTimeoutMs={bootTimeoutMs}>
          {ui}
        </AppRoot>
      </MemoryRouter>
    </ToastProvider>,
  );
}
