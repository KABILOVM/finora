// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateTable } from '@/domain/types';
import { NOW, fail, makeTable, ok, setup, stubProvider } from './__fixtures__/testkit';
import { createMemoryRateStorage } from './storage';
import type { RateProvider, RateStorage } from './types';

describe('refresh: порядок провайдеров', () => {
  it('первый успешный побеждает, остальные не опрашиваются', async () => {
    const server = stubProvider('server', ok({ source: 'server' }));
    const nbt = stubProvider('nbt', ok());
    const api = stubProvider('api', ok({ source: 'api' }));
    const { service } = setup([server, nbt, api]);
    const r = await service.refresh();
    expect(r).toMatchObject({ ok: true, providerId: 'server', aborted: false, failures: [] });
    expect([server.calls, nbt.calls, api.calls]).toEqual([1, 0, 0]);
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, source: 'server' });
  });

  it('server упал → nbt; ошибка server записана в failures, а не брошена', async () => {
    const server = stubProvider('server', fail('JWT expired'));
    const nbt = stubProvider('nbt', ok());
    const api = stubProvider('api', ok({ source: 'api' }));
    const { service } = setup([server, nbt, api]);
    const r = await service.refresh();
    expect(r.ok).toBe(true);
    expect(r.providerId).toBe('nbt');
    expect(r.failures).toEqual([{ providerId: 'server', kind: 'error', message: 'Источник курсов не пустил запрос (нужен вход или доступ закрыт)' }]);
    expect(api.calls).toBe(0);
    expect(service.getStatus().lastError).toBeNull();
  });

  it('server и nbt упали → api', async () => {
    const { service } = setup([stubProvider('server', fail('a')), stubProvider('nbt', fail('b')), stubProvider('api', ok({ source: 'api' }))]);
    const r = await service.refresh();
    expect(r.providerId).toBe('api');
    expect(r.failures.map((f) => f.providerId)).toEqual(['server', 'nbt']);
    expect(service.getRate('USD', 'TJS')?.source).toBe('api');
  });

  it('все упали: ok=false, прежние курсы целы, lastError перечисляет причины, исключения нет', async () => {
    const storage = createMemoryRateStorage();
    await setup([stubProvider('nbt', ok())], { storage }).service.refresh();

    const { service } = setup(
      [stubProvider('server', fail('сервер лежит')), stubProvider('nbt', fail('HTTP 503')), stubProvider('api', fail('нет связи'))],
      { storage },
    );
    const r = await service.refresh();
    expect(r).toMatchObject({ ok: false, providerId: null, table: null, aborted: false });
    expect(r.failures).toHaveLength(3);
    const err = service.getStatus().lastError ?? '';
    for (const part of ['сервер курсов — сервер лежит', 'Нацбанк — источник курсов сейчас не работает (ошибка 503)', 'запасной источник — нет связи']) expect(err).toContain(part);
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95 });
  });

  it('пустой список провайдеров — понятная ошибка, а не падение', async () => {
    const { service } = setup([]);
    const r = await service.refresh();
    expect(r.ok).toBe(false);
    expect(service.getStatus().lastError).toMatch(/ни одного источника/);
  });

  it('провайдер бросил синхронно, вернул мусор (null / строка) — это просто отказ', async () => {
    const syncThrow: RateProvider = {
      id: 'sync',
      fetchLatest: () => {
        throw new Error('sync boom');
      },
    };
    const junk1 = stubProvider('junk1', (() => null) as unknown as () => RateTable);
    const junk2 = stubProvider('junk2', (() => 'таблица') as unknown as () => RateTable);
    const good = stubProvider('good', ok());
    const r = await setup([syncThrow, junk1, junk2, good]).service.refresh();
    expect(r.providerId).toBe('good');
    expect(r.failures.map((f) => [f.providerId, f.kind])).toEqual([
      ['sync', 'error'],
      ['junk1', 'rejected'],
      ['junk2', 'rejected'],
    ]);
  });

  it('параллельные вызовы делят один запрос', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const p = stubProvider('nbt', async () => {
      await gate;
      return makeTable();
    });
    const { service } = setup([p]);
    const a = service.refresh();
    const b = service.refresh();
    expect(a).toBe(b);
    release();
    await a;
    expect(p.calls).toBe(1);
    await service.refresh(); // после завершения можно снова
    expect(p.calls).toBe(2);
  });
});

describe('refresh: проверка на здравый смысл', () => {
  const stored = () => makeTable({ perUnit: { TJS: 1, USD: 10, EUR: 12 } });

  async function withStored(providers: RateProvider[]) {
    const storage = createMemoryRateStorage();
    await setup([stubProvider('nbt', stored)], { storage }).service.refresh();
    return setup(providers, { storage });
  }

  it('скачок курса > 50%: таблица не принимается, прежняя остаётся, возвращается предупреждение', async () => {
    const crazy = stubProvider('nbt', ok({ perUnit: { TJS: 1, USD: 25, EUR: 12 }, fetchedAt: '2026-10-10T13:00:00.000Z' }));
    const { service } = await withStored([crazy]);
    const r = await service.refresh();
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatchObject({ providerId: 'nbt', kind: 'rejected' });
    expect(r.failures[0]?.message).toContain('USD: 10 → 25 (+150%)');
    expect(r.warnings.join(' ')).toMatch(/подозрительно.*оставлены прежние/);
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10);
    expect(service.getStatus().lastError).toContain('USD: 10 → 25');
  });

  it('подозрительная таблица одного провайдера не мешает нормальной от следующего', async () => {
    const { service } = await withStored([
      stubProvider('server', ok({ source: 'server', perUnit: { TJS: 1, USD: 100, EUR: 12 } })),
      stubProvider('nbt', ok({ perUnit: { TJS: 1, USD: 10.4, EUR: 12.1 } })),
    ]);
    const r = await service.refresh();
    expect(r).toMatchObject({ ok: true, providerId: 'nbt' });
    expect(r.warnings).toHaveLength(1);
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.4);
  });

  it('битые значения (NaN, 0, минус, Infinity) не принимаются даже без прежней таблицы', async () => {
    for (const bad of [NaN, 0, -3, Infinity]) {
      const { service } = setup([stubProvider('nbt', ok({ perUnit: { TJS: 1, USD: bad } }))]);
      const r = await service.refresh();
      expect(r.ok, String(bad)).toBe(false);
      expect(service.getRate('USD', 'TJS')).toBeNull();
    }
  });

  it('данные старее сохранённых не принимаются («outdated»), следующий провайдер получает шанс', async () => {
    const { service } = await withStored([
      stubProvider('server', ok({ source: 'server', asOf: '2026-10-08', perUnit: { TJS: 1, USD: 10.1, EUR: 12 } })),
      stubProvider('nbt', ok({ asOf: '2026-10-10', perUnit: { TJS: 1, USD: 10.2, EUR: 12 } })),
    ]);
    const r = await service.refresh();
    expect(r.failures).toEqual([{ providerId: 'server', kind: 'outdated', message: 'курсы на 2026-10-08 старее сохранённых на 2026-10-10' }]);
    expect(r.providerId).toBe('nbt');
  });

  it('дата из будущего не принимается даже от «своего» провайдера: иначе она заблокировала бы все следующие обновления', async () => {
    const { service } = setup([stubProvider('nbt', ok({ asOf: '2030-01-01' })), stubProvider('api', ok({ source: 'api', asOf: '2026-10-10' }))]);
    const r = await service.refresh();
    expect(r.providerId).toBe('api');
    expect(r.failures[0]).toMatchObject({ providerId: 'nbt', kind: 'rejected' });
    expect(r.failures[0]?.message).toContain('из будущего');
    await expect(setup([stubProvider('nbt', ok({ asOf: '2026-10-11' }))]).service.refresh()).resolves.toMatchObject({ ok: true }); // «завтра» — допустимо
  });

  it('та же дата принимается и обновляет значения', async () => {
    const { service } = await withStored([stubProvider('nbt', ok({ perUnit: { TJS: 1, USD: 10.3, EUR: 12 } }))]);
    expect((await service.refresh()).ok).toBe(true);
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.3);
  });

  it('предупреждения разбора доходят до результата, но не попадают в хранилище', async () => {
    const withWarnings = { ...makeTable(), warnings: ['Дубль GBP: взята первая'] } as RateTable;
    const { service, storage } = setup([stubProvider('nbt', () => withWarnings)]);
    const r = await service.refresh();
    expect(r.warnings).toEqual(['Дубль GBP: взята первая']);
    expect(JSON.stringify(storage.get())).not.toContain('warnings');
    expect(r.table).not.toHaveProperty('warnings');
  });
});

describe('refresh: таймаут и отмена', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const never = () => new Promise<RateTable>(() => {});

  it('провайдер, не уложившийся в 8 секунд по умолчанию, считается упавшим; следующий опрашивается', async () => {
    const slow = stubProvider('server', never);
    const nbt = stubProvider('nbt', ok());
    const { service } = setup([slow, nbt]);
    const pending = service.refresh();
    await vi.advanceTimersByTimeAsync(7999);
    expect(nbt.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const r = await pending;
    expect(r.providerId).toBe('nbt');
    expect(r.failures).toEqual([{ providerId: 'server', kind: 'timeout', message: 'нет ответа за 8 с' }]);
    expect(slow.signals[0]?.aborted).toBe(true); // провайдеру сказали «хватит»
  });

  it('свой fetchTimeoutMs; провайдер, игнорирующий signal, всё равно не вешает обновление', async () => {
    const { service } = setup([stubProvider('nbt', never), stubProvider('api', never)], { fetchTimeoutMs: 100 });
    const pending = service.refresh();
    await vi.advanceTimersByTimeAsync(250);
    const r = await pending;
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.kind)).toEqual(['timeout', 'timeout']);
    expect(service.getStatus().lastError).toContain('Нацбанк — нет ответа за 100 мс');
  });

  it('таймер не течёт: после успешного ответа активных таймеров нет', async () => {
    const { service } = setup([stubProvider('nbt', ok())]);
    await service.refresh();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('запоздавший ответ после таймаута игнорируется', async () => {
    let late!: (t: RateTable) => void;
    const slow = stubProvider('nbt', () => new Promise<RateTable>((res) => (late = res)));
    const { service } = setup([slow], { fetchTimeoutMs: 50 });
    const pending = service.refresh();
    await vi.advanceTimersByTimeAsync(60);
    const r = await pending;
    late(makeTable());
    await vi.advanceTimersByTimeAsync(0);
    expect(r.ok).toBe(false);
    expect(service.getRate('USD', 'TJS')).toBeNull();
  });

  it('отмена снаружи: прекращает текущего провайдера и не идёт к следующим; lastError не затирается', async () => {
    const first = stubProvider('server', never);
    const second = stubProvider('nbt', ok());
    const { service } = setup([first, second]);
    const ctrl = new AbortController();
    const pending = service.refresh(ctrl.signal);
    await vi.advanceTimersByTimeAsync(10);
    ctrl.abort();
    const r = await pending;
    expect(r).toMatchObject({ ok: false, aborted: true });
    expect(r.failures).toEqual([{ providerId: 'server', kind: 'aborted', message: 'отменено' }]);
    expect(second.calls).toBe(0);
    expect(first.signals[0]?.aborted).toBe(true);
    expect(service.getStatus().lastError).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('уже отменённый signal: ни один провайдер не вызывается', async () => {
    const p = stubProvider('nbt', ok());
    const { service } = setup([p]);
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await service.refresh(ctrl.signal);
    expect(r).toMatchObject({ ok: false, aborted: true });
    expect(p.calls).toBe(0);
  });
});

describe('офлайн и хранение', () => {
  it('без сети отдаёт последние сохранённые курсы, помечая устаревшие', async () => {
    const storage = createMemoryRateStorage();
    await setup([stubProvider('nbt', ok({ asOf: '2026-10-01' }))], { storage }).service.refresh();

    const offline = new TypeError('Failed to fetch');
    const { service } = setup(
      [
        stubProvider('server', () => {
          throw offline;
        }),
        stubProvider('nbt', () => {
          throw offline;
        }),
      ],
      { storage },
    );
    const r = await service.refresh();
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.message).toBe('Нет связи с источником курсов');
    expect(service.getRate('USD', 'TJS')).toEqual({ rate: 10.95, source: 'nbt', asOf: '2026-10-01', stale: true, manual: false });
  });

  it('курсы переживают «перезагрузку» (новый сервис на том же хранилище) и работают без единого запроса', async () => {
    const storage = createMemoryRateStorage();
    await setup([stubProvider('nbt', ok())], { storage }).service.refresh();
    const dead = stubProvider('nbt', fail());
    const { service } = setup([dead], { storage });
    expect(service.getRate('EUR', 'TJS')?.rate).toBe(12.78);
    expect(dead.calls).toBe(0);
    expect(service.getStatus().lastRefreshAt).toBe(NOW.toISOString());
  });

  it('сломанное хранилище (get бросает) не ломает сервис', async () => {
    const broken: RateStorage = {
      get: () => {
        throw new Error('SecurityError');
      },
      set: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const { service } = setup([stubProvider('nbt', ok())], { storage: broken });
    expect(service.getRate('USD', 'TJS')).toBeNull();
    const r = await service.refresh();
    expect(r.ok).toBe(true); // не удалось сохранить, но в памяти курсы есть
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
  });

  it.each([
    ['не JSON-объект', 'мусор'],
    ['чужая версия', { v: 99, tables: [makeTable()] }],
    ['без версии', { tables: [makeTable()] }],
    ['tables не массив', { v: 1, tables: 'x', manual: 5 }],
  ])('повреждённое содержимое хранилища (%s) игнорируется', (_n, content) => {
    const { service } = setup([], { storage: createMemoryRateStorage(content) });
    expect(service.getRate('USD', 'TJS')).toBeNull();
    expect(service.listKnownCurrencies()).toEqual([]);
  });

  it('сохранённая таблица «из будущего» (часы были неверны) при загрузке отбрасывается', () => {
    const doc = { v: 1, tables: [makeTable({ asOf: '2031-05-05' }), makeTable({ asOf: '2026-10-09', source: 'api' })], manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError: null };
    const { service } = setup([], { storage: createMemoryRateStorage(doc) });
    expect(service.getRate('USD', 'TJS')).toMatchObject({ asOf: '2026-10-09' });
  });

  it('из хранилища берутся только пригодные таблицы и ручные курсы', () => {
    const content = {
      v: 1,
      tables: [makeTable(), makeTable({ asOf: '2026-10-09', perUnit: { TJS: 1, USD: NaN } }), { junk: 1 }, null],
      manual: { 'USD>TJS': { rate: 11, setAt: NOW.toISOString() }, 'EUR>EUR': { rate: 1, setAt: NOW.toISOString() }, 'bad': { rate: 5, setAt: NOW.toISOString() }, 'GBP>TJS': { rate: -1, setAt: NOW.toISOString() } },
      lastRefreshAt: 'не дата',
      lastAttemptAt: NOW.toISOString(),
      lastError: 42,
    };
    const { service } = setup([], { storage: createMemoryRateStorage(JSON.parse(JSON.stringify(content))) });
    expect(service.getRate('EUR', 'TJS')?.rate).toBe(12.78);
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 11, manual: true });
    expect(service.getRate('GBP', 'TJS')).toBeNull();
    expect(service.getStatus()).toEqual({ lastRefreshAt: null, lastAttemptAt: NOW.toISOString(), lastError: null });
  });

  it('две вкладки: старая не откатывает более свежие курсы, записанные другой', async () => {
    const storage = createMemoryRateStorage();
    const a = setup([stubProvider('nbt', ok({ asOf: '2026-10-08', perUnit: { TJS: 1, USD: 10, EUR: 12 } }))], { storage }).service;
    const b = setup([stubProvider('nbt', ok({ asOf: '2026-10-10', perUnit: { TJS: 1, USD: 10.5, EUR: 12 } }))], { storage }).service;
    await b.refresh();
    await a.refresh(); // у вкладки A в голове только старая таблица
    expect(a.getRate('USD', 'TJS')).toMatchObject({ rate: 10.5, asOf: '2026-10-10' });
    expect(setup([], { storage }).service.getRate('USD', 'TJS')?.asOf).toBe('2026-10-10');
  });

  it('хранится не больше двенадцати таблиц', async () => {
    const storage = createMemoryRateStorage();
    for (let day = 1; day <= 20; day++) {
      const asOf = `2026-09-${String(day).padStart(2, '0')}`;
      await setup([stubProvider('nbt', ok({ asOf }))], { storage }).service.refresh();
    }
    const doc = storage.get() as { tables: RateTable[] };
    expect(doc.tables).toHaveLength(12);
    expect(doc.tables[0]?.asOf).toBe('2026-09-20');
  });
});

