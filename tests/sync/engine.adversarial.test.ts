import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryServer } from '@/sync/memoryServer';
import type { SessionAwareTransport } from '@/sync/session';
import { createSupabaseTransport } from '@/sync/supabaseTransport';
import type { SyncTableName, WireRow } from '@/sync/tables';
import { TransportError, type SyncTransport } from '@/sync/transport';
import { USER, fakeTimers, openDevice, settle, until } from './engineHarness';

/** Состязательные проверки движка: чужая сессия, «нужен вход» после временного сбоя, карантин родителя. */

const USER_B = '22222222-2222-4222-8222-222222222222';

const newWallet = (d: Awaited<ReturnType<typeof openDevice>>, name = 'Новый') =>
  d.store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });

/** Как общая сессия браузера: какой пользователь вошёл сейчас, тот и «владелец» следующего запроса (токен читается в момент запроса). */
function browserSession(server: ReturnType<typeof createMemoryServer>, firstUser: string) {
  let user = firstUser;
  const transport: SessionAwareTransport = {
    currentUserId: async () => user,
    pull: (t, a, l) => server.transportFor(user).pull(t, a, l),
    push: (t, r) => server.transportFor(user).push(t, r),
  };
  return { transport, signInAs: (u: string) => void (user = u) };
}

const table = (server: ReturnType<typeof createMemoryServer>, user: string) => ({
  wallets: server.dump(user, 'wallets').length,
  tx: server.dump(user, 'transactions').length,
});

describe('смена сессии под работающим движком', () => {
  it('движок пользователя A при токене пользователя B НЕ должен класть данные A на сервер под аккаунт B', async () => {
    const server = createMemoryServer();
    // хранилище A, а транспорт (сессия supabase-js после входа B в соседней вкладке) — от имени B
    const d = await openDevice(server, 'dev-a', { userId: USER, transport: server.transportFor(USER_B), seed: true });
    await d.engine.syncNow(); // первая загрузка не должна состояться: данные B не попадают в базу A, а данные A — в аккаунт B
    await newWallet(d, 'Секретный счёт A');
    await d.engine.syncNow();

    expect(table(server, USER_B)).toEqual({ wallets: 0, tx: 0 });
    expect(table(server, USER)).toEqual({ wallets: 0, tx: 0 });
    expect(d.engine.getStatus()).toMatchObject({ phase: 'auth-required', lastSyncedAt: null, pending: 1 });
    expect(d.engine.getStatus().lastError).toMatch(/другой пользователь/);
    expect(await d.store.settings.get()).toBeNull(); // затравка не вызывалась: первой загрузки не было
  });

  it('вход другого пользователя посреди работы: ничего не уходит и ничего не приходит, после возврата сессии всё доезжает', async () => {
    const server = createMemoryServer();
    const session = browserSession(server, USER);
    const a = await openDevice(server, 'dev-a', { userId: USER, seed: true, wrap: () => session.transport });
    await a.engine.syncNow();
    const w = await newWallet(a, 'Счёт A');
    await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 99_000, occurredOn: '2026-10-05', note: 'зарплата A' });
    await a.engine.syncNow();
    expect(table(server, USER)).toEqual({ wallets: 2, tx: 1 });

    // у B есть свои данные на другом телефоне
    const b = await openDevice(server, 'dev-b', { userId: USER_B, seed: true });
    await b.engine.syncNow();
    await newWallet(b, 'Счёт B');
    await b.engine.syncNow();
    const before = table(server, USER_B);

    // в соседней вкладке вошёл B; эта вкладка (база A) ещё не успела закрыться
    session.signInAs(USER_B);
    const w2 = await newWallet(a, 'Новый счёт A');
    await a.store.transactions.create({ kind: 'expense', walletId: w2.id, amountMinor: 1_000, occurredOn: '2026-10-06', note: 'после входа B' });
    await a.engine.syncNow();
    expect(table(server, USER_B)).toEqual(before); // данные A не легли в аккаунт B
    expect(table(server, USER)).toEqual({ wallets: 2, tx: 1 }); // и в свой аккаунт новое не ушло
    expect((await a.store.db.wallets.toArray()).some((x) => x.name === 'Счёт B')).toBe(false); // данные B не попали в базу A
    expect(a.engine.getStatus()).toMatchObject({ phase: 'auth-required', pending: 2 });

    // сессия A вернулась: накопленное уходит, чужого по-прежнему нет
    session.signInAs(USER);
    await a.engine.syncNow();
    expect(table(server, USER)).toEqual({ wallets: 3, tx: 2 });
    expect(table(server, USER_B)).toEqual(before);
    expect(a.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect((await a.store.db.wallets.toArray()).some((x) => x.name === 'Счёт B')).toBe(false);
  });

  it('сессии нет совсем: как просроченный токен (движок просит обновить сессию, данные не уходят анонимно)', async () => {
    const server = createMemoryServer();
    let signedIn = true;
    const refresh = vi.fn(async () => false);
    const d = await openDevice(server, 'dev-a', {
      seed: true,
      engine: { onAuthError: refresh },
      wrap: (inner) => ({
        currentUserId: async () => (signedIn ? USER : null),
        pull: (t, a, l) => inner.pull(t, a, l),
        push: (t, r) => inner.push(t, r),
      }) as SessionAwareTransport,
    });
    await d.engine.syncNow();
    await newWallet(d);
    signedIn = false;
    await d.engine.syncNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(d.engine.getStatus()).toMatchObject({ phase: 'auth-required', pending: 1, lastError: 'Нужно войти заново' });
    expect(table(server, USER).wallets).toBe(1);
  });
});

describe('«нужен вход» после временного сбоя обновления токена', () => {
  it('токен обновился в фоне (сеть вернулась) — движок сам продолжает, а не ждёт нажатия кнопки', async () => {
    fakeTimers();
    const server = createMemoryServer();
    let tokenOk = false;
    const d = await openDevice(server, 'dev-a', {
      seed: true,
      engine: { onAuthError: async () => tokenOk },
    });
    d.engine.start();
    await until(() => d.engine.getStatus().lastSyncedAt !== null, 'первый цикл');
    await newWallet(d);
    // сервер ответил 401, а обновить токен не вышло (мобильная сеть моргнула)
    server.failNext('auth');
    await vi.advanceTimersByTimeAsync(1_500);
    await until(() => d.engine.getStatus().phase === 'auth-required', 'нужен вход');

    // сеть вернулась, токен supabase-js обновил сам; человек сидит в приложении и ничего не нажимает
    tokenOk = true;
    await settle();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await settle();
    expect(d.engine.getStatus().pending).toBe(0);
    expect(server.dump(USER, 'wallets')).toHaveLength(2);
  });
});

describe('карантин родителя', () => {
  it('кошелёк исправлен и принят сервером — его операции не должны навсегда остаться в карантине', async () => {
    const server = createMemoryServer();
    const d = await openDevice(server, 'dev-a', {
      seed: true,
      wrap: (inner) => ({
        pull: (t, a, l) => inner.pull(t, a, l),
        async push(table, rows) {
          if (table === 'wallets' && rows.some((r) => r['name'] === 'Плохой')) {
            throw new TransportError('rejected', 'CHECK (имитация)', '23514');
          }
          return inner.push(table, rows);
        },
      }),
    });
    await d.engine.syncNow();
    const w = await newWallet(d, 'Плохой');
    await d.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 5_000, occurredOn: '2026-10-05', note: 'обед' });
    await d.engine.syncNow();
    expect(d.engine.getStatus().quarantined).toBe(2);

    // человек исправил название кошелька (как велит экран «Сервер не принял записи»)
    await d.store.wallets.update(w.id, { name: 'Хороший' });
    await d.engine.syncNow();
    await d.engine.syncNow();
    expect(server.dump(USER, 'wallets').some((r) => r['name'] === 'Хороший')).toBe(true);
    // операция по этому кошельку должна уехать на сервер, а не висеть «не принята сервером»
    expect({ quarantined: d.engine.getStatus().quarantined, onServer: server.dump(USER, 'transactions').length }).toEqual({
      quarantined: 0,
      onServer: 1,
    });
  });
});

/**
 * Поддельный supabase-js над сервером в памяти: запросы доходят до сервера, но пачка с «ядовитой» записью получает
 * ответ HTTP 400 без кода (так отвечает шлюз или фильтр перед базой). Разбор ответа делает настоящий боевой транспорт.
 */
function clientWithPoison(inner: SyncTransport, poisonName: string): SupabaseClient {
  const thenable = <T>(run: () => Promise<T>) => ({ then: (ok: (v: T) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad) });
  return {
    from: (table: SyncTableName) => ({
      select: () => {
        const q = { after: 0, limit: 1 };
        const self = {
          gt: (_c: string, v: number) => ((q.after = v), self),
          order: () => self,
          limit: (n: number) => ((q.limit = n), self),
          abortSignal: () => self,
          retry: () => self,
          ...thenable(async () => ({ data: await inner.pull(table, q.after, q.limit), error: null, status: 200 })),
        };
        return self;
      },
      upsert: (rows: WireRow[]) => {
        const self = {
          abortSignal: () => self,
          ...thenable(async () => {
            if (rows.some((r) => r['name'] === poisonName)) return { data: null, error: { message: 'bad request' }, status: 400 };
            await inner.push(table, rows);
            return { data: null, error: null, status: 201 };
          }),
        };
        return self;
      },
    }),
  } as unknown as SupabaseClient;
}

describe('отправка: одна «ядовитая» запись не останавливает остальные', () => {
  it('ответ 400 без кода на пачку с одной записью кошелька: виновная уходит в карантин, операции по нормальному кошельку доходят', async () => {
    const server = createMemoryServer();
    const d = await openDevice(server, 'dev-a', { seed: true, wrap: (inner) => createSupabaseTransport(clientWithPoison(inner, 'Яд')) });
    await d.engine.syncNow();
    const good = await newWallet(d, 'Нормальный');
    await newWallet(d, 'Яд');
    await d.store.transactions.create({ kind: 'expense', walletId: good.id, amountMinor: 1_000, occurredOn: '2026-10-05' });
    await d.engine.syncNow();
    await d.engine.syncNow();
    await settle();
    expect(server.dump(USER, 'transactions')).toHaveLength(1);
    expect(server.dump(USER, 'wallets').map((r) => r['name'])).toContain('Нормальный');
    expect(server.dump(USER, 'wallets').map((r) => r['name'])).not.toContain('Яд');
    expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, quarantined: 1 });
  });
});
