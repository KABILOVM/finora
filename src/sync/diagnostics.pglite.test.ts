// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeCategory, makeUserId, makeWallet } from '../../tests/sync/factories';
import { createPgliteServer, type PgliteServer } from '../../tests/sync/pglite';
import { createPostgrestEmulator, makeJwt, type PostgrestEmulator } from '../../tests/sync/postgrestEmulator';
import { toWire } from './tables';
import { overallStatus, runCloudCheck, type CheckStep, type CheckStepId, type CloudClientLike } from './diagnostics';

/**
 * «Проверка облака» против НАСТОЯЩЕГО supabase/schema.sql на PGlite: настоящий построитель запросов supabase-js,
 * эмулятор PostgREST и настоящие ограничения, права и политики. Здесь видно, что коды ошибок, на которые опирается
 * проверка (23514, 42501, PGRST205 и т. д.), действительно приходят именно так.
 * Живой Supabase это не заменяет: в нём проверка и нужна.
 */

const ANON_KEY = makeJwt({ role: 'anon' });
const ME = makeUserId();
const NEIGHBOUR = makeUserId();

let pg: PgliteServer;
let emu: PostgrestEmulator;
beforeAll(async () => {
  pg = await createPgliteServer();
  emu = createPostgrestEmulator(pg);
}, 120_000);
afterAll(async () => {
  await pg.close();
});
// Все сценарии портят схему по-своему; перед каждым возвращаем её к настоящей (файл рассчитан на повторное выполнение).
afterEach(async () => {
  await pg.db.exec('drop policy if exists leak_all on public.wallets');
  await pg.applySchema();
  emu.log.length = 0;
});

interface Setup {
  server?: PgliteServer;
  emulator?: PostgrestEmulator;
  /** Чей вход: null — входа нет. */
  sub?: string | null;
  token?: string | null;
  /** Подменить ответ сервера целиком (например, веб-страница вместо PostgREST). */
  respond?: () => Response | null;
}

/** Курсы валют эмулятор не знает: отвечаем из настоящей таблицы теми же правами; select=список колонок эмулятору переписываем на «*». */
function adapt(server: PgliteServer, emulator: PostgrestEmulator, sub: string | null, respond?: Setup['respond']): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const forced = respond?.();
    if (forced) return forced;
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/rest/v1/exchange_rates') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      try {
        const res = await server.as({ role: sub ? 'authenticated' : 'anon', sub }, (tx) =>
          tx.query<{ j: unknown }>(`select to_jsonb(t) as j from public.exchange_rates t order by t.as_of desc limit ${limit}`),
        );
        return new Response(JSON.stringify(res.rows.map((r) => r.j)), { status: 200, headers: { 'content-type': 'application/json' } });
      } catch (e) {
        const code = (e as { code?: string }).code ?? 'XX000';
        const body = code === '42P01' ? { code: 'PGRST205', message: "Could not find the table 'public.exchange_rates' in the schema cache" } : { code, message: String((e as Error).message) };
        return new Response(JSON.stringify(body), { status: code === '42P01' ? 404 : code === '42501' ? (sub ? 403 : 401) : 400 });
      }
    }
    if (req.method === 'GET' && (url.searchParams.get('select') ?? '*') !== '*') {
      url.searchParams.set('select', '*');
      return emulator.fetch(url.toString(), { method: 'GET', headers: req.headers, signal: req.signal });
    }
    return emulator.fetch(req);
  }) as typeof fetch;
}

function cloud(o: Setup = {}): CloudClientLike {
  const server = o.server ?? pg;
  const emulator = o.emulator ?? emu;
  const sub = o.sub === undefined ? ME : o.sub;
  const token = o.token === undefined ? (sub ? makeJwt({ sub }) : null) : o.token;
  const real = createClient(emulator.url, ANON_KEY, {
    global: { fetch: adapt(server, emulator, sub, o.respond) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });
  // Сессия входа (GoTrue) в тестах не нужна: подставляем то, что вернул бы getSession().
  return {
    from: (table) => real.from(table),
    auth: { getSession: async () => ({ data: { session: sub ? { user: { id: sub } } : null }, error: null }) },
  };
}

async function run(o: Setup = {}, ctx: { hasSession?: boolean; everSynced?: boolean; pending?: number } = {}) {
  const steps = await runCloudCheck(
    cloud(o),
    { userId: ME, url: 'https://abcdefgh.supabase.co', hasSession: true, pending: 0, quarantined: 0, ...ctx },
    { timeoutMs: 5000 },
  );
  return { steps, by: Object.fromEntries(steps.map((s) => [s.id, s])) as Record<CheckStepId, CheckStep> };
}

const count = async (server: PgliteServer, table: 'categories' | 'wallets') => (await server.adminRows(table)).length;

describe('Проверка облака на настоящей схеме', () => {
  it('чистый проект с применённой схемой: всё в порядке, курсов пока нет (замечание); в базу ничего не попало', async () => {
    const { steps, by } = await run();
    expect(steps.map((s) => s.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'warn', 'ok']);
    expect(by.write.message).toContain('защита данных работает');
    expect(by.rates.message).toContain('fetch-rates');
    expect(overallStatus(steps)).toBe('warn');
    expect(await count(pg, 'categories')).toBe(0); // проверка записи ничего не записала
    expect(await count(pg, 'wallets')).toBe(0);
    expect((await pg.adminRows('settings')).length).toBe(0);
    expect((await pg.adminRows('transactions')).length).toBe(0);
  });

  it('есть курсы на сервере: шаг «ok» с датой', async () => {
    await pg.db.exec(`insert into public.exchange_rates (as_of, source, pivot, per_unit, fetched_at)
      values ('2026-10-09', 'nbt', 'TJS', '{"USD": 10.9}', now()), ('2026-10-10', 'nbt', 'TJS', '{"USD": 10.95}', now())`);
    const { by, steps } = await run();
    expect(by.rates.status).toBe('ok');
    expect(by.rates.message).toContain('2026-10-10');
    expect(overallStatus(steps)).toBe('ok');
    await pg.db.exec('delete from public.exchange_rates');
  });

  it('у соседа есть данные: свои видны, чужие — нет (настоящие политики RLS)', async () => {
    await pg.transportFor(NEIGHBOUR).push('wallets', [toWire('wallets', makeWallet({ name: 'Чужой кошелёк' }))]);
    await pg.transportFor(ME).push('wallets', [toWire('wallets', makeWallet({ name: 'Мой кошелёк' }))]);
    const { by } = await run();
    expect(by.read.status).toBe('ok');
    expect(by.read.message).toContain('чужих записей не видно');
    // а если политику испортить, проверка обязана поднять тревогу
    await pg.db.exec('create policy leak_all on public.wallets for select to authenticated using (true)');
    const broken = await run();
    expect(broken.by.read.status).toBe('fail');
    expect(broken.by.read.message).toContain('ОПАСНО');
    expect(broken.by.read.message).toContain('wallets');
  });

  it('входа нет: сервер достижим, вход — ошибка, дальше пропущено; запись не отправлялась', async () => {
    const { by } = await run({ sub: null });
    expect(by.server.status).toBe('ok'); // аноним получил 401/42501 — значит сервер ответил
    expect(by.session.status).toBe('fail');
    expect(by.schema.status).toBe('skip');
    expect(emu.log.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('просроченный токен (PGRST301): «сессия просрочена»', async () => {
    const { by } = await run({ token: makeJwt({ sub: ME, exp: 1 }) });
    expect(by.session.status).toBe('fail');
    expect(by.session.message).toContain('просрочена');
  });

  it('у роли authenticated отобрали право записи: «Нет прав записи» (42501)', async () => {
    await pg.db.exec('revoke insert on public.categories from authenticated');
    const { by } = await run();
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('Нет прав записи');
  });

  it('отобрали право обновления (вставка есть): настоящий upsert из supabase-js отвергнут, проверка называет все таблицы', async () => {
    await pg.db.exec('revoke update on public.settings, public.wallets, public.categories, public.transactions from authenticated');
    const { by } = await run();
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('Нет прав записи');
    for (const t of ['settings', 'wallets', 'categories', 'transactions']) expect(by.write.message).toContain(t);
  });

  it('у роли authenticated отобрали право чтения transactions: «Нет прав на чтение»', async () => {
    await pg.db.exec('revoke select on public.transactions from authenticated');
    const { by } = await run();
    expect(by.schema.status).toBe('ok'); // таблица на месте
    expect(by.read.status).toBe('fail');
    expect(by.read.message).toContain('transactions');
  });

  it('удалена политика вставки: запись отклонена политикой (42501), а не ограничением', async () => {
    await pg.db.exec('drop policy categories_insert_own on public.categories');
    const { by } = await run();
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('Нет прав записи');
  });

  it('нет таблицы курсов: схема — ошибка с точной подсказкой, курсы пропущены, остальное работает', async () => {
    await pg.db.exec('drop table public.exchange_rates');
    const { by } = await run();
    expect(by.schema.status).toBe('fail');
    expect(by.schema.message).toContain('Выполните файл supabase/schema.sql в SQL Editor вашего проекта Finora');
    expect(by.schema.message).toContain('exchange_rates');
    expect(by.rates.status).toBe('skip');
    expect(by.write.status).toBe('ok');
  });

  it('обрыв сети и ошибки шлюза настоящего supabase-js распознаются', async () => {
    emu.failNetwork(1);
    expect((await run()).by.server.message).toContain('Нет связи');
    emu.failHttp(503, { message: 'upstream unavailable' });
    expect((await run()).by.server.message).toContain('503');
    emu.failHttp(401, { message: 'Invalid API key' });
    expect((await run()).by.server.message).toContain('VITE_SUPABASE_ANON_KEY');
    const page = await run({ respond: () => new Response('<!DOCTYPE html><title>Hosting</title>', { status: 200 }) });
    expect(page.by.server.message).toContain('веб-страница');
  });

  it('схема не применена вовсе (пустой проект): «Выполните файл supabase/schema.sql…», запись не пробуем', async () => {
    const empty = await createPgliteServer();
    try {
      for (const t of ['transactions', 'categories', 'wallets', 'settings', 'exchange_rates']) await empty.db.exec(`drop table public.${t} cascade`);
      const { by, steps } = await run({ server: empty, emulator: createPostgrestEmulator(empty) });
      expect(by.server.status).toBe('ok');
      expect(by.schema.status).toBe('fail');
      expect(by.schema.message).toContain('Выполните файл supabase/schema.sql в SQL Editor вашего проекта Finora');
      expect(by.schema.message).toContain('settings, wallets, categories, transactions, exchange_rates');
      expect(['read', 'write', 'rates'].map((id) => by[id as CheckStepId].status)).toEqual(['skip', 'skip', 'skip']);
      expect(steps).toHaveLength(7);
    } finally {
      await empty.close();
    }
  }, 120_000);

  it('если в базе пропало ограничение на пустое имя, вставка пройдёт: проверка скажет «создала лишнюю строку», а строка не видна приложению', async () => {
    const weak = await createPgliteServer();
    try {
      await weak.db.exec('alter table public.categories drop constraint categories_name_len');
      const { by } = await run({ server: weak, emulator: createPostgrestEmulator(weak) });
      expect(by.write.status).toBe('fail');
      expect(by.write.message).toContain('Проверка создала лишнюю строку');
      const left = await weak.adminRows('categories');
      expect(left).toHaveLength(1);
      expect(by.write.message).toContain(String(left[0]?.['id']));
      expect(left[0]?.['deleted_at']).not.toBeNull(); // помечена удалённой
      expect(left[0]?.['user_id']).toBe(ME); // пользователя поставил сервер
    } finally {
      await weak.close();
    }
  }, 120_000);

  it('одна и та же проверка, запущенная несколько раз подряд, ничего не накапливает', async () => {
    for (let i = 0; i < 3; i++) await run();
    expect(await count(pg, 'categories')).toBe(0);
    await pg.transportFor(ME).push('categories', [toWire('categories', makeCategory({ name: 'Еда' }))]);
    await run();
    expect(await count(pg, 'categories')).toBe(1); // чужих строк не прибавилось, свои не тронуты
  });
});
