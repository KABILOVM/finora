// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SERVER_ROW_API, SERVER_ROW_NBT, SERVER_ROW_YESTERDAY } from './__fixtures__/server.fixtures';
import { NOW } from './__fixtures__/testkit';
import { RateParseError } from './parseUtil';
import { serverProvider, type RatesClient, type RatesQueryResult } from './server';

interface Seen {
  table?: string;
  cols?: string;
  order?: [string, { ascending?: boolean } | undefined];
  limit?: number;
}

function fakeClient(result: RatesQueryResult | (() => RatesQueryResult | Promise<RatesQueryResult>)): RatesClient & { seen: Seen } {
  const seen: Seen = {};
  return {
    seen,
    from(table) {
      seen.table = table;
      return {
        select(cols) {
          seen.cols = cols;
          return {
            order(col, opts) {
              seen.order = [col, opts];
              return {
                limit(n) {
                  seen.limit = n;
                  return Promise.resolve(typeof result === 'function' ? result() : result);
                },
              };
            },
          };
        },
      };
    },
  };
}

const opts = { now: () => NOW };
const warningsOf = (t: unknown): string[] => (t as { warnings: string[] }).warnings;
const rows = (...r: unknown[]): RatesQueryResult => ({ data: r, error: null });

describe('serverProvider', () => {
  it('читает public.exchange_rates: нужные колонки, по убыванию as_of, с лимитом', async () => {
    const client = fakeClient(rows(SERVER_ROW_NBT));
    await serverProvider(client, opts).fetchLatest();
    expect(client.seen).toEqual({
      table: 'exchange_rates',
      cols: 'as_of,source,pivot,per_unit,fetched_at',
      order: ['as_of', { ascending: false }],
      limit: 10,
    });
  });

  it('id «server»; строка превращается в таблицу с source «server» и меткой времени ISO с миллисекундами', async () => {
    const provider = serverProvider(fakeClient(rows(SERVER_ROW_NBT)), opts);
    expect(provider.id).toBe('server');
    const t = await provider.fetchLatest();
    expect(t).toMatchObject({ asOf: '2026-10-10', pivot: 'TJS', source: 'server', fetchedAt: '2026-10-10T05:00:00.123Z' });
    expect(t.perUnit).toEqual({ TJS: 1, USD: 10.95, EUR: 12.78, RUB: 0.1189 });
  });

  it('выбирает самую свежую дату', async () => {
    const t = await serverProvider(fakeClient(rows(SERVER_ROW_YESTERDAY, SERVER_ROW_NBT)), opts).fetchLatest();
    expect(t.asOf).toBe('2026-10-10');
  });

  it('при равной дате официальный «nbt» предпочтительнее «api», независимо от порядка строк', async () => {
    for (const order of [[SERVER_ROW_API, SERVER_ROW_NBT], [SERVER_ROW_NBT, SERVER_ROW_API]]) {
      const t = await serverProvider(fakeClient(rows(...order)), opts).fetchLatest();
      expect(t.perUnit.USD).toBe(10.95);
    }
  });

  it('per_unit может прийти строкой JSON; pivot в per_unit можно не повторять', async () => {
    const t = await serverProvider(
      fakeClient(rows({ ...SERVER_ROW_NBT, per_unit: JSON.stringify({ USD: 10.95 }) })),
      opts,
    ).fetchLatest();
    expect(t.perUnit).toEqual({ TJS: 1, USD: 10.95 });
  });

  it('негодные записи внутри per_unit отбрасываются с предупреждением', async () => {
    const t = await serverProvider(
      fakeClient(rows({ ...SERVER_ROW_NBT, per_unit: { TJS: 1, USD: 10.95, EUR: 0, RUB: 'x', 'bad!': 2 } })),
      opts,
    ).fetchLatest();
    expect(Object.keys(t.perUnit).sort()).toEqual(['TJS', 'USD']);
    expect(warningsOf(t).length).toBe(3);
  });

  it('битые строки пропускаются, годная используется; пропуск описан в warnings', async () => {
    const bad = [
      { ...SERVER_ROW_NBT, as_of: 'вчера' },
      { ...SERVER_ROW_NBT, as_of: '2036-01-01' },
      { ...SERVER_ROW_NBT, pivot: 'tjs' },
      { ...SERVER_ROW_NBT, per_unit: [1, 2] },
      { ...SERVER_ROW_NBT, per_unit: { TJS: 2, USD: 10 } },
      { ...SERVER_ROW_NBT, fetched_at: 'когда-то' },
      { ...SERVER_ROW_NBT, per_unit: { TJS: 1 } },
      null,
      'строка',
    ];
    const t = await serverProvider(fakeClient(rows(...bad, SERVER_ROW_YESTERDAY)), opts).fetchLatest();
    expect(t.asOf).toBe('2026-10-09');
    expect(warningsOf(t).some((w) => w.startsWith('Строка сервера пропущена'))).toBe(true);
  });

  it('ошибка базы, пустой ответ, null и сплошной мусор — отказ', async () => {
    await expect(serverProvider(fakeClient({ data: null, error: { message: 'JWT expired' } }), opts).fetchLatest()).rejects.toThrow(/^Сервер курсов: Источник курсов не пустил запрос/);
    await expect(serverProvider(fakeClient({ data: null, error: 'boom' }), opts).fetchLatest()).rejects.toThrow(/^Сервер курсов: Источник курсов вернул ошибку$/);
    await expect(serverProvider(fakeClient(rows()), opts).fetchLatest()).rejects.toThrow(RateParseError);
    await expect(serverProvider(fakeClient({ data: null, error: null }), opts).fetchLatest()).rejects.toThrow(/пока нет курсов/);
    await expect(serverProvider(fakeClient(rows({ junk: 1 }, null)), opts).fetchLatest()).rejects.toThrow(/нет пригодных курсов/);
  });

  it('ошибка самого вызова (исключение, не {error}) тоже становится отказом', async () => {
    const client = fakeClient(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(serverProvider(client, opts).fetchLatest()).rejects.toThrow(/Failed to fetch/);
  });

  it('отменённый signal: запрос не отправляется; отмена во время запроса отбрасывает ответ', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const client = fakeClient(rows(SERVER_ROW_NBT));
    await expect(serverProvider(client, opts).fetchLatest(ctrl.signal)).rejects.toThrow();
    expect(client.seen.table).toBeUndefined();

    const late = new AbortController();
    const slow = fakeClient(() => {
      late.abort();
      return rows(SERVER_ROW_NBT);
    });
    await expect(serverProvider(slow, opts).fetchLatest(late.signal)).rejects.toThrow();
  });

  it('работает с «thenable», как построитель запросов supabase-js (не настоящий Promise)', async () => {
    const thenable: PromiseLike<RatesQueryResult> = { then: (ok, fail) => Promise.resolve(rows(SERVER_ROW_NBT)).then(ok, fail) };
    const client: RatesClient = { from: () => ({ select: () => ({ order: () => ({ limit: () => thenable }) }) }) };
    expect((await serverProvider(client, opts).fetchLatest()).perUnit.USD).toBe(10.95);
  });

  it('свой лимит строк', async () => {
    const client = fakeClient(rows(SERVER_ROW_NBT));
    await serverProvider(client, { ...opts, limit: 3 }).fetchLatest();
    expect(client.seen.limit).toBe(3);
  });
});

describe('serverProvider: более ранняя строка с TJS, когда в свежей её нет', () => {
  const apiNoTjs = {
    as_of: '2026-10-10',
    source: 'api',
    pivot: 'USD',
    per_unit: { USD: 1, EUR: 1.167, RUB: 0.0109 },
    fetched_at: '2026-10-10T06:00:00+00:00',
  };
  const earlierOf = (t: unknown) => (t as { earlier?: { asOf: string; pivot: string }[] }).earlier;

  it('свежая строка без TJS → к ней прикладывается ближайшая более ранняя строка с TJS', async () => {
    const t = await serverProvider(fakeClient(rows(apiNoTjs, SERVER_ROW_YESTERDAY)), opts).fetchLatest();
    expect(t).toMatchObject({ asOf: '2026-10-10', pivot: 'USD' });
    expect(earlierOf(t)).toHaveLength(1);
    expect(earlierOf(t)?.[0]).toMatchObject({ asOf: '2026-10-09', pivot: 'TJS', source: 'server' });
  });

  it('из нескольких более ранних берётся самая свежая с TJS, при равной дате — официальная', async () => {
    const older = { ...SERVER_ROW_YESTERDAY, as_of: '2026-10-05' };
    const sameDayApi = { ...SERVER_ROW_YESTERDAY, source: 'api', per_unit: { TJS: 1, USD: 9.5 }, fetched_at: '2026-10-09T09:00:00+00:00' };
    const t = await serverProvider(fakeClient(rows(older, apiNoTjs, sameDayApi, SERVER_ROW_YESTERDAY)), opts).fetchLatest();
    expect(earlierOf(t)).toHaveLength(1);
    expect(earlierOf(t)?.[0]).toMatchObject({ asOf: '2026-10-09' });
    expect((earlierOf(t)?.[0] as unknown as { perUnit: Record<string, number> }).perUnit.USD).toBe(10.9);
  });

  it('если в свежей строке TJS есть, ничего не прикладывается (обычный случай не меняется)', async () => {
    const t = await serverProvider(fakeClient(rows(SERVER_ROW_NBT, SERVER_ROW_YESTERDAY)), opts).fetchLatest();
    expect(earlierOf(t)).toBeUndefined();
  });

  it('ранней строки с TJS нет (или она той же даты, или битая) → прикладывать нечего', async () => {
    expect(earlierOf(await serverProvider(fakeClient(rows(apiNoTjs)), opts).fetchLatest())).toBeUndefined();
    const sameDay = { ...SERVER_ROW_NBT, as_of: '2026-10-10' };
    expect(earlierOf(await serverProvider(fakeClient(rows(apiNoTjs, sameDay)), opts).fetchLatest())).toBeUndefined();
    // строка с TJS есть, но это самая свежая (официальная той же даты) — значит, она и главная
    expect((await serverProvider(fakeClient(rows(apiNoTjs, sameDay)), opts).fetchLatest()).pivot).toBe('TJS');
    const broken = { ...SERVER_ROW_YESTERDAY, per_unit: { TJS: 1, USD: -1 } };
    expect(earlierOf(await serverProvider(fakeClient(rows(apiNoTjs, broken)), opts).fetchLatest())).toBeUndefined();
  });
});

// Проверка на этапе компиляции (tsc): настоящий клиент supabase-js подходит под минимальный интерфейс.
// Функция не вызывается — сеть не нужна.
export function _supabaseClientFitsRatesClient(client: SupabaseClient) {
  return serverProvider(client);
}
