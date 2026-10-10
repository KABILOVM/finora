import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECK_TIMEOUT_MS, overallStatus, runCloudCheck, type CheckStepId, type CloudClientLike } from './diagnostics';
import { HOST, NETWORK, NO_TABLE, DENIED, U, OTHER_USER, check, ctxOf, fail, fakeCloud, rows } from './__fixtures__/diagKit';

const ORDER: CheckStepId[] = ['server', 'session', 'schema', 'read', 'write', 'rates', 'local'];
const DEPENDENT: CheckStepId[] = ['session', 'schema', 'read', 'write', 'rates'];

afterEach(() => {
  vi.useRealTimers();
});

describe('Проверка облака: всё в порядке', () => {
  it('семь шагов по порядку, все «ok», итог «ok»', async () => {
    const { steps } = await check();
    expect(steps.map((s) => s.id)).toEqual(ORDER);
    expect(steps.map((s) => s.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(overallStatus(steps)).toBe('ok');
    for (const s of steps) {
      expect(s.title).not.toBe('');
      expect(s.message).toMatch(/[а-яё]/i); // сообщения по-русски
    }
  });

  it('каждая таблица читается один раз, повторы запроса выключены, в каждую из четырёх таблиц пишется одна заведомо неверная строка', async () => {
    const { calls } = await check();
    expect(calls.selects.map((s) => s.table).sort()).toEqual(['categories', 'exchange_rates', 'settings', 'transactions', 'wallets']);
    expect(calls.retriesOff).toBe(5);
    expect(calls.selects.every((s) => s.limit > 0 && s.limit <= 50)).toBe(true);
    expect(calls.upserts.map((u) => u.table).sort()).toEqual(['categories', 'settings', 'transactions', 'wallets']);
    for (const u of calls.upserts) {
      expect(u.row).toMatchObject({ id: 'probe-id-1', device_id: 'cloud-check' });
      expect(u.row['deleted_at']).toEqual(expect.any(String)); // даже если строка пройдёт, в приложении её не видно
      expect(u.row).not.toHaveProperty('user_id'); // пользователя ставит сервер
      expect(u.row).not.toHaveProperty('server_seq');
    }
    const by = (t: string) => calls.upserts.find((u) => u.table === t)?.row;
    expect(by('categories')).toMatchObject({ name: '' });
    expect(by('wallets')).toMatchObject({ name: '' });
    expect(by('transactions')).toMatchObject({ amount_minor: 0 });
  });
});

describe('Шаг «Связь с сервером»', () => {
  it('нет сети (статус 0): понятный совет, остальные шаги пропущены, на сервер больше не ходим', async () => {
    const { by, steps, calls } = await check({ tables: { settings: NETWORK } });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain(HOST);
    expect(by.server.message).toContain('VITE_SUPABASE_URL');
    for (const id of DEPENDENT) {
      expect(by[id].status).toBe('skip');
      expect(by[id].message).toMatch(/^Пропущено:/);
    }
    expect(by.local.status).toBe('ok'); // локальные данные показываем всегда
    expect(steps).toHaveLength(7);
    expect(calls.selects).toHaveLength(1);
    expect(calls.upserts).toHaveLength(0);
  });

  it('у устройства нет интернета: говорит об этом прямо', async () => {
    const { by } = await check({ tables: { settings: NETWORK } }, { online: false });
    expect(by.server.message).toContain('нет интернета');
  });

  it('клиент бросил исключение сети — то же самое, без падения', async () => {
    const { by } = await check({ tables: { settings: { throws: new TypeError('Failed to fetch') } } });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('Нет связи');
  });

  it('клиент бросил неожиданное исключение — «ошибка», а не «сервер отвечает»', async () => {
    const { by } = await check({ tables: { settings: { throws: new Error('внутренний сбой') } } });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('внутренний сбой');
  });

  it('сервер молчит дольше предела: «не ответил», шаги ниже пропущены', async () => {
    const t0 = Date.now();
    const { by } = await check({ tables: { settings: 'hang' } }, {}, { timeoutMs: 30 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('не ответил');
    expect(DEPENDENT.every((id) => by[id].status === 'skip')).toBe(true);
  });

  it('предел шага по умолчанию — 10 секунд (ровно)', async () => {
    expect(CHECK_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers();
    const { client } = fakeCloud({ tables: { settings: 'hang' } });
    let done = false;
    const run = runCloudCheck(client, ctxOf()).then((s) => {
      done = true;
      return s;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const steps = await run;
    expect(steps[0]).toMatchObject({ id: 'server', status: 'fail' });
    expect(steps[0]?.message).toContain('10 с');
  });

  it.each([
    ['Invalid API key', 401],
    ['No API key found in request', 401],
  ])('сервер отвечает, но ключ не принят («%s»): просит проверить VITE_SUPABASE_ANON_KEY', async (message, status) => {
    const { by } = await check({ tables: { settings: fail('', message, status) } });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('VITE_SUPABASE_ANON_KEY');
    expect(by.server.message).toContain('service_role');
  });

  it('по адресу отвечает веб-страница, а не Supabase', async () => {
    const { by } = await check({ tables: { settings: fail('', '<!DOCTYPE html><html>...', 200) } });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('не база Supabase');
    expect(by.server.message).toContain('веб-страница');
  });

  it('пустой ответ вместо списка и «неверный путь» (адрес с /rest/v1) — тоже не Supabase', async () => {
    for (const reply of [{ data: null, error: null, status: 204 }, fail('PGRST125', 'Invalid path specified in request URL', 404)]) {
      const { by } = await check({ tables: { settings: reply } });
      expect(by.server.status).toBe('fail');
      expect(by.server.message).toContain('/rest/v1');
    }
  });

  it('сервер ответил ошибкой 5xx: подсказка про приостановленный проект', async () => {
    const { by } = await check({ tables: { settings: fail('PGRST002', 'Could not query the database for the schema cache', 503) } });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('503');
    expect(by.server.message).toContain('Restore project');
  });

  it('лимит запросов (429 без кода) — «неожиданный ответ», а не «всё хорошо»', async () => {
    const { by } = await check({ tables: { settings: fail('', 'API rate limit exceeded', 429) } });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('API rate limit exceeded');
  });

  it('отказ в правах без входа (42501) — сервер всё же достижим', async () => {
    const { by } = await check({ tables: { settings: fail('42501', 'permission denied', 401) }, session: null }, { hasSession: false });
    expect(by.server.status).toBe('ok');
  });
});

describe('Шаг «Вход в аккаунт»', () => {
  it('входа нет: ошибка с советом, ниже всё пропущено, запись не пробовали', async () => {
    const { by, calls } = await check({ session: null });
    expect(by.session.status).toBe('fail');
    expect(by.session.message).toContain('Сессия закончилась');
    expect(by.session.message).toContain('«Выйти»');
    for (const id of ['schema', 'read', 'write', 'rates'] as const) expect(by[id].status).toBe('skip');
    expect(calls.upserts).toHaveLength(0);
    expect(calls.selects).toHaveLength(1);
  });

  it('приложение не подтверждало вход и сессии нет: «Вход не выполнен»', async () => {
    const { by } = await check({ session: null }, { hasSession: false });
    expect(by.session.message).toContain('Вход не выполнен');
  });

  it('сессия другого пользователя — ошибка', async () => {
    const { by } = await check({ session: { user: { id: OTHER_USER } } });
    expect(by.session.status).toBe('fail');
    expect(by.session.message).toContain('другому пользователю');
    expect(by.schema.status).toBe('skip');
  });

  it('id пользователя в сессии не строка — как будто сессии нет', async () => {
    const { by } = await check({ session: { user: { id: 42 } } });
    expect(by.session.status).toBe('fail');
  });

  it.each([
    ['ошибка чтения входа', { error: 'storage broken' }, 'storage broken'],
    ['исключение при чтении входа', { throws: new Error('boom') }, 'boom'],
  ])('%s: ошибка с советом', async (_name, session, text) => {
    const { by } = await check({ session });
    expect(by.session.status).toBe('fail');
    expect(by.session.message).toContain(text);
    expect(by.session.message).toContain('войдите снова');
  });

  it('проверка входа зависла: «не смогло проверить вход»', async () => {
    const { by } = await check({ session: 'hang' }, {}, { timeoutMs: 30 });
    expect(by.session.status).toBe('fail');
    expect(by.session.message).toContain('не смогло проверить вход');
  });

  it('приложение ещё не подтвердило вход, но сессия верная: замечание, остальные шаги идут дальше', async () => {
    const { by, steps } = await check({}, { hasSession: false });
    expect(by.session.status).toBe('warn');
    expect(by.session.message).toContain('откройте заново');
    expect(by.schema.status).toBe('ok');
    expect(by.write.status).toBe('ok');
    expect(overallStatus(steps)).toBe('warn');
  });

  it('сервер не принимает токен (PGRST301): «сессия просрочена», запись не пробуем', async () => {
    const { by, calls } = await check({ tables: { settings: fail('PGRST301', 'JWT expired', 401) } });
    expect(by.server.status).toBe('ok');
    expect(by.session.status).toBe('fail');
    expect(by.session.message).toContain('просрочена');
    expect(calls.upserts).toHaveLength(0);
  });
});

describe('Шаг «Таблицы в базе»', () => {
  it('схема не применена: точная подсказка и список недостающих таблиц; остальные шаги работают по тому, что есть', async () => {
    const { by, calls } = await check({ tables: { wallets: NO_TABLE, exchange_rates: fail('42P01', 'relation "exchange_rates" does not exist', 404) } });
    expect(by.schema.status).toBe('fail');
    expect(by.schema.message).toContain('Выполните файл supabase/schema.sql в SQL Editor вашего проекта Finora');
    expect(by.schema.message).toContain('wallets, exchange_rates');
    expect(by.read.status).toBe('ok'); // wallets не считаем, остальные читаются
    expect(by.write.status).toBe('ok');
    expect(by.rates.status).toBe('skip');
    expect(calls.upserts.map((u) => u.table).sort()).toEqual(['categories', 'settings', 'transactions']); // в отсутствующую wallets не пишем
  });

  it('нет таблицы categories: в неё ничего не отправляется, в остальные — как обычно', async () => {
    const { by, calls } = await check({ tables: { categories: NO_TABLE } });
    expect(by.schema.status).toBe('fail');
    expect(by.write.status).toBe('ok');
    expect(calls.upserts.map((u) => u.table).sort()).toEqual(['settings', 'transactions', 'wallets']);
  });

  it('нет ни одной таблицы пользователя: чтение пропущено', async () => {
    const none = { settings: NO_TABLE, wallets: NO_TABLE, categories: NO_TABLE, transactions: NO_TABLE };
    const { by, calls } = await check({ tables: none });
    expect(by.server.status).toBe('ok'); // сервер отвечает: это именно «нет схемы»
    expect(by.schema.status).toBe('fail');
    expect(by.read.status).toBe('skip');
    expect(by.write.status).toBe('skip');
    expect(calls.upserts).toHaveLength(0);
  });

  it('странный ответ по таблице: видно таблицу и код', async () => {
    const { by } = await check({ tables: { transactions: fail('XX001', 'index corrupted', 400) } });
    expect(by.schema.status).toBe('fail');
    expect(by.schema.message).toContain('transactions');
    expect(by.schema.message).toContain('XX001');
    expect(by.read.status).toBe('fail');
  });

  it('одна таблица не ответила вовремя: шаг не висит, а честно падает', async () => {
    const { by } = await check({ tables: { wallets: 'hang' } }, {}, { timeoutMs: 30 });
    expect(by.schema.status).toBe('fail');
    expect(by.schema.message).toContain('wallets');
    expect(by.schema.message).toContain('не ответил');
  });
});

describe('Шаг «Чтение данных»', () => {
  it('нет прав чтения (42501): видно таблицу, совет про schema.sql; таблица при этом на месте', async () => {
    const { by } = await check({ tables: { transactions: DENIED } });
    expect(by.schema.status).toBe('ok');
    expect(by.read.status).toBe('fail');
    expect(by.read.message).toContain('transactions');
    expect(by.read.message).toContain('schema.sql');
  });

  it('401/403 без кода — тоже «нет прав»', async () => {
    const { by } = await check({ tables: { wallets: fail('', 'Forbidden', 403) } });
    expect(by.read.status).toBe('fail');
    expect(by.read.message).toContain('wallets');
  });

  it('сервер показывает чужие строки: тревога, называет таблицу', async () => {
    const { by } = await check({ tables: { wallets: rows([{ id: 'a', user_id: U }, { id: 'b', user_id: OTHER_USER }]) } });
    expect(by.read.status).toBe('fail');
    expect(by.read.message).toContain('ОПАСНО');
    expect(by.read.message).toContain('wallets');
    expect(by.read.message).toContain('RLS');
  });

  it('строки без user_id не вызывают ложной тревоги', async () => {
    const { by } = await check({ tables: { wallets: rows([{ id: 'a' }, { id: 'b', user_id: null }]) } });
    expect(by.read.status).toBe('ok');
  });

  it('синхронизация была, всё отправлено, а на сервере нет ни одной настройки: замечание', async () => {
    const { by } = await check({ tables: { settings: rows([]) } }, { everSynced: true });
    expect(by.read.status).toBe('warn');
    expect(by.read.message).toContain('settings');
  });

  it.each([
    ['синхронизации ещё не было', { everSynced: false }],
    ['есть неотправленные записи', { everSynced: true, pending: 2 }],
    ['есть отвергнутые записи', { everSynced: true, quarantined: 1 }],
  ])('пустые settings не тревога, если %s', async (_name, ctx) => {
    const { by } = await check({ tables: { settings: rows([]) } }, ctx);
    expect(by.read.status).toBe('ok');
  });
});

describe('Тип клиента', () => {
  it('настоящий клиент supabase-js подходит под CloudClientLike (проверяет компилятор)', () => {
    const accept = (real: SupabaseClient): CloudClientLike => real;
    expect(typeof accept).toBe('function');
  });
});
