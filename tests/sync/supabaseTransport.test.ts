// @vitest-environment node
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyPostgrestError, createSupabaseTransport, toWellFormed } from '@/sync/supabaseTransport';
import { toWire } from '@/sync/tables';
import { TransportError, type TransportErrorKind } from '@/sync/transport';
import { makeUserId, makeWallet } from './factories';
import { makeJwt } from './postgrestEmulator';

/** Боевой транспорт: какие запросы строит и как разбирает отказы PostgREST. */

afterEach(() => {
  vi.useRealTimers();
});

interface Query {
  table: string;
  op: 'select' | 'upsert';
  columns?: string;
  gt?: [string, unknown];
  order?: [string, unknown];
  limit?: number;
  rows?: unknown;
  upsertOptions?: unknown;
  signal?: AbortSignal;
  retry?: boolean;
  chain: string[];
}
type Result = { data?: unknown; error?: unknown; status?: number };

/** Поддельный клиент: собирает цепочку вызовов и отдаёт результат обработчика. */
function fakeClient(handler: (q: Query) => Result | Promise<Result>): { client: SupabaseClient; queries: Query[] } {
  const queries: Query[] = [];
  const builder = (q: Query) => {
    const self = {
      select: (c: string) => ((q.columns = c), q.chain.push('select'), self),
      gt: (c: string, v: unknown) => ((q.gt = [c, v]), q.chain.push('gt'), self),
      order: (c: string, o: unknown) => ((q.order = [c, o]), q.chain.push('order'), self),
      limit: (n: number) => ((q.limit = n), q.chain.push('limit'), self),
      abortSignal: (s: AbortSignal) => ((q.signal = s), q.chain.push('abortSignal'), self),
      retry: (b: boolean) => ((q.retry = b), q.chain.push('retry'), self),
      then: (ok: (r: Result) => unknown, bad: (e: unknown) => unknown) => Promise.resolve().then(() => handler(q)).then(ok, bad),
    };
    return self;
  };
  const client = {
    from: (table: string) => ({
      select: (columns: string) => {
        const q: Query = { table, op: 'select', columns, chain: ['select'] };
        queries.push(q);
        return builder(q);
      },
      upsert: (rows: unknown, upsertOptions: unknown) => {
        const q: Query = { table, op: 'upsert', rows, upsertOptions, chain: ['upsert'] };
        queries.push(q);
        return builder(q);
      },
    }),
  } as unknown as SupabaseClient;
  return { client, queries };
}

const wallet = () => toWire('wallets', makeWallet());

describe('запросы', () => {
  it('pull: select * → gt(server_seq) → order(server_seq, возрастание) → limit, с отменой по таймауту и без встроенных повторов', async () => {
    const { client, queries } = fakeClient(() => ({ data: [{ id: 'x', server_seq: 6 }], error: null, status: 200 }));
    const rows = await createSupabaseTransport(client).pull('wallets', 5, 500);
    expect(rows).toEqual([{ id: 'x', server_seq: 6 }]);
    expect(queries).toHaveLength(1);
    const q = queries[0] as Query;
    expect(q).toMatchObject({ table: 'wallets', op: 'select', columns: '*', gt: ['server_seq', 5], order: ['server_seq', { ascending: true }], limit: 500, retry: false });
    expect(q.signal).toBeInstanceOf(AbortSignal);
  });

  it('pull: имя таблицы на сервере берётся из договора (TABLE_SPECS.remote)', async () => {
    const { client, queries } = fakeClient(() => ({ data: [], error: null, status: 200 }));
    const t = createSupabaseTransport(client);
    for (const table of ['settings', 'wallets', 'categories', 'transactions'] as const) await t.pull(table, 0, 10);
    expect(queries.map((q) => q.table)).toEqual(['settings', 'wallets', 'categories', 'transactions']);
  });

  it('push: upsert по id, прямых UPDATE нет, лишних цепочек (select) нет — ответ «minimal»', async () => {
    const { client, queries } = fakeClient(() => ({ data: null, error: null, status: 201 }));
    const rows = [wallet(), wallet()];
    await createSupabaseTransport(client).push('wallets', rows);
    const q = queries[0] as Query;
    expect(q).toMatchObject({ table: 'wallets', op: 'upsert', rows, upsertOptions: { onConflict: 'id' } });
    expect(q.chain).toEqual(['upsert', 'abortSignal']);
  });

  it('push: пустая пачка не делает запроса', async () => {
    const { client, queries } = fakeClient(() => ({ data: null, error: null, status: 201 }));
    await createSupabaseTransport(client).push('wallets', []);
    expect(queries).toHaveLength(0);
  });

  it('проверка аргументов: неизвестная таблица, плохой курс/лимит', async () => {
    const { client } = fakeClient(() => ({ data: [], error: null, status: 200 }));
    const t = createSupabaseTransport(client);
    await expect(t.pull('nope' as never, 0, 10)).rejects.toBeInstanceOf(TypeError);
    await expect(t.pull('wallets', -1, 10)).rejects.toBeInstanceOf(RangeError);
    await expect(t.pull('wallets', 1.5, 10)).rejects.toBeInstanceOf(RangeError);
    await expect(t.pull('wallets', 0, 0)).rejects.toBeInstanceOf(RangeError);
    await expect(t.push('nope' as never, [])).rejects.toBeInstanceOf(TypeError);
    expect(() => createSupabaseTransport(client, { timeoutMs: 0 })).toThrow(RangeError);
  });

  it('ответ не в виде списка объектов — ошибка сервера, а не тихая потеря данных', async () => {
    for (const data of [null, { id: 1 }, 'text', [1, 2], [null]]) {
      const { client } = fakeClient(() => ({ data, error: null, status: 200 }));
      const err = await createSupabaseTransport(client).pull('wallets', 0, 10).catch((e: unknown) => e);
      expect(err, JSON.stringify(data)).toBeInstanceOf(TransportError);
      expect((err as TransportError).kind).toBe('server');
    }
  });
});

describe('разбор ошибок PostgREST', () => {
  type Row = [string, { error: unknown; status?: number }, TransportErrorKind];
  const pg = (code: string | undefined, message = 'ошибка'): unknown => ({ code, message, details: null, hint: null });
  const table: Row[] = [
    // нет ответа вообще
    ['сбой fetch (Chrome), статус 0', { error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }, 'network'],
    ['сбой fetch (Safari), статус 0', { error: { message: 'TypeError: Load failed', code: '' }, status: 0 }, 'network'],
    ['отмена по таймауту, статус 0', { error: { message: 'AbortError: signal is aborted without reason', code: '' }, status: 0 }, 'network'],
    ['статус 0 без текста', { error: {}, status: 0 }, 'network'],
    // сессия
    ['просроченный JWT: PGRST301', { error: pg('PGRST301', 'JWT expired'), status: 401 }, 'auth'],
    ['PGRST303 (JWT не принят)', { error: pg('PGRST303', 'JWT claim sub is missing'), status: 401 }, 'auth'],
    ['PGRST301 даже со статусом 400', { error: pg('PGRST301'), status: 400 }, 'auth'],
    ['401 без кода (шлюз: неверный ключ)', { error: { message: 'Invalid API key' }, status: 401 }, 'auth'],
    ['401 с 42501: сессия потеряна, запрос ушёл анонимно — это «войдите», а не «данные плохие»', { error: pg('42501', 'permission denied for table wallets'), status: 401 }, 'auth'],
    ['SQLSTATE 28000', { error: pg('28000', 'Нужно войти в систему'), status: 400 }, 'auth'],
    // данные отвергнуты
    ['внешний ключ 23503', { error: pg('23503'), status: 409 }, 'rejected'],
    ['уникальность 23505', { error: pg('23505'), status: 409 }, 'rejected'],
    ['CHECK 23514', { error: pg('23514'), status: 400 }, 'rejected'],
    ['NOT NULL 23502', { error: pg('23502'), status: 400 }, 'rejected'],
    ['плохой формат 22P02', { error: pg('22P02'), status: 400 }, 'rejected'],
    ['переполнение 22003', { error: pg('22003'), status: 400 }, 'rejected'],
    ['дата вне диапазона 22008', { error: pg('22008'), status: 400 }, 'rejected'],
    ['нельзя дважды изменить строку 21000', { error: pg('21000'), status: 500 }, 'rejected'],
    ['RLS 42501 (403)', { error: pg('42501', 'new row violates row-level security policy'), status: 403 }, 'rejected'],
    // сервер: повторять
    ['500 без кода', { error: { message: 'Internal Server Error' }, status: 500 }, 'server'],
    ['502 страница шлюза вместо JSON', { error: { message: '<html>Bad Gateway</html>' }, status: 502 }, 'server'],
    ['503', { error: { message: 'Service Unavailable' }, status: 503 }, 'server'],
    ['504 «timeout» в тексте шлюза — не сеть, а сервер', { error: { message: 'Gateway timeout' }, status: 504 }, 'server'],
    ['429 слишком часто', { error: { message: 'Too many requests' }, status: 429 }, 'server'],
    ['таймаут запроса в базе 57014', { error: pg('57014'), status: 500 }, 'server'],
    ['взаимная блокировка 40P01', { error: pg('40P01'), status: 500 }, 'server'],
    ['сбой сериализации 40001', { error: pg('40001'), status: 409 }, 'server'],
    ['слишком много соединений 53300', { error: pg('53300'), status: 503 }, 'server'],
    ['нет таблицы 42P01 (схема не применена) — не карантин', { error: pg('42P01'), status: 404 }, 'server'],
    ['нет колонки 42703 — не карантин', { error: pg('42703'), status: 400 }, 'server'],
    ['PGRST204: колонки нет в схеме — не карантин', { error: pg('PGRST204'), status: 400 }, 'server'],
    ['PGRST205: таблицы нет в схеме — не карантин', { error: pg('PGRST205'), status: 404 }, 'server'],
    ['PGRST102: тело запроса не разобрано', { error: pg('PGRST102'), status: 400 }, 'server'],
    ['200 с ошибкой разбора ответа (портал Wi-Fi)', { error: { message: '<html>login</html>' }, status: 200 }, 'server'],
    // HTTP 400 без кода: запрос неверен сам по себе — повтор тех же данных не поможет (иначе одна запись вечно держит всю очередь)
    ['400 без кода («Bad Request» от шлюза)', { error: { message: 'bad request' }, status: 400 }, 'rejected'],
    ['400 с пустым кодом', { error: pg('', 'bad request'), status: 400 }, 'rejected'],
    // а вот 403/404 без кода — это про доступ и маршрут, а не про одну запись: не карантин
    ['403 без кода (фильтр на входе)', { error: { message: 'Forbidden' }, status: 403 }, 'server'],
    ['404 без кода (не тот адрес)', { error: { message: 'Not Found' }, status: 404 }, 'server'],
    ['неизвестный код', { error: pg('XX000'), status: 500 }, 'server'],
  ];

  it.each(table)('%s', async (_name, result, kind) => {
    const { client } = fakeClient(() => ({ data: null, ...result }));
    const t = createSupabaseTransport(client);
    for (const op of [() => t.pull('wallets', 0, 10), () => t.push('wallets', [wallet()])]) {
      const err = await op().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(TransportError);
      expect((err as TransportError).kind).toBe(kind);
      expect((err as TransportError).retryable).toBe(kind === 'network' || kind === 'server');
    }
  });

  it('код ошибки сохраняется (по нему движок объясняет отказ человеку)', async () => {
    const { client } = fakeClient(() => ({ data: null, error: pg('23503'), status: 409 }));
    const err = (await createSupabaseTransport(client).push('wallets', [wallet()]).catch((e: unknown) => e)) as TransportError;
    expect(err.code).toBe('23503');
  });

  it('клиент бросил исключение (а не вернул error): TypeError / AbortError — сеть, остальное — сервер', () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(classifyPostgrestError(new TypeError('fetch failed')).kind).toBe('network');
    expect(classifyPostgrestError(abort).kind).toBe('network');
    expect(classifyPostgrestError(timeout).kind).toBe('network');
    expect(classifyPostgrestError(new Error('Failed to fetch')).kind).toBe('network');
    expect(classifyPostgrestError(new Error('boom')).kind).toBe('server');
    expect(classifyPostgrestError('строка').kind).toBe('server');
    expect(classifyPostgrestError(undefined).kind).toBe('server');
  });

  it('исключение из клиента превращается в TransportError, а не уходит наружу как есть', async () => {
    const { client } = fakeClient(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await createSupabaseTransport(client).pull('wallets', 0, 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe('network');
  });

  it('клиент не собрал запрос (исключение при from): тоже TransportError', async () => {
    const client = {
      from: () => {
        throw new Error('нет клиента');
      },
    } as unknown as SupabaseClient;
    const err = await createSupabaseTransport(client).push('wallets', [wallet()]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe('server');
  });
});

describe('таймаут', () => {
  it('зависший запрос обрывается через 15 с (по умолчанию): сетевая ошибка и отмена запроса', async () => {
    vi.useFakeTimers();
    const { client, queries } = fakeClient(() => new Promise<Result>(() => undefined)); // не отвечает никогда
    const p = createSupabaseTransport(client).pull('wallets', 0, 10).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(queries[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = (await p) as TransportError;
    expect(err).toBeInstanceOf(TransportError);
    expect(err).toMatchObject({ kind: 'network', code: 'timeout' });
    expect(queries[0]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('свой таймаут; push обрывается так же', async () => {
    vi.useFakeTimers();
    const { client } = fakeClient(() => new Promise<Result>(() => undefined));
    const p = createSupabaseTransport(client, { timeoutMs: 2_000 }).push('wallets', [wallet()]).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(((await p) as TransportError).kind).toBe('network');
  });

  it('быстрый ответ снимает таймер; поздняя ошибка после таймаута не превращается в необработанную', async () => {
    vi.useFakeTimers();
    const ok = fakeClient(() => ({ data: [], error: null, status: 200 }));
    await createSupabaseTransport(ok.client).pull('wallets', 0, 10);
    expect(vi.getTimerCount()).toBe(0);

    let rejectLate!: (e: unknown) => void;
    const late = fakeClient(() => new Promise<Result>((_, rej) => (rejectLate = rej)));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const p = createSupabaseTransport(late.client, { timeoutMs: 1000 }).pull('wallets', 0, 10).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    rejectLate(new Error('поздно'));
    await vi.advanceTimersByTimeAsync(10);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('настоящий supabase-js с поддельным fetch', () => {
  interface Seen {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
    signal: AbortSignal | null | undefined;
  }
  function realClient(respond: (seen: Seen) => Response | Promise<Response>) {
    const seen: Seen[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
      const s: Seen = { url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : null, signal: init?.signal };
      seen.push(s);
      return respond(s);
    };
    const client = createClient('http://localhost:54321', 'anon-key', {
      global: { fetch: fetchImpl as typeof fetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return { client, seen };
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('pull: GET /rest/v1/wallets?select=*&server_seq=gt.5&order=server_seq.asc&limit=500', async () => {
    const { client, seen } = realClient(() => json(200, [{ id: 'x', server_seq: 6 }]));
    const rows = await createSupabaseTransport(client).pull('wallets', 5, 500);
    expect(rows).toEqual([{ id: 'x', server_seq: 6 }]);
    const url = new URL(seen[0]?.url ?? '');
    expect(url.pathname).toBe('/rest/v1/wallets');
    expect(Object.fromEntries(url.searchParams)).toEqual({ select: '*', server_seq: 'gt.5', order: 'server_seq.asc', limit: '500' });
    expect(seen[0]?.method).toBe('GET');
  });

  it('push: POST /rest/v1/wallets?on_conflict=id, слияние по id, тело — массив строк как есть', async () => {
    const { client, seen } = realClient(() => new Response(null, { status: 201 }));
    const rows = [wallet(), wallet()];
    await createSupabaseTransport(client).push('wallets', rows);
    const s = seen[0] as Seen;
    expect(s.method).toBe('POST');
    const url = new URL(s.url);
    expect(url.pathname).toBe('/rest/v1/wallets');
    expect(url.searchParams.get('on_conflict')).toBe('id');
    expect(s.headers['prefer']).toContain('resolution=merge-duplicates');
    expect(s.headers['prefer']).not.toContain('return=representation');
    expect(JSON.parse(s.body ?? 'null')).toEqual(rows);
  });

  it('просроченный JWT (401 + PGRST301) → auth; сломанная сеть → network; 409 + 23503 → rejected; 503 → server', async () => {
    const cases: Array<[() => Response | Promise<Response>, TransportErrorKind]> = [
      [() => json(401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null }), 'auth'],
      [() => json(409, { code: '23503', message: 'violates foreign key constraint', details: null, hint: null }), 'rejected'],
      [() => json(503, { message: 'Service Unavailable' }), 'server'],
      [() => Promise.reject(new TypeError('Failed to fetch')), 'network'],
    ];
    for (const [respond, kind] of cases) {
      const { client } = realClient(respond);
      const t = createSupabaseTransport(client);
      for (const op of [() => t.pull('wallets', 0, 10), () => t.push('wallets', [wallet()])]) {
        const err = await op().then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe(kind);
      }
    }
  });

  it('GET не повторяется самим клиентом (повторы — дело движка): при 503 ровно один запрос', async () => {
    const { client, seen } = realClient(() => json(503, { message: 'Service Unavailable' }));
    await createSupabaseTransport(client).pull('wallets', 0, 10).catch(() => undefined);
    expect(seen).toHaveLength(1);
  });

  it('зависший fetch: отмена доходит до fetch (signal.aborted), результат — сетевая ошибка', async () => {
    vi.useFakeTimers();
    const { client, seen } = realClient(
      (s) =>
        new Promise<Response>((_, reject) => {
          s.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
        }),
    );
    const p = createSupabaseTransport(client, { timeoutMs: 3000 }).pull('wallets', 0, 10).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3000);
    const err = (await p) as TransportError;
    expect(err.kind).toBe('network');
    expect(seen[0]?.signal?.aborted).toBe(true);
  });
});

describe('текст без «одиноких» половинок суррогатной пары', () => {
  it('toWellFormed: целые пары и обычный текст не меняются, одинокие половинки становятся «�»', () => {
    expect(toWellFormed('Привет 😀 мир')).toBe('Привет 😀 мир');
    expect(toWellFormed('')).toBe('');
    expect(toWellFormed('ab\ud83d')).toBe('ab\uFFFD');
    expect(toWellFormed('\ude00ab')).toBe('\uFFFDab');
    expect(toWellFormed('\ud83d\ud83d\ude00')).toBe('\uFFFD\ud83d\ude00'); // первая — одинокая, вторая с третьей — пара
    expect(toWellFormed('x'.repeat(499) + '\ud83d')).toBe('x'.repeat(499) + '\uFFFD');
  });

  it('push: в запрос уходят только корректные строки (остальное — как есть, числа и null не трогаются)', async () => {
    const { client, queries } = fakeClient(() => ({ data: null, error: null, status: 201 }));
    const base = wallet();
    const row: typeof base = { ...base, name: 'ab\ud83d', icon: '😀' };
    await createSupabaseTransport(client).push('wallets', [row]);
    const sent = (queries[0]?.rows as Array<Record<string, unknown>>)[0] ?? {};
    expect(sent['name']).toBe('ab\uFFFD');
    expect(sent['icon']).toBe('😀');
    expect(sent['opening_balance_minor']).toBe(row['opening_balance_minor']);
    expect(sent['deleted_at']).toBeNull();
    expect(row['name']).toBe('ab\ud83d'); // исходная строка не изменена
  });
});

describe('currentUserId: чей токен уйдёт в следующем запросе', () => {
  const NOW = Math.floor(Date.now() / 1000);
  /** Хранилище сессии, общее для «вкладок» (как localStorage). */
  function sharedStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }
  const KEY = 'sb-test-auth-token';
  const sessionFor = (id: string, tokenSub = id) => ({
    access_token: makeJwt({ sub: tokenSub, exp: NOW + 3600 }),
    refresh_token: 'r',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: NOW + 3600,
    user: { id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  });
  const clientOn = (storage: ReturnType<typeof sharedStorage>) =>
    createClient('http://localhost:54321', 'anon-key', {
      auth: { storage, storageKey: KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    });

  it('читает пользователя из токена и сразу видит смену сессии в общем хранилище (вход другого человека в соседней вкладке)', async () => {
    const [a, b] = [makeUserId(), makeUserId()];
    const storage = sharedStorage();
    storage.setItem(KEY, JSON.stringify(sessionFor(a)));
    const transport = createSupabaseTransport(clientOn(storage));
    expect(await transport.currentUserId()).toBe(a);
    storage.setItem(KEY, JSON.stringify(sessionFor(b)));
    expect(await transport.currentUserId()).toBe(b);
  });

  it('если sub токена и user.id расходятся, верят токену: сервер считает владельцем именно sub', async () => {
    const [a, b] = [makeUserId(), makeUserId()];
    const storage = sharedStorage();
    storage.setItem(KEY, JSON.stringify(sessionFor(a, b)));
    expect(await createSupabaseTransport(clientOn(storage)).currentUserId()).toBe(b);
  });

  it('сессии нет — null', async () => {
    expect(await createSupabaseTransport(clientOn(sharedStorage())).currentUserId()).toBeNull();
  });

  it('клиент с собственным accessToken (серверный код, тесты) или поддельный без auth: узнать нельзя — undefined, а не сбой', async () => {
    const custom = createClient('http://localhost:54321', 'anon-key', { accessToken: async () => makeJwt({ sub: makeUserId() }) });
    expect(await createSupabaseTransport(custom).currentUserId()).toBeUndefined();
    const { client } = fakeClient(() => ({ data: [], error: null, status: 200 }));
    expect(await createSupabaseTransport(client).currentUserId()).toBeUndefined();
  });

  it('getSession вернул ошибку или бросил: это TransportError (сеть/сервер), а не «чужой пользователь»', async () => {
    const failing = { auth: { getSession: async () => ({ data: { session: null }, error: { message: 'Failed to fetch', status: 0 } }) } } as unknown as SupabaseClient;
    const err1 = await createSupabaseTransport(failing).currentUserId().catch((e: unknown) => e);
    expect(err1).toBeInstanceOf(TransportError);
    expect((err1 as TransportError).kind).toBe('network');
    const throwing = {
      auth: {
        getSession: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
    } as unknown as SupabaseClient;
    const err2 = await createSupabaseTransport(throwing).currentUserId().catch((e: unknown) => e);
    expect((err2 as TransportError).kind).toBe('network');
  });

  it('ошибка входа при чтении сессии: 5xx — сервер (повторить позже), а «обновить сессию не вышло» (4xx) — нужен вход', async () => {
    const withError = (error: unknown) => ({ auth: { getSession: async () => ({ data: { session: null }, error }) } }) as unknown as SupabaseClient;
    const kindOf = async (error: unknown) =>
      ((await createSupabaseTransport(withError(error)).currentUserId().catch((e: unknown) => e)) as TransportError).kind;
    expect(await kindOf({ message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400, code: 'refresh_token_not_found' })).toBe('auth');
    expect(await kindOf({ message: 'Auth session missing!', status: 400 })).toBe('auth');
    expect(await kindOf({ message: 'Service Unavailable', status: 503 })).toBe('server');
  });
});
