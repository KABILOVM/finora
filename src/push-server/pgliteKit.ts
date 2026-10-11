import type { PgliteServer } from '../../tests/sync/pglite';

/** Заготовки для pglite.test.ts: данные пользователей кладутся ОТ ИХ ИМЕНИ (триггеры и защита строк работают), служебные таблицы — напрямую. */

const TS = '2026-10-01T10:00:00Z';
let current: PgliteServer;
/** Какая база сейчас используется заготовками (вызывается один раз после создания PGlite). */
export function useServer(s: PgliteServer): void {
  current = s;
}
let n = 0;
export const id = (prefix = 'f'): string => `${prefix.repeat(8).slice(0, 8)}-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export const asUser = (user: string) => ({ role: 'authenticated' as const, sub: user });
export const sql = (user: string, text: string, params: unknown[] = []) => current.as(asUser(user), (tx) => tx.query(text, params));
export const admin = async <T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => (await current.db.query<T>(text, params)).rows;

export async function wallet(user: string, currency = 'TJS', deleted = false): Promise<string> {
  const wid = id('a');
  await sql(user, `insert into public.wallets (id, created_at, client_updated_at, device_id, deleted_at, name, currency, kind, opening_balance_minor, color, icon, sort_order) values ($1, $2, $2, 'dev', $3, 'К', $4, 'cash', 0, '#fff', 'x', 0)`, [wid, TS, deleted ? TS : null, currency]);
  return wid;
}

export interface RuleOpts {
  walletId: string;
  note?: string;
  kind?: 'expense' | 'income';
  frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  intervalN?: number;
  startOn?: string;
  endOn?: string | null;
  autoPost?: 0 | 1;
  archived?: boolean;
  deleted?: boolean;
}
export async function rule(user: string, o: RuleOpts): Promise<string> {
  const rid = id('b');
  await sql(
    user,
    `insert into public.recurring_rules (id, created_at, client_updated_at, device_id, deleted_at, archived_at, kind, wallet_id, amount_minor, note, frequency, interval_n, start_on, end_on, auto_post)
     values ($1, $2, $2, 'dev', $3, $4, $5, $6, 777777, $7, $8, $9, $10, $11, $12)`,
    [rid, TS, o.deleted ? TS : null, o.archived ? TS : null, o.kind ?? 'expense', o.walletId, o.note ?? 'Аренда', o.frequency ?? 'monthly', o.intervalN ?? 1, o.startOn ?? '2026-01-10', o.endOn ?? null, o.autoPost ?? 0],
  );
  return rid;
}

export interface TxOpts {
  walletId: string;
  occurredOn: string;
  kind?: 'expense' | 'income';
  id?: string;
  debtId?: string | null;
  amount?: number;
  deleted?: boolean;
}
export async function tx(user: string, o: TxOpts): Promise<string> {
  const tid = o.id ?? id('c');
  await sql(
    user,
    `insert into public.transactions (id, created_at, client_updated_at, device_id, deleted_at, kind, wallet_id, amount_minor, occurred_on, note, base_currency, base_amount_minor, debt_id)
     values ($1, $2, $2, 'dev', $3, $4, $5, $6, $7, '', 'TJS', $6, $8)`,
    [tid, TS, o.deleted ? TS : null, o.kind ?? 'expense', o.walletId, o.amount ?? 100, o.occurredOn, o.debtId ?? null],
  );
  return tid;
}

export interface DebtOpts {
  dueOn: string | null;
  direction?: 'lent' | 'borrowed';
  counterparty?: string;
  principal?: number;
  currency?: string;
  closed?: boolean;
  archived?: boolean;
  deleted?: boolean;
}
export async function debt(user: string, o: DebtOpts): Promise<string> {
  const did = id('d');
  await sql(
    user,
    `insert into public.debts (id, created_at, client_updated_at, device_id, deleted_at, direction, counterparty, principal_minor, currency, opened_on, due_on, note, closed_at, archived_at)
     values ($1, $2, $2, 'dev', $3, $4, $5, $6, $7, '2026-01-01', $8, '', $9, $10)`,
    [did, TS, o.deleted ? TS : null, o.direction ?? 'lent', o.counterparty ?? 'Рустам', o.principal ?? 1000, o.currency ?? 'TJS', o.dueOn, o.closed ? TS : null, o.archived ? TS : null],
  );
  return did;
}

export async function settings(user: string, o: { hour?: number; tz?: string; payments?: boolean; debts?: boolean; daily?: boolean; details?: boolean; enabled?: boolean } = {}): Promise<void> {
  await current.addUser(user);
  await admin(
    `insert into public.reminder_settings (user_id, enabled, hour_local, timezone, remind_payments, remind_debts, remind_daily, show_details) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id) do update set enabled = excluded.enabled, hour_local = excluded.hour_local, timezone = excluded.timezone, remind_payments = excluded.remind_payments, remind_debts = excluded.remind_debts, remind_daily = excluded.remind_daily, show_details = excluded.show_details`,
    [user, o.enabled ?? true, o.hour ?? 9, o.tz ?? 'Asia/Dushanbe', o.payments ?? true, o.debts ?? true, o.daily ?? false, o.details ?? false],
  );
}

export async function subscription(user: string, sid: string, host = 'fcm.googleapis.com'): Promise<void> {
  await current.addUser(user);
  await admin(`insert into public.push_subscriptions (id, user_id, device_id, endpoint, p256dh, auth_secret) values ($1, $2, 'dev', $3, $4, $5)`, [sid, user, `https://${host}/fcm/send/${sid}`, `p256dh-${sid}`.padEnd(30, 'x'), `auth-${sid}`.padEnd(12, 'x')]);
}

export const logRows = (user?: string) =>
  admin<{ user_id: string; kind: string; ref: string; sent_on: string }>(
    `select user_id, kind, ref, to_char(sent_on, 'YYYY-MM-DD') as sent_on from public.push_log ${user ? `where user_id = '${user}'` : ''} order by kind, ref`,
  );

export const revokedIds = async (): Promise<string[]> => (await admin<{ id: string }>(`select id from public.push_subscriptions where revoked_at is not null order by id`)).map((r) => r.id);
