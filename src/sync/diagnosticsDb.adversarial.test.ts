// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeCategory, makeUserId, makeWallet } from '../../tests/sync/factories';
import { createPgliteServer, type PgliteServer } from '../../tests/sync/pglite';
import { toWire } from './tables';
import { overallStatus, runCloudCheck, type CheckStep, type CheckStepId, type CloudClientLike, type CloudQuery, type CloudQueryResult } from './diagnostics';

/**
 * Состязательные проверки «Проверки облака» против настоящего supabase/schema.sql в PGlite.
 * Клиент здесь НАПРЯМУЮ ходит в SQL (без эмулятора PostgREST и без его прокладок): select ... [order by] limit n и
 * insert ... on conflict (id) do update — ровно то, что отправляет проверка. Ошибки Postgres превращаются в {code, message, status}
 * так же, как это делает PostgREST.
 */

const ME = makeUserId();
const NEIGHBOUR = makeUserId();

let pg: PgliteServer;
beforeAll(async () => {
  pg = await createPgliteServer();
}, 120_000);
afterAll(async () => {
  await pg.close();
});
afterEach(async () => {
  // вернуть схему и очистить данные
  for (const stmt of [
    'alter table public.wallets enable row level security',
    'alter table public.categories enable row level security',
    'alter table public.transactions enable row level security',
    'alter table public.settings enable row level security',
    'grant select, insert, update on table public.settings, public.wallets, public.categories, public.transactions to authenticated',
  ]) {
    await pg.db.exec(stmt);
  }
  await pg.applySchema();
  await pg.db.exec('delete from public.exchange_rates');
  for (const t of ['transactions', 'categories', 'wallets', 'settings']) await pg.db.exec(`delete from public.${t}`);
});

function asQuery(run: () => Promise<CloudQueryResult>): CloudQuery {
  const q = {
    retry: () => q,
    then: (a?: (v: CloudQueryResult) => unknown, b?: (e: unknown) => unknown) => run().then(a, b),
  };
  return q as unknown as CloudQuery;
}

function failure(e: unknown): CloudQueryResult {
  const code = (e as { code?: string }).code ?? '';
  const message = e instanceof Error ? e.message : String(e);
  const status = code === '42501' ? 403 : code === '42P01' ? 404 : 400;
  return { data: null, error: { code: code === '42P01' ? 'PGRST205' : code, message }, status };
}

function pgClient(sub: string): CloudClientLike {
  const actor = { role: 'authenticated' as const, sub };
  /** select ... [order by] limit n: ровно то, что отправляет проверка (порядок — только если запросили). */
  const selectQuery = (table: string, columns: string, n: number, order?: { column: string; ascending: boolean }): CloudQuery =>
    asQuery(async () => {
      try {
        const by = order ? ` order by ${order.column} ${order.ascending ? 'asc' : 'desc'}` : '';
        // to_jsonb: даты и числа приходят так же, как от PostgREST (строки ISO), а не объектами драйвера
        const r = await pg.as(actor, (tx) =>
          tx.query<{ j: unknown }>(`select to_jsonb(s) as j from (select ${columns} from public.${table}${by} limit ${Number(n)}) s`),
        );
        return { data: r.rows.map((x) => x.j), error: null, status: 200 };
      } catch (e) {
        return failure(e);
      }
    });
  return {
    from: (table) => ({
      select: (columns) => ({
        limit: (n) => selectQuery(table, columns, n),
        order: (column, options) => ({ limit: (n) => selectQuery(table, columns, n, { column, ascending: options?.ascending ?? true }) }),
      }),
      // upsert = insert ... on conflict (id) do update, как у настоящей синхронизации (PostgREST: Prefer resolution=merge-duplicates)
      upsert: (row) =>
        asQuery(async () => {
          try {
            const cols = Object.keys(row).map((c) => `"${c}"`);
            const updates = cols.filter((c) => c !== '"id"').map((c) => `${c} = excluded.${c}`).join(', ');
            await pg.as(actor, (tx) =>
              tx.query(
                `insert into public.${table} (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) on conflict (id) do update set ${updates}`,
                [JSON.stringify([row])],
              ),
            );
            return { data: null, error: null, status: 201 };
          } catch (e) {
            return failure(e);
          }
        }),
    }),
    auth: { getSession: async () => ({ data: { session: { user: { id: sub } } }, error: null }) },
  };
}

async function run(extra: { everSynced?: boolean } = {}) {
  const steps = await runCloudCheck(pgClient(ME), { userId: ME, url: 'https://abcdefgh.supabase.co', hasSession: true, pending: 0, quarantined: 0, ...extra }, { timeoutMs: 5000 });
  return { steps, by: Object.fromEntries(steps.map((s) => [s.id, s])) as Record<CheckStepId, CheckStep> };
}

const addRates = (days: number) =>
  pg.db.exec(
    Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 26 + i)).toISOString().slice(0, 10);
      return `insert into public.exchange_rates (as_of, source, pivot, per_unit, fetched_at) values ('${d}', 'nbt', 'TJS', '{"USD": 10.9}', now());`;
    }).join('\n'),
  );

describe('diag: здоровая база (контроль — чтобы атаки ниже не были ложными)', () => {
  it('на целой схеме и при 3 курсах всё ok', async () => {
    await addRates(3);
    const { steps } = await run();
    expect(overallStatus(steps)).toBe('ok');
  });
});

// Политику UPDATE (если её одну удалили, а права остались) без правки настоящих данных не проверить: подробности в README
// («Что проверка не умеет»). Права на вставку и обновление (grant) проверка видит: она шлёт тот же upsert, что и синхронизация.
describe('diag: шаг «Запись» повторяет настоящую отправку: upsert (insert ... on conflict do update) во все четыре таблицы', () => {
  it('нет права UPDATE у authenticated: настоящая отправка отвергается (42501), а проверка пишет «Запись разрешена»', async () => {
    await addRates(3);
    await pg.db.exec('revoke update on public.categories, public.wallets, public.transactions, public.settings from authenticated');
    // настоящий путь синхронизации (PgliteTransport.push = insert ... on conflict (id) do update, как у supabase-js upsert)
    await expect(pg.transportFor(ME).push('categories', [toWire('categories', makeCategory({ name: 'Еда' }))])).rejects.toMatchObject({ kind: 'rejected', code: '42501' });
    const { steps, by } = await run();
    // проверка обязана заметить, что отправка работать не будет
    expect(by.write.status, `write: ${by.write.message}`).not.toBe('ok');
    expect(overallStatus(steps)).not.toBe('ok');
  });

  it('у таблицы transactions нет права INSERT, а у categories есть: проверка пишет только в categories и говорит «ok»', async () => {
    await addRates(3);
    await pg.db.exec('revoke insert on public.transactions from authenticated');
    const w = makeWallet();
    await pg.transportFor(ME).push('wallets', [toWire('wallets', w)]);
    const { steps } = await run();
    expect(overallStatus(steps), steps.map((s) => `${s.id}:${s.status}`).join(' ')).not.toBe('ok');
  });
});

describe('diag: шаг «Курсы» — «последняя дата» берётся из выборки БЕЗ order by', () => {
  it('15 дней курсов: проверка называет датой последнего курса НЕ последний день', async () => {
    await addRates(15); // 2026-09-26 .. 2026-10-10
    const { by } = await run();
    expect(by.rates.status).toBe('ok');
    // правда: последний курс за 2026-10-10 (приложение читает order by as_of desc, см. src/rates/server.ts)
    expect(by.rates.message, by.rates.message).toContain('последняя дата 2026-10-10');
  });
});

// Защиту строк (RLS) одинокий пользователь проверить не может: при включённой защите он не видит чужого, и при выключенной тоже
// (других пользователей с данными ещё нет). Поэтому «итог не ok» для этого случая невозможен без ложных тревог на здоровой базе
// (см. контроль выше). Честная проверка: не обещать защиту словами и ловить утечку, когда чужие данные есть.
describe('diag: «Чтение данных» и защита строк (RLS)', () => {
  it('RLS выключена, в базе один пользователь: от здоровой базы не отличить — проверка не обещает защиту и говорит, как проверить', async () => {
    await addRates(3);
    await pg.transportFor(ME).push('wallets', [toWire('wallets', makeWallet())]);
    for (const t of ['settings', 'wallets', 'categories', 'transactions']) await pg.db.exec(`alter table public.${t} disable row level security`);
    // доказательство, что защиты нет: второй пользователь видит чужое
    await pg.addUser(NEIGHBOUR);
    const seen = await pg.as({ role: 'authenticated', sub: NEIGHBOUR }, (tx) => tx.query('select id from public.wallets'));
    expect(seen.rows.length).toBeGreaterThan(0);
    const { by } = await run();
    expect(by.read.message).toMatch(/подтвердить не может/);
    expect(by.read.message).toContain('README');
    expect(by.read.message, 'нельзя писать «защита работает», когда это не доказано').not.toMatch(/защита (строк )?(работает|включена)/i);
  });

  it('RLS выключена и у соседа есть данные: чужое видно, проверка поднимает тревогу', async () => {
    await addRates(3);
    await pg.transportFor(NEIGHBOUR).push('wallets', [toWire('wallets', makeWallet({ name: 'Чужой кошелёк' }))]);
    for (const t of ['settings', 'wallets', 'categories', 'transactions']) await pg.db.exec(`alter table public.${t} disable row level security`);
    const { steps, by } = await run();
    expect(by.read.status).toBe('fail');
    expect(by.read.message).toContain('ОПАСНО');
    expect(overallStatus(steps)).toBe('fail');
  });
});

describe('diag: таблица есть, но колонок синхронизации нет (старая/чужая схема)', () => {
  it('нет server_seq в wallets: настоящая загрузка (pull) падает, а проверка — «ok»', async () => {
    await addRates(3);
    // без триггера: он пишет в new.server_seq
    await pg.db.exec('drop trigger sync_guard on public.wallets');
    await pg.db.exec('alter table public.wallets drop column server_seq cascade');
    try {
      await expect(pg.transportFor(ME).pull('wallets', 0, 100)).rejects.toBeDefined();
      const { steps } = await run();
      expect(overallStatus(steps), steps.map((s) => `${s.id}:${s.status}`).join(' ')).not.toBe('ok');
    } finally {
      await pg.db.exec('alter table public.wallets add column server_seq bigint not null default 0');
    }
  });
});
