import { afterEach, beforeEach, vi } from 'vitest';
import {
  DbError,
  type DebtLite,
  type DebtTxLite,
  type EndpointClaim,
  type HandlerDeps,
  type LogEntry,
  type PushSub,
  type ReminderSettingsRow,
  type ReminderStore,
  type RuleLite,
  type SendResult,
  type Sender,
  type SettingsPage,
} from '../../supabase/functions/send-reminders/index';

/** Общие заготовки тестов функции send-reminders (только для тестов). */

export const URL_BASE = 'https://proj.supabase.co';
export const FUNCTION_URL = `${URL_BASE}/functions/v1/send-reminders`;
export const CRON = 'cron-secret-0123456789-abcdefghijkl';
export const SERVICE_KEY = 'sb_secret_service-key-for-tests-0000';
export const VAPID_PRIVATE = 'p'.repeat(43);
export const VAPID_PUBLIC = 'B'.repeat(87);

export const ENV: Record<string, string> = {
  CRON_SECRET: CRON,
  SUPABASE_URL: URL_BASE,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  VAPID_PUBLIC_KEY: VAPID_PUBLIC,
  VAPID_PRIVATE_KEY: VAPID_PRIVATE,
  VAPID_SUBJECT: 'mailto:owner@example.org',
};

export const envOf = (patch: Record<string, string | undefined> = {}) => (name: string): string | undefined => ({ ...ENV, ...patch })[name];

export const USER_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
export const USER_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
export const USER_C = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';

/** Токен, похожий на JWT (подпись не проверяется: проверка подменяется или идёт в эмулятор). */
export const fakeJwt = (label = 'user'): string => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ label })).toString('base64url')}.sig`;

export function request(method: string, init: { token?: string | null; authorization?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...init.headers };
  if (init.authorization !== undefined) headers.authorization = init.authorization;
  else if (init.token !== undefined && init.token !== null) headers.authorization = `Bearer ${init.token}`;
  const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') headers['content-type'] = 'application/json';
  return new Request(FUNCTION_URL, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
}

export const sub = (id: string, host = 'fcm.googleapis.com'): PushSub => ({ id, endpoint: `https://${host}/fcm/send/${id}`, p256dh: `p256dh-${id}`.padEnd(30, 'x'), authSecret: `auth-${id}`.padEnd(12, 'x') });

export const settings = (userId: string, o: Partial<ReminderSettingsRow> = {}): ReminderSettingsRow => ({
  userId,
  hourLocal: 9,
  timezone: 'Asia/Dushanbe',
  remindPayments: true,
  remindDebts: true,
  remindDaily: false,
  showDetails: false,
  ...o,
});

/** Отправитель-подмена: записывает всё отправленное, исход задаётся по id подписки. */
export interface FakeSender extends Sender {
  calls: Array<{ subId: string; endpoint: string; body: string; ttl: number }>;
  outcomes: Map<string, SendResult | 'throw'>;
  bodies(): Array<Record<string, string>>;
}

export function fakeSender(): FakeSender {
  const calls: FakeSender['calls'] = [];
  const outcomes = new Map<string, SendResult | 'throw'>();
  const send = (async (s, body, opts) => {
    calls.push({ subId: s.id, endpoint: s.endpoint, body, ttl: opts.ttl });
    const o = outcomes.get(s.id);
    if (o === 'throw') throw new Error(`сбой отправки на ${s.endpoint}`);
    return o ?? { outcome: 'ok' };
  }) as FakeSender;
  send.calls = calls;
  send.outcomes = outcomes;
  send.bodies = () => calls.map((c) => JSON.parse(c.body) as Record<string, string>);
  return send;
}

/** Хранилище в памяти: тот же порядок и смысл, что у PostgREST-хранилища, но без сети. */
export class FakeStore implements ReminderStore {
  settings: ReminderSettingsRow[] = [];
  rejectedSettings = 0;
  subs = new Map<string, PushSub[]>();
  /** last_seen_at подписок по id (по умолчанию у всех одно время: «подтверждены давно»). */
  lastSeen = new Map<string, string>();
  rules = new Map<string, RuleLite[]>();
  transactionIds = new Set<string>();
  debts = new Map<string, DebtLite[]>();
  debtTxs: DebtTxLite[] = [];
  wallets = new Map<string, string>();
  liveTxDates = new Map<string, Set<string>>();
  log = new Set<string>();
  revoked: string[] = [];
  pruned: string[] = [];
  calls: string[] = [];
  /** Какие методы падают (по имени) → ошибка DbError. */
  failing = new Set<string>();
  /** Размер страницы настроек (чтобы проверять постраничное чтение). */
  pageSize = 1000;

  private enter(name: string, userId?: string): void {
    this.calls.push(userId === undefined ? name : `${name}:${userId}`);
    if (this.failing.has(name) || (userId !== undefined && this.failing.has(`${name}:${userId}`))) throw new DbError(`${name}: HTTP 500`);
  }

  logKey = (userId: string, sentOn: string, e: LogEntry): string => `${userId}|${sentOn}|${e.kind}|${e.ref}`;

  async listEnabledSettings(after: string | null): Promise<SettingsPage> {
    this.enter('listEnabledSettings');
    const sorted = [...this.settings].sort((a, b) => (a.userId < b.userId ? -1 : 1));
    const page = sorted.filter((s) => after === null || s.userId > after).slice(0, this.pageSize);
    return { rows: page, rejected: page.length === 0 ? 0 : this.rejectedSettings, lastUserId: page.at(-1)?.userId ?? null };
  }
  async listSubscriptions(userId: string): Promise<PushSub[]> {
    this.enter('listSubscriptions', userId);
    return (this.subs.get(userId) ?? []).filter((s) => !this.revoked.includes(s.id));
  }
  /** Как PostgREST-хранилище: действующие подписки ЛЮБЫХ людей с этими адресами (id, адрес, время). */
  async listLiveEndpointClaims(endpoints: readonly string[]): Promise<EndpointClaim[]> {
    this.enter('listLiveEndpointClaims');
    const out: EndpointClaim[] = [];
    for (const list of this.subs.values()) {
      for (const s of list) {
        if (endpoints.includes(s.endpoint) && !this.revoked.includes(s.id)) out.push({ id: s.id, endpoint: s.endpoint, lastSeenAt: this.lastSeen.get(s.id) ?? '2026-10-01T10:00:00+00:00' });
      }
    }
    return out;
  }
  async listRules(userId: string): Promise<RuleLite[]> {
    this.enter('listRules', userId);
    return this.rules.get(userId) ?? [];
  }
  async existingTransactionIds(userId: string, ids: readonly string[]): Promise<Set<string>> {
    this.enter('existingTransactionIds', userId);
    return new Set(ids.filter((i) => this.transactionIds.has(i)));
  }
  async listDebts(userId: string): Promise<DebtLite[]> {
    this.enter('listDebts', userId);
    return this.debts.get(userId) ?? [];
  }
  async listDebtTransactions(userId: string, debtIds: readonly string[]): Promise<DebtTxLite[]> {
    this.enter('listDebtTransactions', userId);
    return this.debtTxs.filter((t) => debtIds.includes(t.debtId));
  }
  async walletCurrencies(userId: string): Promise<Map<string, string>> {
    this.enter('walletCurrencies', userId);
    return this.wallets;
  }
  async hasLiveTransactionOn(userId: string, date: string): Promise<boolean> {
    this.enter('hasLiveTransactionOn', userId);
    return this.liveTxDates.get(userId)?.has(date) ?? false;
  }
  async insertLog(userId: string, sentOn: string, entries: readonly LogEntry[]): Promise<LogEntry[]> {
    this.enter('insertLog', userId);
    const fresh: LogEntry[] = [];
    for (const e of entries) {
      const k = this.logKey(userId, sentOn, e);
      if (!this.log.has(k)) {
        this.log.add(k);
        fresh.push(e);
      }
    }
    return fresh;
  }
  async deleteLog(userId: string, sentOn: string, entries: readonly LogEntry[]): Promise<void> {
    this.enter('deleteLog', userId);
    for (const e of entries) this.log.delete(this.logKey(userId, sentOn, e));
  }
  async revokeSubscription(id: string): Promise<void> {
    this.enter('revokeSubscription');
    this.revoked.push(id);
  }
  async pruneLog(beforeDate: string): Promise<void> {
    this.enter('pruneLog');
    this.pruned.push(beforeDate);
  }
}

/** Хранилище, которое нельзя трогать: любое обращение — ошибка теста. */
export const forbiddenStore = (): ReminderStore =>
  new Proxy({} as ReminderStore, {
    get: (_t, prop) => () => {
      throw new Error(`обращение к хранилищу не ожидалось: ${String(prop)}`);
    },
  });

export function deps(over: HandlerDeps = {}): HandlerDeps {
  return { env: envOf(), now: () => new Date('2026-10-10T04:10:00Z'), verifyJwt: async () => null, send: fakeSender(), store: forbiddenStore(), ...over };
}

/** Перехват console.error / console.log на время каждого теста: что функция написала в журнал. Вызывается один раз на файл. */
export function captureConsole(): { errors: string[]; logs: string[]; text(): string } {
  const out = { errors: [] as string[], logs: [] as string[], text: () => [...out.errors, ...out.logs].join('\n') };
  beforeEach(() => {
    out.errors.length = 0;
    out.logs.length = 0;
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void out.errors.push(a.map(String).join(' ')));
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.logs.push(a.map(String).join(' ')));
  });
  afterEach(() => vi.restoreAllMocks());
  return out;
}
