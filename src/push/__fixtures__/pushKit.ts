/**
 * Помощники ТОЛЬКО для тестов напоминаний: поддельный Supabase (две таблицы + функция send-reminders) и поддельный браузер
 * (сервис-воркер, PushManager, Notification). В боевой код не попадает (папка __fixtures__ исключена из сборки).
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError, type SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { decodeBase64Url } from '../config';

/** Настоящая точка P-256 (публичный ключ) — не секретный, сделан только для тестов. */
export const VAPID_PUBLIC = 'BCl9Na6L3jfcZ90djotMv3DPypj4qFW2SMstrtSImSvs6BwyjvEfKfNF8DsaYegHRZfR9Evgc7olyLEBfiAcmBw';
/** Ещё один, другой ключ (для проверки «ключ сервера сменили»). */
export const VAPID_PUBLIC_OTHER = 'BBD9URtWcn7wWh14PrmfFqyJzg850IRO-jWG8_2dZ87RZwNKp7Z9tqJA-Kg00AhPWU6rxs6qFqdK26dXX6m2fKc';
export const USER = '0a3a28c0-5fdc-4385-8fca-7c24d9aaaa48';
export const OTHER_USER = '99999999-9999-4999-8999-999999999999';
export const P256DH = 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAqgPoerZxuKO7T0Z8-3x2cXuhgUCXq_4mFWPlOZJbyUQsTwzxqrQG4JkLs';
export const AUTH_SECRET = 'tBHItJI5svbpez7KI4CCXg';
export const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dGVzdC1lbmRwb2ludC0x';
export const ENDPOINT_2 = 'https://fcm.googleapis.com/fcm/send/dGVzdC1lbmRwb2ludC0y';

/* ------------------------------ поддельный Supabase ------------------------------ */

export type Row = Record<string, unknown>;
type Filter = [kind: 'eq' | 'neq' | 'is', column: string, value: unknown];

export interface FakeCall {
  table: string;
  op: 'select' | 'upsert' | 'update';
  payload?: Row;
  options?: unknown;
  filters: Filter[];
}

export type FnMode = 'ok' | 'none' | 'not-ok' | 'string-body' | 'garbage' | 'http-404' | 'http-500' | 'http-401' | 'http-429' | 'http-503' | 'network' | 'relay' | 'hang';

export interface FakeCloud {
  client: SupabaseClient;
  userId: string | null;
  tables: { reminder_settings: Row[]; push_subscriptions: Row[] };
  calls: FakeCall[];
  invokes: Array<{ name: string; options: unknown }>;
  /** true — любой запрос падает как «нет сети». */
  offline: boolean;
  /** Ошибка PostgREST для следующего запроса к таблице: ключ 'таблица' или 'таблица:операция'. */
  failNext(key: string, error: { code?: string; message?: string }, status?: number): void;
  /** Что ответит функция send-reminders. */
  fn: { mode: FnMode; sent: number };
  /** Пока не вызван release — запросы к таблицам «висят» (проверка двойных нажатий и состояния во время сохранения). */
  hold(): () => void;
}

const SETTINGS_DEFAULTS: Row = {
  enabled: false,
  hour_local: 9,
  timezone: 'Asia/Dushanbe',
  remind_payments: true,
  remind_debts: true,
  remind_daily: false,
  show_details: false,
};

const CONFLICT: Record<string, string[]> = { reminder_settings: ['user_id'], push_subscriptions: ['user_id', 'endpoint'] };

export function fakeCloud(opts: { userId?: string | null; settings?: Row | null; subscriptions?: Row[] } = {}): FakeCloud {
  const userId = opts.userId === undefined ? USER : opts.userId;
  const cloud: FakeCloud = {
    client: undefined as unknown as SupabaseClient,
    userId,
    tables: {
      reminder_settings: opts.settings ? [{ user_id: userId, ...SETTINGS_DEFAULTS, ...opts.settings }] : [],
      push_subscriptions: (opts.subscriptions ?? []).map((s, i) => ({
        id: `sub-${i}`,
        user_id: userId,
        user_agent: '',
        revoked_at: null,
        ...s,
      })),
    },
    calls: [],
    invokes: [],
    offline: false,
    failNext(key, error, status) {
      failures.set(key, { error, status });
    },
    fn: { mode: 'ok', sent: 1 },
    hold() {
      let release!: () => void;
      gate = new Promise<void>((r) => {
        release = r;
      });
      return () => {
        release();
        gate = null;
      };
    },
  };
  const failures = new Map<string, { error: { code?: string; message?: string }; status?: number }>();
  let gate: Promise<void> | null = null;
  let serial = 100;

  const matches = (row: Row, filters: Filter[]): boolean =>
    row.user_id === cloud.userId && // имитация RLS: чужих строк не видно и не тронуть
    filters.every(([kind, col, val]) => (kind === 'eq' ? row[col] === val : kind === 'neq' ? row[col] !== val : (row[col] ?? null) === val));

  function from(table: 'reminder_settings' | 'push_subscriptions') {
    const rows = cloud.tables[table];
    const state = { op: 'select' as FakeCall['op'], payload: undefined as Row | undefined, options: undefined as unknown, filters: [] as Filter[], returning: false, single: null as null | 'single' | 'maybe' };
    const q = {
      select(_cols?: string) {
        state.returning = true;
        return q;
      },
      upsert(payload: Row, options?: unknown) {
        state.op = 'upsert';
        state.payload = payload;
        state.options = options;
        return q;
      },
      update(payload: Row) {
        state.op = 'update';
        state.payload = payload;
        return q;
      },
      eq(col: string, val: unknown) {
        state.filters.push(['eq', col, val]);
        return q;
      },
      neq(col: string, val: unknown) {
        state.filters.push(['neq', col, val]);
        return q;
      },
      is(col: string, val: unknown) {
        state.filters.push(['is', col, val]);
        return q;
      },
      single() {
        state.single = 'single';
        return q;
      },
      maybeSingle() {
        state.single = 'maybe';
        return q;
      },
      then<T>(res: (v: unknown) => T, rej?: (e: unknown) => T) {
        return run().then(res, rej);
      },
    };

    async function run() {
      cloud.calls.push({ table, op: state.op, payload: state.payload, options: state.options, filters: state.filters });
      if (gate) await gate;
      if (cloud.offline) throw new TypeError('Failed to fetch');
      const failure = failures.get(`${table}:${state.op}`) ?? failures.get(table);
      if (failure) {
        failures.delete(`${table}:${state.op}`);
        failures.delete(table);
        return { data: null, error: { message: failure.error.message ?? 'error', code: failure.error.code }, status: failure.status ?? 400 };
      }
      if (cloud.userId === null) return { data: null, error: { message: 'permission denied', code: '42501' }, status: 401 };
      let out: Row[] = [];
      if (state.op === 'select') {
        out = rows.filter((r) => matches(r, state.filters)).map((r) => ({ ...r }));
      } else if (state.op === 'update') {
        for (const r of rows) if (matches(r, state.filters)) Object.assign(r, state.payload);
        out = rows.filter((r) => matches(r, [])).map((r) => ({ ...r }));
      } else {
        const payload = { ...state.payload };
        if ('user_id' in payload) throw new Error('приложение не должно отправлять user_id');
        const keys = CONFLICT[table]!;
        const existing = rows.find((r) => r.user_id === cloud.userId && keys.every((k) => k === 'user_id' || r[k] === payload[k]));
        if (existing) {
          Object.assign(existing, payload);
          out = [{ ...existing }];
        } else {
          const fresh: Row =
            table === 'reminder_settings'
              ? { ...SETTINGS_DEFAULTS, user_id: cloud.userId, ...payload }
              : { id: `sub-${serial++}`, user_id: cloud.userId, user_agent: '', created_at: 'now', revoked_at: null, ...payload };
          rows.push(fresh);
          out = [{ ...fresh }];
        }
      }
      if (!state.returning && state.op !== 'select') return { data: null, error: null, status: 204 };
      if (state.single === 'single') {
        return out.length === 1 ? { data: out[0], error: null, status: 200 } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, status: 406 };
      }
      if (state.single === 'maybe') return { data: out[0] ?? null, error: null, status: 200 };
      return { data: out, error: null, status: 200 };
    }
    return q;
  }

  async function invoke(name: string, options?: unknown) {
    cloud.invokes.push({ name, options });
    const m = cloud.fn.mode;
    if (m === 'hang') return new Promise<never>(() => undefined);
    if (cloud.offline || m === 'network') return { data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) };
    if (m === 'relay') return { data: null, error: new FunctionsRelayError({ status: 502 }) };
    if (m.startsWith('http-')) return { data: null, error: new FunctionsHttpError({ status: Number(m.slice(5)) }) };
    if (m === 'none') return { data: { ok: true, sent: 0 }, error: null };
    if (m === 'not-ok') return { data: { ok: false, sent: 0 }, error: null };
    if (m === 'string-body') return { data: JSON.stringify({ ok: true, sent: cloud.fn.sent }), error: null };
    if (m === 'garbage') return { data: '<html>', error: null };
    return { data: { ok: true, sent: cloud.fn.sent }, error: null };
  }

  cloud.client = {
    from,
    functions: { invoke },
    auth: {
      getSession: async () => ({ data: { session: userId ? { user: { id: userId, email: 'x@example.com' } } : null }, error: null }),
    },
  } as unknown as SupabaseClient;
  return cloud;
}

/* ------------------------------ поддельный браузер ------------------------------ */

export interface FakeBrowserOptions {
  permission?: NotificationPermission;
  /** Что ответит человек на вопрос о разрешении. */
  answer?: NotificationPermission;
  /** Подписка в браузере уже есть (адрес ENDPOINT). */
  subscribed?: boolean | string;
  /** subscribe() упадёт этой ошибкой; 'hang' — зависнет. */
  subscribeError?: Error | 'hang';
  userAgent?: string;
  standalone?: boolean;
  /** Нет PushManager / Notification / serviceWorker. */
  without?: Array<'PushManager' | 'Notification' | 'serviceWorker'>;
  /** Ключ, с которым «уже оформлена» прежняя подписка (по умолчанию VAPID_PUBLIC). */
  existingKey?: string;
}

export interface FakeBrowser {
  state: { permission: NotificationPermission; sub: FakeSubscription | null; subscribeCalls: Array<{ userVisibleOnly?: boolean; applicationServerKey?: Uint8Array }>; permissionRequests: number; nextEndpoint: string };
  messages: unknown[];
  fireMessage(data: unknown): void;
  restore(): void;
}

export interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  toJSON(): { endpoint: string; keys: { p256dh: string; auth: string } };
  getKey(name: string): ArrayBuffer | null;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const toBuffer = (b64: string): ArrayBuffer => {
  const bytes = decodeBase64Url(b64)!;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
export const UA = { iphone: IPHONE_UA, iphoneOld: IPHONE_UA.replace('17_2', '15_8'), iphone164: IPHONE_UA.replace('17_2', '16_4'), android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' };

/** Подставляет в jsdom браузерные возможности push. restore() возвращает всё как было. */
export function installFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const w = window as unknown as Record<string, unknown>;
  const nav = navigator as unknown as Record<string, unknown>;
  const saved: Array<() => void> = [];
  const define = (target: object, key: string, value: unknown) => {
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const prev = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
    saved.push(() => {
      if (had && prev) Object.defineProperty(target, key, prev);
      else delete (target as Record<string, unknown>)[key];
    });
  };
  const without = new Set(options.without ?? []);
  const browser: FakeBrowser = {
    state: {
      permission: options.permission ?? 'default',
      sub: null,
      subscribeCalls: [],
      permissionRequests: 0,
      nextEndpoint: ENDPOINT,
    },
    messages: [],
    fireMessage: () => undefined,
    restore: () => {
      for (const undo of saved.reverse()) undo();
      saved.length = 0;
    },
  };
  const listeners = new Set<(e: MessageEvent) => void>();
  browser.fireMessage = (data) => {
    for (const l of [...listeners]) l({ data } as MessageEvent);
  };

  const makeSub = (endpoint: string, key: string): FakeSubscription => {
    const sub: FakeSubscription = {
      endpoint,
      options: { applicationServerKey: toBuffer(key) },
      toJSON: () => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH_SECRET } }),
      getKey: (name) => (name === 'p256dh' ? toBuffer(P256DH) : name === 'auth' ? toBuffer(AUTH_SECRET) : null),
      unsubscribe: vi.fn(async () => {
        if (browser.state.sub === sub) browser.state.sub = null;
        return true;
      }),
    };
    return sub;
  };
  if (options.subscribed) browser.state.sub = makeSub(typeof options.subscribed === 'string' ? options.subscribed : ENDPOINT, options.existingKey ?? VAPID_PUBLIC);

  const pushManager = {
    getSubscription: vi.fn(async () => browser.state.sub),
    subscribe: vi.fn(async (o: { userVisibleOnly?: boolean; applicationServerKey?: Uint8Array }) => {
      browser.state.subscribeCalls.push(o);
      if (options.subscribeError === 'hang') return new Promise<never>(() => undefined);
      if (options.subscribeError) throw options.subscribeError;
      if (browser.state.sub) return browser.state.sub;
      const key = o.applicationServerKey ? btoa(String.fromCharCode(...o.applicationServerKey)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : VAPID_PUBLIC;
      browser.state.sub = makeSub(browser.state.nextEndpoint, key);
      return browser.state.sub;
    }),
  };
  const reg = { scope: 'http://localhost/', pushManager };

  if (!without.has('serviceWorker')) {
    define(nav, 'serviceWorker', {
      ready: Promise.resolve(reg),
      getRegistration: async () => reg,
      addEventListener: (_t: string, l: (e: MessageEvent) => void) => void listeners.add(l),
      removeEventListener: (_t: string, l: (e: MessageEvent) => void) => void listeners.delete(l),
    });
  } else if ('serviceWorker' in navigator) {
    define(nav, 'serviceWorker', undefined);
  }
  if (!without.has('PushManager')) define(w, 'PushManager', class PushManager {});
  if (!without.has('Notification')) {
    const N = {
      get permission() {
        return browser.state.permission;
      },
      requestPermission: vi.fn(async (cb?: (p: NotificationPermission) => void) => {
        browser.state.permissionRequests++;
        if (browser.state.permission === 'default') browser.state.permission = options.answer ?? 'granted';
        cb?.(browser.state.permission);
        return browser.state.permission;
      }),
    };
    define(w, 'Notification', N);
  }
  define(nav, 'userAgent', options.userAgent ?? UA.android);
  define(nav, 'standalone', options.standalone ?? false);
  define(w, 'isSecureContext', true);
  return browser;
}

/** Ждёт, пока выполнится проверка (асинхронные цепочки в тестах). */
export const flush = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
