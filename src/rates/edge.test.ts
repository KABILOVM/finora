// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_GARBAGE,
  API_HTML,
  API_WITHOUT_TJS,
  API_WITH_TJS,
} from './__fixtures__/api.fixtures';
import {
  NBT_ALL_GARBAGE,
  NBT_ATTR_STYLE,
  NBT_CHILD_STYLE,
  NBT_FUTURE,
  NBT_GARBAGE,
  NBT_HTML,
  NBT_HUGE_NUMBERS,
  NBT_NO_DATE,
  NBT_TWO_DATES,
  NBT_VALUTE_STYLE,
  NBT_WITH_DOCTYPE,
} from './__fixtures__/nbt.fixtures';
import { NOW } from './__fixtures__/testkit';
import { parseCurrencyApiJson as clientParseApi } from './api';
import { parseNbtXml as clientParseNbt } from './nbt';
import { assessRateTable as clientAssess } from './sanity';
import * as edge from '../../supabase/functions/fetch-rates/index';

const EDGE_PATH = new URL('../../supabase/functions/fetch-rates/index.ts', import.meta.url);
const edgeSource = readFileSync(EDGE_PATH, 'utf8');

function region(source: string, name: string): string {
  const start = source.indexOf(`// <<< SHARED:${name}\n`);
  const endMarker = `// SHARED:${name} >>>`;
  const end = source.indexOf(endMarker);
  expect(start, `маркер начала SHARED:${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `маркер конца SHARED:${name}`).toBeGreaterThan(start);
  return source.slice(start, end + endMarker.length);
}

describe('Edge-функция: файл самодостаточен и не расходится с клиентом', () => {
  it.each([
    ['util', './parseUtil.ts'],
    ['nbt', './nbt.ts'],
    ['api', './api.ts'],
    ['sanity', './sanity.ts'],
  ])('блок SHARED:%s дословно совпадает с %s', (name, file) => {
    const client = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(region(edgeSource, name)).toBe(region(client, name));
  });

  it('нет импортов и require: файл можно целиком вставить в редактор Edge Functions', () => {
    expect(edgeSource).not.toMatch(/^\s*import[\s{*]/m);
    expect(edgeSource).not.toMatch(/\brequire\(/);
    expect(edgeSource).not.toMatch(/from\s+['"]/);
  });

  it('в коде нет секретов: ни JWT, ни sb_secret, ни присвоений ключей; ключи читаются только из окружения', () => {
    expect(edgeSource).not.toMatch(/eyJ[A-Za-z0-9_-]{15,}/);
    expect(edgeSource).not.toMatch(/sb_secret_/);
    expect(edgeSource).not.toMatch(/(service_role|SERVICE_ROLE_KEY|CRON_SECRET)['"]?\s*[:=]\s*['"][^'"]+['"]/);
    expect(edgeSource).toContain("env('SUPABASE_SERVICE_ROLE_KEY')");
    expect(edgeSource).toContain("env('CRON_SECRET')");
    expect(edgeSource).toContain("env('SUPABASE_URL')");
  });

  it('объявлен declare const Deno; сервер стартует только внутри if (typeof Deno !== "undefined")', () => {
    expect(edgeSource).toContain('declare const Deno: any;');
    expect(edgeSource).toMatch(/if \(typeof Deno !== 'undefined'\) \{\s*Deno\.serve\(/);
    expect(typeof (globalThis as { Deno?: unknown }).Deno).toBe('undefined'); // импорт выше прошёл без Deno
  });

  it('шапка честно предупреждает про непроверенный формат и описывает развёртывание и расписание', () => {
    const head = edgeSource.slice(0, 4000);
    expect(head).toContain('ФОРМАТ НЕ ПРОВЕРЕН НА ЖИВОМ ИСТОЧНИКЕ');
    expect(head).toContain('КАК РАЗВЕРНУТЬ');
    expect(head).toContain('КАК ЗАПУСКАТЬ РАЗ В СУТКИ');
    expect(head).toContain('CRON_SECRET');
  });
});

describe('Edge-функция: парсеры идентичны клиентским на тех же фикстурах', () => {
  const nbtFixtures: Record<string, string> = {
    NBT_VALUTE_STYLE,
    NBT_CHILD_STYLE,
    NBT_ATTR_STYLE,
    NBT_GARBAGE,
    NBT_HUGE_NUMBERS,
    NBT_ALL_GARBAGE,
    NBT_HTML,
    NBT_NO_DATE,
    NBT_TWO_DATES,
    NBT_FUTURE,
    NBT_WITH_DOCTYPE,
    пусто: '',
    пробелы: '  \n ',
    текст: 'Service Unavailable',
    оборванный: NBT_VALUTE_STYLE.slice(0, 400),
  };

  const outcome = (fn: () => unknown) => {
    try {
      return { value: fn() };
    } catch (e) {
      return { error: `${(e as Error).name}: ${(e as Error).message}` };
    }
  };

  it.each(Object.keys(nbtFixtures))('parseNbtXml: %s', (name) => {
    const xml = nbtFixtures[name] as string;
    expect(outcome(() => edge.parseNbtXml(xml, NOW))).toEqual(outcome(() => clientParseNbt(xml, NOW)));
  });

  it('на нормальной фикстуре результат не пустой (сравнение не вырождается в «оба упали»)', () => {
    const t = edge.parseNbtXml(NBT_VALUTE_STYLE, NOW);
    expect(t.perUnit.USD).toBe(10.95);
    expect(t.asOf).toBe('2026-10-10');
  });

  it.each([
    ['с tjs', API_WITH_TJS],
    ['без tjs', API_WITHOUT_TJS],
    ['мусор', API_GARBAGE],
    ['HTML', API_HTML],
  ])('parseCurrencyApiJson: %s', (_n, json) => {
    expect(outcome(() => edge.parseCurrencyApiJson(json, 'usd', NOW))).toEqual(outcome(() => clientParseApi(json, 'usd', NOW)));
  });

  it('assessRateTable даёт тот же вердикт', () => {
    const prev = clientParseNbt(NBT_VALUTE_STYLE, NOW);
    const same = clientParseNbt(NBT_CHILD_STYLE, NOW);
    const jumpy = { ...same, perUnit: { ...same.perUnit, USD: 30 } };
    for (const next of [same, jumpy, clientParseApi(API_WITH_TJS, 'usd', NOW), clientParseApi(API_WITHOUT_TJS, 'usd', NOW)]) {
      expect(edge.assessRateTable(next, prev)).toEqual(clientAssess(next, prev));
    }
    expect(clientAssess(jumpy, prev).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------------------------------------------------

const SECRET = 'cron-secret-0123456789-abcdef';
const SERVICE_KEY = 'service-role-key-XYZ-987654321';
const BASE = 'https://proj.supabase.co';
const ENV: Record<string, string> = { CRON_SECRET: SECRET, SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
const env = (name: string) => ENV[name];

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface World {
  /** Что лежит в exchange_rates. */
  dbRows: unknown[];
  nbt: () => Response;
  api: () => Response;
  dbReadStatus: number;
  dbWriteStatus: number;
}

function makeWorld(over: Partial<World> = {}): World & { fetchImpl: edge.FetchFn; calls: Call[] } {
  const world = {
    dbRows: [] as unknown[],
    nbt: () => new Response(NBT_VALUTE_STYLE, { headers: { 'content-type': 'application/xml; charset=utf-8' } }),
    api: () => new Response(API_WITH_TJS, { headers: { 'content-type': 'application/json' } }),
    dbReadStatus: 200,
    dbWriteStatus: 201,
    ...over,
  };
  const calls: Call[] = [];
  const fetchImpl: edge.FetchFn = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.startsWith(`${BASE}/rest/v1/exchange_rates`)) {
      if (init?.method === 'POST') return new Response(null, { status: world.dbWriteStatus });
      return world.dbReadStatus === 200 ? Response.json(world.dbRows) : new Response('err', { status: world.dbReadStatus });
    }
    if (url === edge.NBT_URL) return world.nbt();
    if (edge.API_MIRRORS.includes(url)) return world.api();
    throw new Error(`неожиданный адрес ${url}`);
  };
  return Object.assign(world, { fetchImpl, calls });
}

const request = (init: { method?: string; auth?: string | null } = {}) => {
  const headers = new Headers();
  if (init.auth !== null) headers.set('authorization', init.auth ?? `Bearer ${SECRET}`);
  return new Request('https://proj.supabase.co/functions/v1/fetch-rates', { method: init.method ?? 'POST', headers });
};

const run = (world: ReturnType<typeof makeWorld>, req: Request = request(), envFn = env) =>
  edge.handler(req, { env: envFn, fetchImpl: world.fetchImpl, now: () => NOW });

const writes = (world: ReturnType<typeof makeWorld>) => world.calls.filter((c) => c.method === 'POST');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('handler: доступ', () => {
  it('без заголовка Authorization → 401, и ни одного обращения наружу', async () => {
    const world = makeWorld();
    const res = await run(world, request({ auth: null }));
    expect(res.status).toBe(401);
    expect(world.calls).toHaveLength(0);
  });

  it.each([
    ['чужой секрет', 'Bearer wrong-secret'],
    ['секрет без Bearer', SECRET],
    ['схема Basic', `Basic ${SECRET}`],
    ['пустой Bearer', 'Bearer '],
    ['только Bearer', 'Bearer'],
    ['секрет с хвостом', `Bearer ${SECRET}x`],
    ['префикс секрета', `Bearer ${SECRET.slice(0, -1)}`],
    ['секрет с пробелом внутри', `Bearer ${SECRET} extra`],
    ['service key вместо секрета', `Bearer ${SERVICE_KEY}`],
  ])('%s → 401, без обращений наружу', async (_n, auth) => {
    const world = makeWorld();
    const res = await run(world, request({ auth }));
    expect(res.status).toBe(401);
    expect(world.calls).toHaveLength(0);
    expect(await res.text()).not.toContain(SECRET);
  });

  it('схема Bearer не чувствительна к регистру', async () => {
    const res = await run(makeWorld(), request({ auth: `bearer ${SECRET}` }));
    expect(res.status).toBe(200);
  });

  it('CRON_SECRET не задан → 500 и отказ всем (даже при пустом Bearer), ничего не выполняется', async () => {
    for (const auth of [null, 'Bearer ', 'Bearer x']) {
      const world = makeWorld();
      const res = await run(world, request({ auth }), (n) => (n === 'CRON_SECRET' ? undefined : ENV[n]));
      expect(res.status).toBe(500);
      expect(world.calls).toHaveLength(0);
    }
    const world = makeWorld();
    expect((await run(world, request({ auth: 'Bearer ' }), (n) => (n === 'CRON_SECRET' ? '' : ENV[n]))).status).toBe(500);
  });

  it('верный секрет, но метод GET/PUT → 405', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const world = makeWorld();
      const res = await run(world, request({ method }));
      expect(res.status).toBe(405);
      expect(world.calls).toHaveLength(0);
    }
  });

  it('нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / URL не http(s) → 500, наружу не ходим', async () => {
    for (const missing of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      const world = makeWorld();
      const res = await run(world, request(), (n) => (n === missing ? undefined : ENV[n]));
      expect(res.status).toBe(500);
      expect(world.calls).toHaveLength(0);
    }
    const world = makeWorld();
    expect((await run(world, request(), (n) => (n === 'SUPABASE_URL' ? 'ftp://x' : ENV[n]))).status).toBe(500);
  });

  it('isAuthorized: пустой секрет не пускает никого', () => {
    expect(edge.isAuthorized('Bearer ', '')).toBe(false);
    expect(edge.isAuthorized('Bearer x', undefined)).toBe(false);
    expect(edge.isAuthorized(null, SECRET)).toBe(false);
    expect(edge.isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });
});

describe('handler: сбор и запись курсов', () => {
  it('успех: НБТ → одна запись upsert в exchange_rates с service-role ключом из окружения', async () => {
    const world = makeWorld();
    const res = await run(world);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, source: 'nbt', asOf: '2026-10-10', pivot: 'TJS', currencies: 7, hasTjs: true, warnings: [], failures: [] });

    expect(writes(world)).toHaveLength(1);
    const post = writes(world)[0] as Call;
    expect(post.url).toBe(`${BASE}/rest/v1/exchange_rates?on_conflict=as_of,source`);
    expect(post.headers['apikey']).toBe(SERVICE_KEY);
    expect(post.headers['authorization']).toBe(`Bearer ${SERVICE_KEY}`);
    expect(post.headers['prefer']).toBe('resolution=merge-duplicates,return=minimal');
    expect(post.headers['content-type']).toBe('application/json');
    const rows = JSON.parse(post.body as string) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      as_of: '2026-10-10',
      source: 'nbt',
      pivot: 'TJS',
      per_unit: clientParseNbt(NBT_VALUTE_STYLE, NOW).perUnit,
      fetched_at: NOW.toISOString(),
    });
  });

  it('строка совпадает с тем, что клиентский serverProvider сможет прочитать (имена и типы колонок схемы)', async () => {
    const world = makeWorld();
    await run(world);
    const row = JSON.parse((writes(world)[0] as Call).body as string)[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['as_of', 'fetched_at', 'per_unit', 'pivot', 'source']);
    expect(row['as_of']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(row['fetched_at'] as string)).not.toBeNaN();
    expect(typeof row['per_unit']).toBe('object');
  });

  it('ответ не содержит ни секрета расписания, ни ключа service_role', async () => {
    const world = makeWorld();
    const res = await run(world);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SERVICE_KEY);
  });

  it('читает прошлую запись до записи новой (для проверки скачка)', async () => {
    const world = makeWorld();
    await run(world);
    expect(world.calls[0]).toMatchObject({ method: 'GET' });
    expect(world.calls[0]?.url).toContain('/rest/v1/exchange_rates?select=as_of,source,pivot,per_unit,fetched_at&order=as_of.desc');
    expect(world.calls[0]?.headers['apikey']).toBe(SERVICE_KEY);
  });

  it('НБТ вернул HTML → запасной currency-api; причина отказа НБТ в ответе', async () => {
    const world = makeWorld({ nbt: () => new Response(NBT_HTML, { headers: { 'content-type': 'text/html' } }) });
    const body = await (await run(world)).json();
    expect(body).toMatchObject({ ok: true, source: 'api', pivot: 'TJS', hasTjs: true });
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]).toMatchObject({ source: 'nbt' });
    expect(body.failures[0].message).toMatch(/HTML/);
    const row = JSON.parse((writes(world)[0] as Call).body as string)[0];
    expect(row).toMatchObject({ source: 'api', pivot: 'TJS' });
    expect(row.per_unit.USD).toBe(9.2);
  });

  it('НБТ недоступен (HTTP 503 / обрыв) → запасной; первое зеркало упало → второе', async () => {
    const world = makeWorld({ nbt: () => new Response('x', { status: 503 }) });
    const mirrorCalls: string[] = [];
    const inner = world.fetchImpl;
    const fetchImpl: edge.FetchFn = async (url, init) => {
      if (edge.API_MIRRORS.includes(url)) {
        mirrorCalls.push(url);
        if (url === edge.API_MIRRORS[0]) throw new TypeError('fetch failed');
      }
      return inner(url, init);
    };
    const res = await edge.handler(request(), { env, fetchImpl, now: () => NOW });
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('api');
    expect(mirrorCalls).toEqual([...edge.API_MIRRORS]);
  });

  it('currency-api без tjs: записывается с pivot USD, hasTjs=false и предупреждением', async () => {
    const world = makeWorld({
      nbt: () => new Response(NBT_HTML),
      api: () => new Response(API_WITHOUT_TJS),
    });
    const body = await (await run(world)).json();
    expect(body).toMatchObject({ ok: true, source: 'api', pivot: 'USD', hasTjs: false });
    expect(body.warnings.join(' ')).toContain('нет tjs');
  });

  it('НБТ с датой из будущего отвергнут → запасной вариант', async () => {
    const world = makeWorld({ nbt: () => new Response(NBT_FUTURE) });
    const body = await (await run(world)).json();
    expect(body.source).toBe('api');
    expect(body.failures[0].message).toMatch(/из будущего/);
  });

  it('скачок >50% к прошлой записи в базе: НБТ отвергнут, берётся запасной, если он согласуется', async () => {
    const world = makeWorld({
      // в базе USD = 9.0 (как у api: 9.2), а НБТ внезапно прислал 10.95 → +21%: ещё норма; поэтому занижаем «прошлое» до 5
      dbRows: [{ as_of: '2026-10-09', source: 'nbt', pivot: 'TJS', per_unit: { TJS: 1, USD: 9.0, EUR: 10, RUB: 0.0963 }, fetched_at: '2026-10-09T05:00:00+00:00' }],
      nbt: () => new Response(NBT_VALUTE_STYLE.replace('10,9500', '20,0000')),
    });
    const body = await (await run(world)).json();
    expect(body.source).toBe('api');
    expect(body.failures[0]).toMatchObject({ source: 'nbt' });
    expect(body.failures[0].message).toContain('USD: 9 → 20 (+122%)');
  });

  it('оба источника дают скачок → 502, в базу НИЧЕГО не пишется', async () => {
    const world = makeWorld({
      dbRows: [{ as_of: '2026-10-09', source: 'nbt', pivot: 'TJS', per_unit: { TJS: 1, USD: 3, EUR: 4 }, fetched_at: '2026-10-09T05:00:00+00:00' }],
    });
    const res = await run(world);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: 'no_valid_rates' });
    expect(body.failures.map((f: { source: string }) => f.source)).toEqual(['nbt', 'api']);
    expect(writes(world)).toHaveLength(0);
  });

  it('оба источника недоступны → 502, записи нет, секреты в сообщениях замазаны', async () => {
    const world = makeWorld({
      nbt: () => {
        throw new Error(`connect ECONNREFUSED (key=${SERVICE_KEY})`);
      },
      api: () => new Response('nope', { status: 500 }),
    });
    const res = await run(world);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(SERVICE_KEY);
    expect(text).toContain('***');
    expect(writes(world)).toHaveLength(0);
  });

  it('прошлую запись не удалось прочитать → 502 и запись «вслепую» не делается', async () => {
    const world = makeWorld({ dbReadStatus: 500 });
    const res = await run(world);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('db_read_failed');
    expect(world.calls.every((c) => c.url.startsWith(BASE))).toBe(true); // даже к НБТ не ходили
    expect(writes(world)).toHaveLength(0);
  });

  it('база отказала в записи (например, неверный ключ) → 502 db_write_failed', async () => {
    const world = makeWorld({ dbWriteStatus: 401 });
    const res = await run(world);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('db_write_failed');
  });

  it('битые строки в базе пропускаются при поиске «прошлой» записи; пустая база — первый запуск', async () => {
    const world = makeWorld({ dbRows: [{ junk: true }, null, { as_of: 'x' }] });
    expect((await run(world)).status).toBe(200);
  });

  it('повторный запуск за тот же день безопасен: тот же запрос upsert с теми же данными', async () => {
    const first = makeWorld();
    const second = makeWorld();
    await run(first);
    await run(second);
    expect(writes(first)[0]?.body).toBe(writes(second)[0]?.body);
    expect(writes(first)[0]?.url).toContain('on_conflict=as_of,source');
  });

  it('адрес НБТ можно переопределить переменной NBT_URL без правки кода', async () => {
    const custom = 'https://example.test/nbt.xml';
    const world = makeWorld();
    const inner = world.fetchImpl;
    const seen: string[] = [];
    const fetchImpl: edge.FetchFn = async (url, init) => {
      seen.push(url);
      return url === custom ? new Response(NBT_VALUTE_STYLE) : inner(url, init);
    };
    const res = await edge.handler(request(), { env: (n) => (n === 'NBT_URL' ? custom : ENV[n]), fetchImpl, now: () => NOW });
    expect(res.status).toBe(200);
    expect(seen).toContain(custom);
  });

  it('SUPABASE_URL с хвостовым слэшем не ломает адреса', async () => {
    const world = makeWorld();
    const res = await run(world, request(), (n) => (n === 'SUPABASE_URL' ? `${BASE}/` : ENV[n]));
    expect(res.status).toBe(200);
  });
});
