// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureSeeded } from '@/db';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import { toWire } from '@/sync/tables';
import { makeTransaction, makeUserId, makeWallet } from './factories';
import { openDevice, snapshotOf, type Device } from './engineHarness';
import { createPgliteServer, type PgliteServer } from './pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from './postgrestEmulator';

/**
 * Сквозные сценарии: движок + настоящий supabase-js + createSupabaseTransport + эмулятор PostgREST + настоящая схема на PGlite
 * (триггер sync_guard, ограничения, внешние ключи, политики RLS, журнал меток из будущего).
 */

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
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

interface Session {
  token: string | null;
}

function clientWith(session: Session) {
  return createClient(emu.url, ANON_KEY, {
    global: { fetch: emu.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => session.token,
  });
}

/** Устройство пользователя на настоящем стеке. */
async function device(
  userId: string,
  deviceId: string,
  o: { session?: Session; timeoutMs?: number; onAuthError?: () => Promise<boolean>; now?: () => number } = {},
): Promise<Device & { session: Session }> {
  const session = o.session ?? { token: makeJwt({ sub: userId }) };
  const transport = createSupabaseTransport(clientWith(session), { timeoutMs: o.timeoutMs });
  const d = await openDevice(null, deviceId, { userId, transport, seed: true, now: o.now, engine: { onAuthError: o.onAuthError } });
  return Object.assign(d, { session });
}

const rowsOf = (userId: string, table: 'settings' | 'wallets' | 'categories' | 'transactions') =>
  pg.adminRows(table).then((rows) => rows.filter((r) => r['user_id'] === userId));
const newWallet = (d: Device, name: string) =>
  d.store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
const posts = (since: number) => emu.log.slice(since).filter((r) => r.method === 'POST');

describe('движок на настоящей схеме', () => {
  it('два устройства одного пользователя обмениваются данными, чужой пользователь ничего не видит', async () => {
    const [u, other] = [makeUserId(), makeUserId()];
    const a = await device(u, 'dev-a');
    const b = await device(u, 'dev-b');
    const x = await device(other, 'dev-x');
    await a.engine.syncNow();
    const w = (await a.store.db.wallets.toArray())[0]!;
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 12_345, occurredOn: '2026-10-05', note: 'плов' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await x.engine.syncNow();
    expect(await snapshotOf(b.store)).toEqual(await snapshotOf(a.store));
    expect((await rowsOf(u, 'transactions')).length).toBe(1);
    // у чужого пользователя своя затравка и свои данные: операции нет
    expect(await x.store.db.transactions.count()).toBe(0);
    expect((await rowsOf(other, 'wallets')).length).toBe(1);
    expect(emu.log.some((r) => r.user === u)).toBe(true);
  });

  it('просроченный токен: сервер отвечает 401 PGRST301 → сессия обновляется → цикл повторяется и проходит', async () => {
    const u = makeUserId();
    const session: Session = { token: makeJwt({ sub: u, exp: Math.floor(Date.now() / 1000) - 60 }) };
    const refresh = vi.fn(async () => {
      session.token = makeJwt({ sub: u });
      return true;
    });
    const a = await device(u, 'dev-a', { session, onAuthError: refresh });
    await a.engine.syncNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect((await rowsOf(u, 'settings')).length).toBe(1);
  });

  it('сессия потеряна, запрос ушёл анонимно (401 + 42501): «нужен вход», а НЕ карантин для всей очереди', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await a.engine.syncNow();
    for (let i = 0; i < 5; i++) await newWallet(a, `W${i}`);
    a.session.token = ANON_KEY; // токен пропал: клиент шлёт анонимный ключ
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'auth-required', pending: 5, quarantined: 0 });
    a.session.token = makeJwt({ sub: u });
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 0 });
    expect((await rowsOf(u, 'wallets')).length).toBe(6);
  });

  it('строка, отвергнутая настоящим CHECK, находится делением пачки; остальные 30 уходят', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await a.engine.syncNow();
    const base = Date.now() - 3_600_000;
    const ws = Array.from({ length: 31 }, (_, i) =>
      makeWallet({ createdAt: iso(base + i), clientUpdatedAt: iso(base + i), deviceId: 'dev-a', sortOrder: 10 + i, name: i === 17 ? '' : `K${i}` }),
    );
    await a.store.db.wallets.bulkPut(ws.map((w) => ({ ...w, dirty: 1 as const, serverSeq: null, syncError: null })));
    const before = emu.log.length;
    await a.engine.syncNow();
    expect((await rowsOf(u, 'wallets')).length).toBe(1 + 30);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 1 });
    expect((await a.store.db.wallets.get(ws[17]!.id))?.syncError).toMatch(/код 23514/);
    expect(posts(before).length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(32)) + 2);
  });

  it('операция без кошелька на сервере (внешний ключ) уходит в карантин с понятным сообщением, соседние операции проходят', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await a.engine.syncNow();
    const w = (await a.store.db.wallets.toArray())[0]!;
    const base = Date.now() - 3_600_000;
    const good = makeTransaction({ walletId: w.id, createdAt: iso(base), clientUpdatedAt: iso(base), deviceId: 'dev-a' });
    const orphan = makeTransaction({ walletId: makeWallet().id, createdAt: iso(base + 1), clientUpdatedAt: iso(base + 1), deviceId: 'dev-a' });
    await a.store.db.transactions.bulkPut([good, orphan].map((t) => ({ ...t, dirty: 1 as const, serverSeq: null, syncError: null })));
    await a.engine.syncNow();
    expect((await rowsOf(u, 'transactions')).map((r) => r['id'])).toEqual([good.id]);
    expect((await a.store.db.transactions.get(orphan.id))?.syncError).toMatch(/кошельком или категорией.*23503/);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 1 });
  });

  it('ответ потерян после того, как база приняла запись: повтор идемпотентен (ни дубля, ни нового server_seq)', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await a.engine.syncNow();
    await newWallet(a, 'Копилка');
    emu.loseResponse(1);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 1 });
    const afterLoss = await rowsOf(u, 'wallets');
    expect(afterLoss.length).toBe(2);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect(await rowsOf(u, 'wallets')).toEqual(afterLoss);
  });

  it('сервер отвечает 503, потом 500 с HTML (шлюз): фаза «ошибка», данные в очереди, карантина нет; затем всё уходит', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await a.engine.syncNow();
    await newWallet(a, 'Копилка');
    emu.failHttp(503, { message: 'Service Unavailable' });
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', pending: 1, quarantined: 0 });
    emu.failHttp(502, '<html>Bad Gateway</html>');
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'error', pending: 1, quarantined: 0 });
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect((await rowsOf(u, 'wallets')).length).toBe(2);
  });

  it('зависший ответ: таймаут транспорта → сетевая ошибка, запись остаётся в очереди', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a', { timeoutMs: 150 });
    await a.engine.syncNow();
    await newWallet(a, 'Копилка');
    emu.setLatency(600);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 1 });
    expect((await rowsOf(u, 'wallets')).length).toBe(2); // база запись приняла, ответ не дождались
    const applied = await rowsOf(u, 'wallets');
    emu.setLatency(0);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect(await rowsOf(u, 'wallets')).toEqual(applied); // повтор после таймаута ничего не продублировал и не сдвинул
  });

  it('часы устройства на час вперёд: настоящий триггер зажимает метку, устройства сходятся, ничего не теряется', async () => {
    const u = makeUserId();
    const real = Date.now();
    const a = await device(u, 'dev-a', { now: () => Date.now() + 60 * MIN }); // часы убежали на час вперёд
    const b = await device(u, 'dev-b');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const w = await newWallet(a, 'С будущего');
    await a.store.wallets.update(w.id, { name: 'С будущего 2' });
    await a.store.transactions.create({ kind: 'income', walletId: w.id, amountMinor: 900, occurredOn: '2026-10-05' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(await snapshotOf(b.store)).toEqual(await snapshotOf(a.store));
    const row = (await rowsOf(u, 'wallets')).find((r) => r['id'] === w.id);
    expect(row?.['name']).toBe('С будущего 2');
    expect(Date.parse(String(row?.['client_updated_at']))).toBeLessThanOrEqual(Date.now() + 5 * MIN + 1000);
    expect(Date.parse(String(row?.['client_updated_at']))).toBeGreaterThan(real);
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
    expect(b.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
  });

  it('два новых устройства одновременно сеют стартовые данные: на сервере по одному экземпляру', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    const b = await device(u, 'dev-b');
    emu.setLatency(15);
    await Promise.all([a.engine.syncNow(), b.engine.syncNow()]);
    emu.setLatency(0);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect([(await rowsOf(u, 'settings')).length, (await rowsOf(u, 'wallets')).length, (await rowsOf(u, 'categories')).length]).toEqual([1, 1, 17]);
    expect(await snapshotOf(a.store)).toEqual(await snapshotOf(b.store));
    void ensureSeeded;
  });

  it('больше страницы: 600 операций приходят новому устройству двумя запросами (500 + 100) в правильном порядке', async () => {
    const u = makeUserId();
    const a = await device(u, 'dev-a');
    await a.engine.syncNow();
    const w = (await a.store.db.wallets.toArray())[0]!;
    const base = Date.now() - 3_600_000;
    const txs = Array.from({ length: 600 }, (_, i) =>
      makeTransaction({ walletId: w.id, createdAt: iso(base + i), clientUpdatedAt: iso(base + i), deviceId: 'dev-a', amountMinor: 1 + i, baseAmountMinor: 1 + i }),
    );
    // напрямую через настоящий транспорт, пачками по 200
    const t = createSupabaseTransport(clientWith({ token: makeJwt({ sub: u }) }));
    for (let i = 0; i < txs.length; i += 200) await t.push('transactions', txs.slice(i, i + 200).map((x) => toWire('transactions', x)));
    const b = await device(u, 'dev-b');
    const before = emu.log.length;
    await b.engine.syncNow();
    expect(await b.store.db.transactions.count()).toBe(600);
    const gets = emu.log.slice(before).filter((r) => r.method === 'GET' && r.table === 'transactions');
    expect(gets.every((g) => /limit=500/.test(g.query) && /order=server_seq\.asc/.test(g.query))).toBe(true);
    expect(gets.length).toBe(3); // 500, 100 и пустое получение после отправки
  });
});
