// @vitest-environment node
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyPostgrestError, createSupabaseTransport, toWellFormed } from '@/sync/supabaseTransport';
import { toWire } from '@/sync/tables';
import { TransportError, type TransportErrorKind } from '@/sync/transport';
import { makeCategory, makeUserId, makeWallet } from './factories';
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

  it('push: ожидаемая версия строки (base_seq) уходит в теле запроса как есть — проверку делает сервер', async () => {
    const { client, queries } = fakeClient(() => ({ data: null, error: null, status: 201 }));
    const rows = [toWire('wallets', makeWallet(), 0), toWire('wallets', makeWallet(), 17)];
    await createSupabaseTransport(client).push('wallets', rows);
    expect((queries[0] as Query).rows).toEqual(rows);
    expect(((queries[0] as Query).rows as Array<Record<string, unknown>>).map((r) => r['base_seq'])).toEqual([0, 17]);
  });

  it('push: сервер без колонки base_seq (схема не обновлена, PGRST204) — повтор без неё, дальше без проверки версии, как раньше', async () => {
    const missing = { code: 'PGRST204', message: "Could not find the 'base_seq' column of 'wallets' in the schema cache" };
    const { client, queries } = fakeClient((q) => {
      const rows = q.rows as Array<Record<string, unknown>>;
      return rows.some((r) => 'base_seq' in r) ? { data: null, error: missing, status: 400 } : { data: null, error: null, status: 201 };
    });
    const t = createSupabaseTransport(client);
    const w = makeWallet();
    const { base_seq: _dropped, ...withoutBase } = toWire('wallets', w, 5);
    await t.push('wallets', [toWire('wallets', w, 5)]); // один повтор, ошибки наружу нет
    expect(queries).toHaveLength(2);
    expect((queries[0] as Query).rows).toEqual([toWire('wallets', w, 5)]);
    expect((queries[1] as Query).rows).toEqual([withoutBase]); // те же данные, только без служебной колонки
    await t.push('wallets', [toWire('wallets', makeWallet(), 6)]); // запомнил: первый запрос уже без колонки
    expect(queries).toHaveLength(3);
    expect(((queries[2] as Query).rows as Array<Record<string, unknown>>).every((r) => !('base_seq' in r))).toBe(true);
  });

  describe('push: сервер без колонок цели накопления (раздел 11 схемы не выполнен)', () => {
    const missingGoal = { code: 'PGRST204', message: "Could not find the 'goal_minor' column of 'wallets' in the schema cache" };
    const withGoalCols = (q: Query) => (q.rows as Array<Record<string, unknown>>).some((r) => 'goal_minor' in r || 'goal_on' in r);
    const old = () => fakeClient((q) => (withGoalCols(q) ? { data: null, error: missingGoal, status: 400 } : { data: null, error: null, status: 201 }));

    it('у всех строк цель пуста — повтор без двух пустых колонок, дальше сразу без них; остальные поля те же', async () => {
      const { client, queries } = old();
      const t = createSupabaseTransport(client);
      const w = makeWallet();
      const full = toWire('wallets', w, 5);
      const { goal_minor: _a, goal_on: _b, ...trimmed } = full;
      await t.push('wallets', [full]); // ошибки наружу нет
      expect(queries).toHaveLength(2);
      expect((queries[0] as Query).rows).toEqual([full]);
      expect((queries[1] as Query).rows).toEqual([trimmed]);
      await t.push('wallets', [toWire('wallets', makeWallet(), 6)]); // запомнил: сразу без колонок цели
      expect(queries).toHaveLength(3);
      expect(((queries[2] as Query).rows as Array<Record<string, unknown>>).every((r) => !('goal_minor' in r) && !('goal_on' in r))).toBe(true);
    });

    it('у какой-то строки цель задана — ошибку не прячем (цель нельзя потерять молча): «устарела схема» с колонками, повторов нет', async () => {
      const { client, queries } = old();
      const withGoal = makeWallet({ kind: 'savings', goalMinor: 100_000, goalOn: '2027-01-01' });
      const err = await createSupabaseTransport(client).push('wallets', [toWire('wallets', makeWallet(), 1), toWire('wallets', withGoal, 2)]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransportError);
      // не «сервер недоступен»: движок отложит только строку с целью, остальное отправит
      expect(err).toMatchObject({ kind: 'schema', code: 'PGRST204', columns: ['goal_minor', 'goal_on'], retryable: false });
      expect(queries).toHaveLength(1);
    });

    it('колонки отключены раньше, а теперь пришла правка с целью: идёт С колонками (не теряется); пока сервер без них — ошибка, когда появились — принято', async () => {
      let serverHasGoal = false;
      const { client, queries } = fakeClient((q) => (withGoalCols(q) && !serverHasGoal ? { data: null, error: missingGoal, status: 400 } : { data: null, error: null, status: 201 }));
      const t = createSupabaseTransport(client);
      await t.push('wallets', [toWire('wallets', makeWallet(), 1)]); // отключили колонки цели
      const goalRow = toWire('wallets', makeWallet({ kind: 'savings', goalMinor: 100_000, goalOn: '2027-01-01' }), 2);
      const err = await t.push('wallets', [goalRow]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransportError);
      expect((err as TransportError).kind).toBe('schema');
      const sent = (queries[queries.length - 1] as Query).rows as Array<Record<string, unknown>>;
      expect(sent[0]).toMatchObject({ goal_minor: 100_000, goal_on: '2027-01-01' }); // цель в запросе была
      serverHasGoal = true; // схему обновили
      await t.push('wallets', [goalRow]);
      expect(((queries[queries.length - 1] as Query).rows as Array<Record<string, unknown>>)[0]).toMatchObject({ goal_minor: 100_000 });
      await t.push('wallets', [toWire('wallets', makeWallet(), 3)]); // дальше колонки снова шлются всегда
      expect(withGoalCols(queries[queries.length - 1] as Query)).toBe(true);
    });

    it('другие таблицы не страдают: пачка категорий уходит как есть', async () => {
      const { client, queries } = fakeClient(() => ({ data: null, error: null, status: 201 }));
      await createSupabaseTransport(client).push('categories', [toWire('categories', makeCategory(), 1)]);
      expect(queries).toHaveLength(1);
    });

    it('нет и base_seq, и колонок цели, а цель задана: base_seq отключается и запрос повторяется, затем «устарела схема»', async () => {
      const missingBase = { code: 'PGRST204', message: "Could not find the 'base_seq' column of 'wallets' in the schema cache" };
      const { client, queries } = fakeClient((q) => {
        const rows = q.rows as Array<Record<string, unknown>>;
        if (rows.some((r) => 'base_seq' in r)) return { data: null, error: missingBase, status: 400 };
        if (rows.some((r) => 'goal_minor' in r)) return { data: null, error: missingGoal, status: 400 };
        return { data: null, error: null, status: 201 };
      });
      const withGoal = toWire('wallets', makeWallet({ kind: 'savings', goalMinor: 100_000, goalOn: null }), 5);
      const err = await createSupabaseTransport(client).push('wallets', [withGoal]).catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: 'schema', columns: ['goal_minor', 'goal_on'] });
      expect(queries).toHaveLength(2);
      expect(((queries[1] as Query).rows as Array<Record<string, unknown>>)[0]).not.toHaveProperty('base_seq');
    });

    it('нет и base_seq, и колонок цели (самая старая схема): оба отключаются, отправка проходит', async () => {
      const missingBase = { code: 'PGRST204', message: "Could not find the 'base_seq' column of 'wallets' in the schema cache" };
      const { client, queries } = fakeClient((q) => {
        const rows = q.rows as Array<Record<string, unknown>>;
        if (rows.some((r) => 'goal_minor' in r)) return { data: null, error: missingGoal, status: 400 };
        if (rows.some((r) => 'base_seq' in r)) return { data: null, error: missingBase, status: 400 };
        return { data: null, error: null, status: 201 };
      });
      await createSupabaseTransport(client).push('wallets', [toWire('wallets', makeWallet(), 5)]);
      const last = (queries[queries.length - 1] as Query).rows as Array<Record<string, unknown>>;
      expect(last.every((r) => !('goal_minor' in r) && !('goal_on' in r) && !('base_seq' in r))).toBe(true);
    });

    it('колонка goal_on тоже узнаётся по сообщению; ошибка про ДРУГУЮ колонку по-прежнему наружу', async () => {
      const missingOn = { code: 'PGRST204', message: "Could not find the 'goal_on' column of 'wallets' in the schema cache" };
      const a = fakeClient((q) => (withGoalCols(q) ? { data: null, error: missingOn, status: 400 } : { data: null, error: null, status: 201 }));
      await createSupabaseTransport(a.client).push('wallets', [toWire('wallets', makeWallet(), 5)]);
      expect(a.queries).toHaveLength(2);
      const other = { code: 'PGRST204', message: "Could not find the 'nope' column of 'wallets' in the schema cache" };
      const b = fakeClient(() => ({ data: null, error: other, status: 400 }));
      await expect(createSupabaseTransport(b.client).push('wallets', [toWire('wallets', makeWallet(), 5)])).rejects.toBeInstanceOf(TransportError);
      expect(b.queries).toHaveLength(1);
    });
  });

  describe('push: сервер без колонки городов для погоды (раздел 13 схемы не выполнен)', () => {
    const missingWeather = { code: 'PGRST204', message: "Could not find the 'weather' column of 'settings' in the schema cache" };
    const old = () =>
      fakeClient((q) =>
        (q.rows as Array<Record<string, unknown>>).some((r) => 'weather' in r) ? { data: null, error: missingWeather, status: 400 } : { data: null, error: null, status: 201 },
      );
    const settings = (weather: string | null) =>
      toWire('settings', { id: makeUserId(), createdAt: '2026-10-01T00:00:00.000Z', clientUpdatedAt: '2026-10-01T00:00:00.000Z', deviceId: 'd', deletedAt: null, baseCurrency: 'TJS', locale: 'ru', weekStartsOn: 1, defaultWalletId: null, weather } as never, 3);

    it('города не выбраны — повтор без пустой колонки, ошибки нет', async () => {
      const { client, queries } = old();
      await createSupabaseTransport(client).push('settings', [settings(null)]);
      expect(queries).toHaveLength(2);
      expect(((queries[1] as Query).rows as Array<Record<string, unknown>>)[0]).not.toHaveProperty('weather');
    });

    it('город выбран — «устарела схема» с колонкой weather (не «сервер недоступен»), повторов нет', async () => {
      const { client, queries } = old();
      const err = await createSupabaseTransport(client).push('settings', [settings('{"v":1,"selected":null,"cities":[]}')]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransportError);
      expect(err).toMatchObject({ kind: 'schema', code: 'PGRST204', columns: ['weather'] });
      expect(queries).toHaveLength(1);
    });
  });

  it('push: PGRST204 про ДРУГУЮ колонку — по-прежнему ошибка сервера, а не тихий повтор без проверки версии', async () => {
    const other = { code: 'PGRST204', message: "Could not find the 'nope' column of 'wallets' in the schema cache" };
    const { client, queries } = fakeClient(() => ({ data: null, error: other, status: 400 }));
    const err = await createSupabaseTransport(client).push('wallets', [toWire('wallets', makeWallet(), 5)]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe('server');
    expect(queries).toHaveLength(1);
  });

  it('push: конфликт версии (40001) — TransportError conflict без повторов внутри транспорта', async () => {
    const { client, queries } = fakeClient(() => ({ data: null, error: { code: '40001', message: 'sync_conflict: row x of "wallets" is at version 9, the write expected 5' }, status: 500 }));
    const err = await createSupabaseTransport(client).push('wallets', [toWire('wallets', makeWallet(), 5)]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect(err).toMatchObject({ kind: 'conflict', code: '40001', retryable: false });
    expect(queries).toHaveLength(1);
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
    // 40001 — ответ триггера sync_guard «версия строки на сервере ушла вперёд»: не ошибка данных и не сбой сервера, а повод
    // забрать свежее, объединить и отправить заново. Код решает, статус (у PostgREST для класса 40 он 500, у других — 409) нет.
    ['сбой сериализации / конфликт версии 40001 (статус 409)', { error: pg('40001'), status: 409 }, 'conflict'],
    ['сбой сериализации / конфликт версии 40001 (статус 500)', { error: pg('40001'), status: 500 }, 'conflict'],
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
