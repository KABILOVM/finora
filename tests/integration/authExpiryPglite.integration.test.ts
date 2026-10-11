// @vitest-environment node
/**
 * Атака 6 (настоящий стек): supabase-js + эмулятор PostgREST + настоящая schema.sql на PGlite.
 * Токен истекает ПОСРЕДИ отправки (между пачками); ответ теряется и сразу после этого токен протухает.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newId } from '@/db';
import type { LocalRow, Transaction } from '@/domain/types';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { makeUserId } from '../sync/factories';
import { openDevice, type Device } from '../sync/engineHarness';
import { createPgliteServer, type PgliteServer } from '../sync/pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from '../sync/postgrestEmulator';

let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  emu = createPostgrestEmulator(pg);
}, 120_000);
afterAll(async () => {
  await pg.close();
});

const ANON_KEY = makeJwt({ role: 'anon' });
const expiredFor = (sub: string) => makeJwt({ sub, exp: Math.floor(Date.now() / 1000) - 120 });

interface Session {
  token: string;
}

/** fetch, который после N-го POST в таблицу операций «протухает» токен (как будто он истёк именно сейчас). */
function expiringFetch(session: Session, sub: string, expireAfterPost: number) {
  let posts = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await emu.fetch(input, init);
    const url = String(input instanceof Request ? input.url : input);
    if ((init?.method ?? 'GET') === 'POST' && url.includes('/transactions')) {
      posts++;
      if (posts === expireAfterPost) session.token = expiredFor(sub);
    }
    return res;
  }) as typeof fetch;
}

async function device(userId: string, deviceId: string, session: Session, f: typeof fetch, onAuthError: () => Promise<boolean>): Promise<Device> {
  const client = createClient(emu.url, ANON_KEY, {
    global: { fetch: f },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => session.token,
  });
  return openDevice(null, deviceId, { userId, transport: createSupabaseTransport(client), seed: true, engine: { onAuthError } });
}

const txRows = (userId: string) => pg.adminRows('transactions').then((r) => r.filter((x) => x['user_id'] === userId));

async function manyTx(d: Device, n: number): Promise<void> {
  const wallet = (await d.store.db.wallets.toArray())[0]!;
  const base = await d.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 100, occurredOn: '2026-10-01', note: 'base' });
  const rows: LocalRow<Transaction>[] = Array.from({ length: n - 1 }, (_, i) => ({
    ...base,
    id: newId(),
    amountMinor: 101 + i,
    baseAmountMinor: 101 + i,
    note: `n${i}`,
    clientUpdatedAt: new Date(Date.parse(base.clientUpdatedAt) + i + 1).toISOString(),
  }));
  await d.store.db.transactions.bulkPut(rows);
}

describe('атака 6 на настоящей схеме: токен истёк посреди отправки', () => {
  it('токен протухает после первой пачки из трёх: сессия обновляется один раз, на сервере все 450 операций ровно по разу', async () => {
    const u = makeUserId();
    const session: Session = { token: makeJwt({ sub: u }) };
    const refresh = vi.fn(async () => {
      session.token = makeJwt({ sub: u });
      return true;
    });
    const a = await device(u, 'dev-a', session, expiringFetch(session, u, 1), refresh);
    await a.engine.syncNow();
    await manyTx(a, 450);
    await a.engine.syncNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    const rows = await txRows(u);
    expect(rows).toHaveLength(450);
    expect(new Set(rows.map((r) => r['id'])).size).toBe(450);
    // второе устройство видит то же
    const b = await device(u, 'dev-b', { token: makeJwt({ sub: u }) }, emu.fetch, async () => true);
    await b.engine.syncNow();
    expect(await b.store.db.transactions.count()).toBe(450);
  }, 120_000);

  it('сервер принял пачку, ответ потерялся, а токен тем временем протух: после обновления сессии повтор не меняет ни одной строки на сервере', async () => {
    const u = makeUserId();
    const session: Session = { token: makeJwt({ sub: u }) };
    const refresh = vi.fn(async () => {
      session.token = makeJwt({ sub: u });
      return true;
    });
    const a = await device(u, 'dev-a', session, emu.fetch, refresh);
    await a.engine.syncNow();
    const w = (await a.store.db.wallets.toArray())[0]!;
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 777, occurredOn: '2026-10-05', note: 'потеря' });
    emu.loseResponse(1);
    await a.engine.syncNow(); // ответ потерян → «нет связи», запись в очереди
    expect(a.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 1 });
    const applied = await txRows(u);
    expect(applied).toHaveLength(1);
    session.token = expiredFor(u);
    await a.engine.syncNow(); // 401 → обновление → повтор
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect(await txRows(u)).toEqual(applied);
  }, 60_000);

  it('обновить сессию не вышло (refresh вернул false): «нужен вход», очередь цела; после нового токена уходит всё', async () => {
    const u = makeUserId();
    const session: Session = { token: makeJwt({ sub: u }) };
    const a = await device(u, 'dev-a', session, emu.fetch, async () => false);
    await a.engine.syncNow();
    const w = (await a.store.db.wallets.toArray())[0]!;
    for (let i = 0; i < 5; i++) await a.store.transactions.create({ kind: 'income', walletId: w.id, amountMinor: 100 + i, occurredOn: '2026-10-05', note: `д${i}` });
    session.token = expiredFor(u);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'auth-required', pending: 5, quarantined: 0 });
    expect(await txRows(u)).toHaveLength(0);
    session.token = makeJwt({ sub: u });
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect(await txRows(u)).toHaveLength(5);
  }, 60_000);
});
