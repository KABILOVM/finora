import { describe, expect, it } from 'vitest';
import { formatReport, overallStatus, runCloudCheck, type CheckStep } from './diagnostics';
import { DENIED, HOST, NETWORK, NO_TABLE, U, check, checkViolation, ctxOf, fail, fakeCloud, rows } from './__fixtures__/diagKit';

describe('Шаг «Запись данных»: проверка без записи данных', () => {
  it('CHECK 23514 — норма: «запись разрешена, защита данных работает»', async () => {
    const { by } = await check({ upsert: checkViolation });
    expect(by.write.status).toBe('ok');
    expect(by.write.message).toContain('Запись разрешена');
    expect(by.write.message).toContain('защита данных работает');
  });

  it('нет прав записи (42501): говорит про политики из schema.sql', async () => {
    const { by } = await check({ upsert: DENIED });
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('Нет прав записи');
    expect(by.write.message).toContain('schema.sql');
  });

  it('вставка внезапно прошла: ошибка проверки, «создала лишнюю строку» и id этой строки', async () => {
    const { by } = await check({ upsert: { data: null, error: null, status: 201 } });
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('Проверка создала лишнюю строку');
    expect(by.write.message).toContain('probe-id-1');
    expect(by.write.message).toContain('помечена удалённой');
  });

  it('если сервер вернул id вставленной строки — показываем именно его', async () => {
    const { by } = await check({ upsert: { data: [{ id: 'returned-id-9' }], error: null, status: 201 } });
    expect(by.write.status).toBe('fail');
    expect(by.write.message).toContain('returned-id-9');
  });

  it('пробная строка уходит по одной в каждую из четырёх таблиц (как пишет синхронизация), а лишние строки не удаляются', async () => {
    const { calls } = await check({ upsert: { data: null, error: null, status: 201 } });
    expect(calls.upserts.map((u) => u.table).sort()).toEqual(['categories', 'settings', 'transactions', 'wallets']);
    expect(calls.upserts.every((u) => u.options?.onConflict === 'id')).toBe(true); // upsert по id, как у синхронизации
  });

  it.each([
    ['другая ошибка ограничения (23502)', fail('23502', 'null value in column', 400), 'warn', '23502'],
    ['нет колонки (схема старая)', fail('PGRST204', "Could not find the 'icon' column", 400), 'fail', 'не совпадает'],
    ['нет колонки (42703)', fail('42703', 'column does not exist', 400), 'fail', 'не совпадает'],
    ['сервер не видит входа (28000)', fail('28000', 'Нужно войти в систему', 403), 'fail', 'не видит вашего входа'],
    ['токен просрочен (PGRST301)', fail('PGRST301', 'JWT expired', 401), 'fail', 'не видит вашего входа'],
    ['обрыв сети', NETWORK, 'fail', 'не ответил'],
    ['сервер упал (500)', fail('XX000', 'internal', 500), 'fail', '500'],
    ['незнакомая ошибка', fail('P0001', 'что-то странное', 400), 'warn', 'P0001'],
    ['пустой ответ', null as never, 'warn', 'непонятно'],
  ])('%s', async (_name, insert, status, text) => {
    const { by } = await check({ upsert: insert });
    expect(by.write.status).toBe(status);
    expect(by.write.message).toContain(text);
  });

  it('исключение при вставке и зависание вставки не ломают проверку', async () => {
    const thrown = await check({ upsert: { throws: new TypeError('Failed to fetch') } });
    expect(thrown.by.write.status).toBe('fail');
    expect(thrown.steps).toHaveLength(7);
    const hung = await check({ upsert: 'hang' }, {}, { timeoutMs: 30 });
    expect(hung.by.write.status).toBe('fail');
    expect(hung.by.write.message).toContain('не ответил');
    expect(hung.by.rates.status).toBe('ok'); // следующий шаг идёт дальше
  });

  it('при ошибке связи или входа вставка вообще не отправляется', async () => {
    for (const script of [{ tables: { settings: NETWORK } }, { session: null }, { session: { user: { id: 'другой' } } }]) {
      const { calls } = await check(script);
      expect(calls.upserts).toHaveLength(0);
    }
  });
});

describe('Шаг «Курсы валют на сервере»', () => {
  it('курсы есть: «ok», видно число строк и последнюю дату', async () => {
    const { by } = await check();
    expect(by.rates.status).toBe('ok');
    expect(by.rates.message).toContain('2 записи');
    expect(by.rates.message).toContain('2026-10-10');
  });

  it('таблица пуста: замечание «не обязательно», остальное в порядке', async () => {
    const { by, steps } = await check({ tables: { exchange_rates: rows([]) } });
    expect(by.rates.status).toBe('warn');
    expect(by.rates.message).toContain('публичных источников');
    expect(by.rates.message).toContain('fetch-rates');
    expect(by.rates.message).toContain('не обязательно');
    expect(overallStatus(steps)).toBe('warn');
  });

  it('мусорные даты не мешают', async () => {
    const { by } = await check({ tables: { exchange_rates: rows([{ as_of: 'вчера' }, { as_of: 5 }, null]) } });
    expect(by.rates.status).toBe('ok');
    expect(by.rates.message).not.toContain('последняя дата');
  });

  it('нет прав читать курсы — замечание, а не ошибка (курсы есть и из других источников)', async () => {
    const { by } = await check({ tables: { exchange_rates: DENIED } });
    expect(by.rates.status).toBe('warn');
    expect(by.schema.status).toBe('ok');
  });

  it('нет таблицы курсов — шаг пропущен, причина в шаге про таблицы', async () => {
    const { by } = await check({ tables: { exchange_rates: NO_TABLE } });
    expect(by.rates.status).toBe('skip');
    expect(by.schema.message).toContain('exchange_rates');
  });

  it('сбой чтения курсов — ошибка с кодом', async () => {
    const { by } = await check({ tables: { exchange_rates: fail('XX001', 'broken', 400) } });
    expect(by.rates.status).toBe('fail');
    expect(by.rates.message).toContain('XX001');
  });
});

describe('Шаг «Данные на этом устройстве»', () => {
  it('ничего не ждёт: «ok»', async () => {
    const { by } = await check();
    expect(by.local).toMatchObject({ status: 'ok' });
    expect(by.local.message).toContain('Нет записей, которые ждут отправки');
  });

  it.each([
    [1, 'запись'],
    [3, 'записи'],
    [5, 'записей'],
    [21, 'запись'],
  ])('ждут отправки: %i → «%s»', async (pending, word) => {
    const { by } = await check({}, { pending });
    expect(by.local.status).toBe('ok');
    expect(by.local.message).toContain(`Ждут отправки: ${pending} ${word}`);
  });

  it('карантин: замечание с советом «Повторить»; неотправленные тоже названы', async () => {
    const { by, steps } = await check({}, { quarantined: 2, pending: 4 });
    expect(by.local.status).toBe('warn');
    expect(by.local.message).toContain('2 записи');
    expect(by.local.message).toContain('«Повторить»');
    expect(by.local.message).toContain('4 записи');
    expect(overallStatus(steps)).toBe('warn');
  });

  it.each([[NaN], [-1], [1.5], [Infinity]])('невозможное число (%s) — «не удалось узнать», без падения', async (bad) => {
    const a = await check({}, { pending: bad });
    const b = await check({}, { quarantined: bad });
    expect(a.by.local.status).toBe('skip');
    expect(b.by.local.status).toBe('skip');
  });

  it('показывается и когда сервера нет', async () => {
    const { by } = await check({ tables: { settings: NETWORK } }, { pending: 7, quarantined: 1 });
    expect(by.local.status).toBe('warn');
    expect(by.local.message).toContain('7 записей');
  });
});

describe('Устойчивость: проверка ничего не ломает', () => {
  it('нет клиента — ошибка «облако не подключено», без исключения', async () => {
    const steps = await runCloudCheck(null as never, ctxOf());
    expect(steps).toHaveLength(7);
    expect(steps[0]).toMatchObject({ id: 'server', status: 'fail' });
    expect(steps[0]?.message).toContain('Облако не подключено');
  });

  it('клиент возвращает мусор вместо построителя запросов — без исключения', async () => {
    const junk = { from: () => undefined, auth: { getSession: () => undefined } } as never;
    const steps = await runCloudCheck(junk, ctxOf());
    expect(steps).toHaveLength(7);
    expect(steps[0]?.status).toBe('fail');
  });

  it('нет описания контекста — без исключения, шаги на месте', async () => {
    const { client } = fakeCloud();
    const steps = await runCloudCheck(client, null as never);
    expect(steps).toHaveLength(7);
    expect(steps[1]?.status).toBe('fail'); // чей это вход — неизвестно
  });

  it('слушатель шагов видит шаги по порядку; его исключение проверку не останавливает', async () => {
    const seen: CheckStep[] = [];
    const { client } = fakeCloud();
    const steps = await runCloudCheck(client, ctxOf(), {
      onStep: (s) => {
        seen.push(s);
        throw new Error('слушатель сломался');
      },
    });
    expect(seen).toEqual(steps);
    expect(steps).toHaveLength(7);
  });

  it('пустой url не мешает: просто нет имени сервера в тексте', async () => {
    const { by } = await check({ tables: { settings: NETWORK } }, { url: '' });
    expect(by.server.message).toContain('Нет связи с сервером.');
  });
});

describe('formatReport и overallStatus', () => {
  const NOW = new Date('2026-10-10T16:40:00.000Z');

  it('отчёт: итог, сервер и по строке на шаг с отметками ✔ ⚠ ✖ –', async () => {
    const { steps } = await check({ tables: { wallets: NO_TABLE } }, { quarantined: 1 });
    const report = formatReport(steps, { now: NOW, host: HOST });
    const lines = report.split('\n');
    expect(lines[0]).toBe('Проверка облака Finora, 2026-10-10 16:40 UTC');
    expect(lines[1]).toBe('Итог: есть ошибки');
    expect(lines[2]).toBe(`Сервер: ${HOST}`);
    expect(report).toMatch(/^✔ Связь с сервером: /m);
    expect(report).toMatch(/^✖ Таблицы в базе: Выполните файл supabase\/schema\.sql/m);
    expect(report).toMatch(/^⚠ Данные на этом устройстве: /m);
    expect(lines.filter((l) => /^[✔⚠✖–] /.test(l))).toHaveLength(steps.length);
  });

  it('пропущенные шаги отмечены «–»', async () => {
    const { steps } = await check({ tables: { settings: NETWORK } });
    expect(formatReport(steps, { now: NOW })).toMatch(/^– Вход в аккаунт: Пропущено:/m);
  });

  it('в отчёт не попадают идентификатор пользователя и адрес целиком', async () => {
    const { steps } = await check();
    const report = formatReport(steps, { now: NOW, host: HOST });
    expect(report).not.toContain(U);
    expect(report).not.toContain('https://');
  });

  it('без параметров не падает; плохая дата → «время неизвестно»', async () => {
    const { steps } = await check();
    expect(formatReport(steps)).toContain('Итог: всё в порядке');
    expect(formatReport(steps, { now: new Date('нет') })).toContain('время неизвестно');
    expect(formatReport([], { now: NOW })).toContain('Итог: всё в порядке');
  });

  it('overallStatus: ошибка > замечание/пропуск > порядок', () => {
    const s = (status: CheckStep['status']): CheckStep => ({ id: 'server', title: 't', status, message: 'm' });
    expect(overallStatus([s('ok'), s('ok')])).toBe('ok');
    expect(overallStatus([s('ok'), s('warn')])).toBe('warn');
    expect(overallStatus([s('ok'), s('skip')])).toBe('warn');
    expect(overallStatus([s('warn'), s('fail'), s('skip')])).toBe('fail');
  });
});
