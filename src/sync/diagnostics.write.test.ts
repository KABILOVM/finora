import { describe, expect, it } from 'vitest';
import { formatReport, overallStatus } from './diagnostics';
import { DENIED, NETWORK, PROBE_RULE, checkViolation, check, fail, rows, type Reply } from './__fixtures__/diagKit';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.c2lnbmF0dXJl`;
const TABLES = ['categories', 'settings', 'transactions', 'wallets'];
const created: Reply = { data: null, error: null, status: 201 };

describe('Секретный ключ в сборке (service_role)', () => {
  it.each([
    ['старый JWT', jwt('service_role')],
    ['новый sb_secret_', 'sb_secret_AbCdEf123456'],
  ])('%s: «Связь с сервером» — ошибка с советом, остальные шаги всё равно идут, итог — ошибка', async (_name, apiKey) => {
    const { by, steps } = await check({}, { apiKey });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('service_role');
    expect(by.server.message).toContain('VITE_SUPABASE_ANON_KEY');
    for (const id of ['session', 'schema', 'read', 'write', 'rates'] as const) expect(by[id].status, id).toBe('ok');
    expect(overallStatus(steps)).toBe('fail');
  });

  it('ни в сообщениях, ни в отчёте ключа нет', async () => {
    const apiKey = jwt('service_role');
    const { steps } = await check({}, { apiKey });
    const everything = JSON.stringify(steps) + formatReport(steps, { host: 'abcdefgh.supabase.co' });
    for (const part of apiKey.split('.').slice(1, 2)) expect(everything).not.toContain(part);
    expect(everything).not.toContain('sb_secret_');
  });

  it('и при обрыве связи тревога про ключ не пропадает, а остальные шаги пропущены', async () => {
    const { by } = await check({ tables: { settings: NETWORK } }, { apiKey: jwt('service_role') });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('service_role');
    expect(by.server.message).toContain('Нет связи');
    expect(by.session.status).toBe('skip');
  });

  it.each([
    ['anon (JWT)', jwt('anon')],
    ['publishable', 'sb_publishable_AbCdEf123456'],
    ['непонятный ключ', 'что-то своё'],
    ['ключ не передан', undefined],
  ])('%s: тревоги нет, итог «ok»', async (_name, apiKey) => {
    const { steps, by } = await check({}, { apiKey });
    expect(by.server.status).toBe('ok');
    expect(overallStatus(steps)).toBe('ok');
  });
});

describe('Шаг «Запись данных»: все четыре таблицы, как у настоящей синхронизации', () => {
  it('у пробной строки каждой таблицы своё правило, и сервер, отклонивший именно его, даёт «ok»', async () => {
    const { by } = await check({ upsert: checkViolation });
    expect(by.write.status).toBe('ok');
    for (const t of TABLES) expect(by.write.message).toContain(t);
    expect(Object.keys(PROBE_RULE).sort()).toEqual(TABLES);
  });

  it('нет права только в одну таблицу (например, INSERT на transactions): ошибка называет её и только её', async () => {
    const { by, steps } = await check({ upsert: (t) => (t === 'transactions' ? DENIED : checkViolation(t)) });
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('Нет прав записи (transactions)');
    expect(by.write.message).not.toContain('settings');
    expect(overallStatus(steps)).toBe('fail');
  });

  it('нет права обновлять (42501 во всех таблицах): названы все четыре, одной фразой', async () => {
    const { by } = await check({ upsert: DENIED });
    expect(by.write.status).toBe('fail');
    const phrase = by.write.message.match(/Нет прав записи \(([^)]+)\)/);
    expect(phrase?.[1]?.split(', ').sort()).toEqual(TABLES);
    expect(by.write.message).toContain('вставка, и обновление');
  });

  it('строка прошла только в одну таблицу: «создала лишнюю строку» именно в ней, остальное — как есть', async () => {
    const { by } = await check({ upsert: (t) => (t === 'wallets' ? created : checkViolation(t)) });
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('в таблице wallets');
    expect(by.write.message).not.toContain('в таблице categories');
  });

  it('разные проблемы в разных таблицах складываются в один ответ, ошибка важнее замечания', async () => {
    const { by } = await check({ upsert: (t) => (t === 'settings' ? fail('P0001', 'странно', 400) : t === 'wallets' ? DENIED : checkViolation(t)) });
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('Нет прав записи (wallets)');
    expect(by.write.message).toContain('P0001');
  });

  it('23514 по другому правилу (часы телефона → *_ts_sane) — замечание, а не «защита работает»', async () => {
    const { by, steps } = await check({ upsert: (t) => checkViolation(t, `${t}_ts_sane`) });
    expect(by.write.status).toBe('warn');
    expect(by.write.message).toContain('categories_ts_sane');
    expect(by.write.message).toContain('дату и время');
    expect(by.write.message).not.toContain('защита данных работает');
    expect(overallStatus(steps)).toBe('warn');
  });

  it('23514 без названия правила в тексте (другая формулировка сервера) — не считаем ложной тревогой', async () => {
    const { by } = await check({ upsert: fail('23514', 'violates check constraint', 400) });
    expect(by.write.status).toBe('ok');
  });

  it('отказ сети только на одной таблице: шаг — ошибка «не ответил», остальные шаги идут дальше', async () => {
    const { by } = await check({ upsert: (t) => (t === 'transactions' ? NETWORK : checkViolation(t)) });
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('не ответил');
    expect(by.rates.status).toBe('ok');
  });

  it('в «ok» честно сказано, что правка существующих записей не проверялась', async () => {
    const { by } = await check();
    expect(by.write.message).toContain('Правка уже существующих записей не проверялась');
  });

  it('пустое имя и сумма 0: пробные строки заведомо неверны, а остальные поля — допустимы', async () => {
    const { calls } = await check();
    const row = (t: string) => calls.upserts.find((u) => u.table === t)!.row;
    expect(row('transactions')).toMatchObject({ kind: 'expense', amount_minor: 0, base_currency: 'TJS' });
    expect(row('wallets')).toMatchObject({ name: '', currency: 'TJS', kind: 'cash' });
    expect(row('settings')).toMatchObject({ locale: 'ru', week_starts_on: 1 });
    expect(row('settings')['id']).toBe('probe-id-1'); // не id пользователя: настоящие настройки задеть нельзя
  });
});

describe('Шаг «Курсы валют на сервере»: свежие впереди', () => {
  it('курсы запрашиваются отсортированными по дате, новейшие вперёд, а не «первые попавшиеся»', async () => {
    const { calls } = await check();
    const rates = calls.selects.filter((s) => s.table === 'exchange_rates');
    expect(rates).toHaveLength(1);
    expect(rates[0]?.order).toEqual({ column: 'as_of', ascending: false });
    expect(calls.selects.filter((s) => s.table !== 'exchange_rates').every((s) => s.order === undefined)).toBe(true);
  });

  it('последняя дата — наибольшая, в каком бы порядке ни пришли строки', async () => {
    const list = ['2026-10-10', '2026-10-01', '2026-10-07'].map((as_of) => ({ as_of, source: 'nbt', fetched_at: `${as_of}T05:30:00Z` }));
    const { by } = await check({ tables: { exchange_rates: rows(list) } });
    expect(by.rates.message).toContain('последняя дата 2026-10-10');
  });
});

describe('Чтение: колонки синхронизации и честные слова о защите строк', () => {
  it('читаются все колонки, нужные синхронизации (включая server_seq), а не только id и user_id', async () => {
    const { calls } = await check();
    const cols = calls.selects.find((s) => s.table === 'wallets')!.columns.split(',');
    for (const c of ['id', 'user_id', 'server_seq', 'client_updated_at', 'opening_balance_minor']) expect(cols).toContain(c);
  });

  it('в таблице нет нужной колонки (42703): схема не совпадает, подсказка про schema.sql, а не «повторите»', async () => {
    const { by, steps } = await check({ tables: { wallets: fail('42703', 'column wallets.server_seq does not exist', 400) } });
    expect(by.server.status).toBe('ok');
    expect(by.schema.status).toBe('fail');
    expect(by.schema.message).toContain('wallets');
    expect(by.schema.message).toContain('не совпадает');
    expect(by.schema.message).toContain('schema.sql');
    expect(by.read.status).toBe('fail');
    expect(overallStatus(steps)).toBe('fail');
  });

  it('«чужих записей не видно» не выдаётся за доказательство защиты строк', async () => {
    const { by } = await check();
    expect(by.read.status).toBe('ok');
    expect(by.read.message).toContain('чужих записей не видно');
    expect(by.read.message).toContain('подтвердить не может');
    expect(by.read.message).toContain('README');
  });
});

describe('Исключение, не являющееся Error', () => {
  it('обычный объект с message: в тексте его message, а не «[object Object]»', async () => {
    const { by } = await check({ tables: { settings: { throws: { message: 'что-то сломалось', hint: 'x' } } } });
    expect(by.server.status).toBe('fail');
    expect(by.server.message).toContain('что-то сломалось');
    expect(by.server.message).not.toContain('[object');
  });

  it.each([[null], [undefined], [{}], [42]])('брошено %s — читаемый текст без «null/undefined/[object»', async (thrown) => {
    const { steps } = await check({ tables: { settings: { throws: thrown } }, session: { throws: thrown } });
    for (const s of steps) expect(s.message, s.id).not.toMatch(/\[object|undefined|null/);
  });
});
