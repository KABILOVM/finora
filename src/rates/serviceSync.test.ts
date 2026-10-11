// @vitest-environment node
// Несколько вкладок на одном хранилище, общий запрос refresh, исключённые экзотические валюты, «ранние» таблицы провайдера.
import { describe, expect, it } from 'vitest';
import type { RateTable } from '@/domain/types';
import { NOW, makeTable, ok, setup, stubProvider } from './__fixtures__/testkit';
import { createRateService } from './service';
import { createMemoryRateStorage } from './storage';
import type { RateStorage } from './types';

/** Хранилище в памяти, которое умеет «сообщать об изменениях из другой вкладки» по команде теста. */
function notifyingStorage(init?: unknown): RateStorage & { fireExternal(): void; listeners: number } {
  const base = createMemoryRateStorage(init);
  const subs = new Set<() => void>();
  return {
    get: () => base.get(),
    set: (v) => base.set(v),
    subscribe(l) {
      subs.add(l);
      return () => subs.delete(l);
    },
    fireExternal: () => [...subs].forEach((l) => l()),
    get listeners() {
      return subs.size;
    },
  };
}

describe('несколько вкладок: ручные курсы и статус', () => {
  it('разные пары, заданные в двух вкладках, сохраняются обе', () => {
    const storage = createMemoryRateStorage();
    const a = createRateService({ providers: [], storage, now: () => NOW });
    const b = createRateService({ providers: [], storage, now: () => NOW });
    a.setManualRate('USD', 'TJS', 11.5);
    b.setManualRate('EUR', 'TJS', 13); // вкладка B о курсе USD не знала
    const reloaded = createRateService({ providers: [], storage, now: () => NOW });
    expect(reloaded.getRate('USD', 'TJS')).toMatchObject({ rate: 11.5, manual: true });
    expect(reloaded.getRate('EUR', 'TJS')).toMatchObject({ rate: 13, manual: true });
  });

  it('вкладка, не знавшая о ручном курсе другой вкладки, может его удалить', () => {
    const storage = createMemoryRateStorage();
    const a = createRateService({ providers: [], storage, now: () => NOW });
    const b = createRateService({ providers: [], storage, now: () => NOW });
    a.setManualRate('USD', 'TJS', 11.5);
    b.clearManualRate('USD', 'TJS');
    expect(createRateService({ providers: [], storage, now: () => NOW }).getRate('USD', 'TJS')).toBeNull();
  });

  it('refresh в старой вкладке узнаёт о чужом ручном курсе ещё до записи', async () => {
    const storage = createMemoryRateStorage();
    const a = createRateService({ providers: [], storage, now: () => NOW });
    const b = createRateService({ providers: [stubProvider('nbt', ok())], storage, now: () => NOW });
    a.setManualRate('USD', 'TJS', 11.5);
    expect(b.getRate('USD', 'TJS')).toBeNull(); // пока не обновлялась
    await b.refresh();
    expect(b.getRate('USD', 'TJS')).toMatchObject({ rate: 11.5, source: 'manual' });
  });

  it('статус обновления, сделанного другой вкладкой, не теряется при записи из старой', async () => {
    const storage = createMemoryRateStorage();
    const a = setup([stubProvider('nbt', ok())], { storage }).service;
    const b = createRateService({ providers: [], storage, now: () => new Date(NOW.getTime() - 86_400_000) });
    await a.refresh();
    b.setManualRate('USD', 'TJS', 11); // запись из вкладки со «старым» статусом
    const reloaded = createRateService({ providers: [], storage, now: () => NOW });
    expect(reloaded.getStatus().lastRefreshAt).toBe(NOW.toISOString());
    expect(reloaded.getRate('EUR', 'TJS')?.rate).toBe(12.78);
  });

  it('если запись в хранилище не удалась, ручной курс из памяти не пропадает при следующем обновлении', async () => {
    const inner = createMemoryRateStorage();
    let failSet = false;
    const storage: RateStorage = {
      get: () => inner.get(),
      set: (v) => {
        if (failSet) throw new Error('QuotaExceededError');
        inner.set(v);
      },
    };
    const svc = createRateService({ providers: [stubProvider('nbt', ok())], storage, now: () => NOW });
    svc.setManualRate('USD', 'TJS', 11.5); // записалось
    failSet = true;
    svc.setManualRate('EUR', 'TJS', 13); // не записалось: есть только в памяти
    failSet = false;
    await svc.refresh(); // читает хранилище (там только USD) и не должен затереть EUR
    expect(svc.getRate('EUR', 'TJS')).toMatchObject({ rate: 13, manual: true });
    const reloaded = createRateService({ providers: [], storage, now: () => NOW });
    expect(reloaded.getRate('EUR', 'TJS')).toMatchObject({ rate: 13, manual: true });
    expect(reloaded.getRate('USD', 'TJS')).toMatchObject({ rate: 11.5, manual: true });
  });

  it('таблица «из будущего» из хранилища не возвращается в память при записи', async () => {
    const doc = { v: 1, tables: [makeTable({ asOf: '2031-05-05', perUnit: { TJS: 1, USD: 99 } })], manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError: null };
    const storage = createMemoryRateStorage(doc);
    const { service } = setup([stubProvider('nbt', ok())], { storage });
    await service.refresh();
    const stored = storage.get() as { tables: RateTable[] };
    expect(stored.tables.map((t) => t.asOf)).toEqual(['2026-10-10']);
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
  });
});

describe('несколько вкладок: уведомление об изменении из другой вкладки', () => {
  it('пока есть подписчики, чужое изменение подтягивается и слушатели вызываются; без подписчиков хранилище не слушаем', () => {
    const storage = notifyingStorage();
    const a = createRateService({ providers: [], storage, now: () => NOW });
    const b = createRateService({ providers: [], storage, now: () => NOW });
    expect(storage.listeners).toBe(0);
    let calls = 0;
    const off = b.subscribe(() => calls++);
    const off2 = b.subscribe(() => calls++);
    expect(storage.listeners).toBe(1); // одна подписка на хранилище, сколько бы слушателей ни было

    a.setManualRate('USD', 'TJS', 11.5);
    expect(b.getRate('USD', 'TJS')).toBeNull(); // событие ещё не пришло
    storage.fireExternal();
    expect(b.getRate('USD', 'TJS')).toMatchObject({ rate: 11.5, manual: true });
    expect(calls).toBe(2);

    off();
    expect(storage.listeners).toBe(1);
    off2();
    expect(storage.listeners).toBe(0);
  });

  it('хранилище без subscribe или с падающим subscribe не мешает подписке', () => {
    const plain = createRateService({ providers: [], storage: createMemoryRateStorage(), now: () => NOW });
    expect(() => plain.subscribe(() => {})()).not.toThrow();
    const broken: RateStorage = { ...createMemoryRateStorage(), subscribe: () => { throw new Error('нет'); } };
    const svc = createRateService({ providers: [], storage: broken, now: () => NOW });
    expect(() => svc.subscribe(() => {})()).not.toThrow();
  });
});

describe('общий запрос refresh и отмена', () => {
  /** Провайдер, который отвечает через `ms` (по умолчанию 50) или падает, если его отменили. */
  function slowProvider(ms = 50) {
    return stubProvider(
      'nbt',
      (signal) =>
        new Promise<RateTable>((resolve, reject) => {
          const t = setTimeout(() => resolve(makeTable()), ms);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        }),
    );
  }

  it('отмена одного из двух ждущих не отменяет запрос: провайдер получает ответ, второй вызов успешен', async () => {
    const slow = slowProvider();
    const { service } = setup([slow]);
    const c1 = new AbortController();
    const p1 = service.refresh(c1.signal);
    const p2 = service.refresh();
    c1.abort();
    expect(await p1).toMatchObject({ ok: false, aborted: true });
    expect(slow.signals[0]?.aborted).toBe(false);
    expect(await p2).toMatchObject({ ok: true, aborted: false });
    expect(slow.calls).toBe(1);
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
  });

  it('когда отменили ВСЕ ждущие, запрос прекращается', async () => {
    const slow = slowProvider(200);
    const { service } = setup([slow]);
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = service.refresh(c1.signal);
    const p2 = service.refresh(c2.signal);
    c1.abort();
    c2.abort();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.aborted).toBe(true);
    expect(r2).toMatchObject({ ok: false, aborted: true });
    expect(slow.signals[0]?.aborted).toBe(true);
    expect(service.getRate('USD', 'TJS')).toBeNull();
  });

  it('вызов без signal удерживает запрос живым, даже если отменил единственный вызов с signal', async () => {
    const slow = slowProvider();
    const { service } = setup([slow]);
    const c = new AbortController();
    const withSignal = service.refresh(c.signal);
    const without = service.refresh();
    expect(without).not.toBe(withSignal);
    c.abort();
    expect((await without).ok).toBe(true);
    expect((await withSignal).aborted).toBe(true);
  });

  it('после отмены последнего ждущего новый вызов начинает новый запрос, а не получает «отменено»', async () => {
    let n = 0;
    const p = stubProvider(
      'nbt',
      (signal) =>
        new Promise<RateTable>((resolve, reject) => {
          n++;
          if (n === 1) signal?.addEventListener('abort', () => reject(new Error('aborted')));
          else resolve(makeTable());
        }),
    );
    const { service } = setup([p]);
    const c = new AbortController();
    const first = service.refresh(c.signal);
    c.abort();
    const second = service.refresh(); // прежняя работа ещё сворачивается
    expect(await first).toMatchObject({ aborted: true });
    expect(await second).toMatchObject({ ok: true, aborted: false });
    expect(p.calls).toBe(2);
  });

  it('signal, который так и не сработал, не оставляет слушателей и не мешает результату', async () => {
    const { service } = setup([stubProvider('nbt', ok())]);
    const c = new AbortController();
    const r = await service.refresh(c.signal);
    expect(r.ok).toBe(true);
    c.abort(); // позже — ни на что не влияет
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
  });
});

describe('refresh: скачок экзотической валюты', () => {
  const stored = () => makeTable({ asOf: '2026-10-09', perUnit: { TJS: 1, USD: 10.9, EUR: 12.7, ARS: 0.01 } });
  const today = (ars: number) => makeTable({ perUnit: { TJS: 1, USD: 10.95, EUR: 12.78, ARS: ars } });

  async function withStored() {
    const storage = createMemoryRateStorage();
    await setup([stubProvider('nbt', stored)], { storage, now: () => new Date('2026-10-09T12:00:00Z') }).service.refresh();
    return storage;
  }

  it('таблица принимается без ARS, предупреждение называет валюту, USD и EUR обновляются', async () => {
    const storage = await withStored();
    const { service } = setup([stubProvider('nbt', () => today(0.0025))], { storage });
    const r = await service.refresh();
    expect(r.ok).toBe(true);
    expect(r.table?.perUnit).toEqual({ TJS: 1, USD: 10.95, EUR: 12.78 });
    expect(r.warnings.join(' ')).toMatch(/ARS.*не приняты.*ARS: 0\.01 → 0\.0025 \(−75%\)/);
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
    expect(service.getRate('ARS', 'TJS')?.rate).toBe(0.01); // прежний курс остаётся, а не пропадает
    expect(service.getRate('ARS', 'TJS')?.asOf).toBe('2026-10-09');
  });

  it('на следующий день тот же уровень ARS уже не скачок относительно вчерашней (принятой) таблицы', async () => {
    const storage = await withStored();
    await setup([stubProvider('nbt', () => today(0.0025))], { storage }).service.refresh();
    const next = new Date('2026-10-11T12:00:00Z');
    const day2 = stubProvider('nbt', () => makeTable({ asOf: '2026-10-11', perUnit: { TJS: 1, USD: 10.96, EUR: 12.8, ARS: 0.0025 } }));
    const r = await createRateService({ providers: [day2], storage, now: () => next }).refresh();
    expect(r.ok).toBe(true);
    expect(r.table?.perUnit.ARS).toBe(0.0025);
  });

  it('скачок валюты из списка приложения вместе с экзотической — по-прежнему отказ всей таблице', async () => {
    const storage = await withStored();
    const bad = stubProvider('nbt', () => makeTable({ perUnit: { TJS: 1, USD: 25, EUR: 12.78, ARS: 0.0025 } }));
    const { service } = setup([bad], { storage });
    const r = await service.refresh();
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatchObject({ kind: 'rejected' });
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.9);
  });
});

describe('refresh: более ранние таблицы провайдера', () => {
  const mainNoTjs = (over: Partial<RateTable> = {}) =>
    makeTable({ source: 'server', pivot: 'USD', perUnit: { USD: 1, EUR: 1.167, RUB: 0.0109 }, ...over });
  const yesterday = () => makeTable({ source: 'server', asOf: '2026-10-09', perUnit: { TJS: 1, USD: 10.9, EUR: 12.7 } });
  const provide = (main: RateTable, earlier: unknown) => stubProvider('server', () => ({ ...main, earlier }) as RateTable);

  it('приложенная более ранняя таблица сохраняется: курс к сомони находится в ней, остальное берётся из свежей', async () => {
    const { service, storage } = setup([provide(mainNoTjs(), [yesterday()])]);
    const r = await service.refresh();
    expect(r.ok).toBe(true);
    expect(r.table).not.toHaveProperty('earlier');
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.9, asOf: '2026-10-09', stale: false });
    expect(service.getRate('EUR', 'USD')?.rate).toBeCloseTo(1.167, 10); // свежая таблица
    expect(JSON.stringify(storage.get())).not.toContain('earlier');
  });

  it('не принимаются: не старее главной, из будущего, битые, не таблицы', async () => {
    const same = makeTable({ source: 'server', perUnit: { TJS: 1, USD: 99 } });
    const future = makeTable({ source: 'server', asOf: '2031-01-01', perUnit: { TJS: 1, USD: 98 } });
    const broken = makeTable({ source: 'server', asOf: '2026-10-08', perUnit: { TJS: 1, USD: NaN } });
    const { service } = setup([provide(mainNoTjs(), [same, future, broken, null, 'x', { asOf: '2026-10-07' }])]);
    expect((await service.refresh()).ok).toBe(true);
    expect(service.getRate('USD', 'TJS')).toBeNull();
    expect(service.listKnownCurrencies()).toEqual(['EUR', 'RUB', 'USD']);
  });

  it('earlier не массив — просто игнорируется', async () => {
    const { service } = setup([provide(mainNoTjs(), 'мусор')]);
    expect((await service.refresh()).ok).toBe(true);
  });
});

describe('refresh: сообщение провайдеру о лимите времени', () => {
  it('сервис передаёт fetchTimeoutMs (по умолчанию 8000), чтобы провайдер с несколькими адресами поделил время', async () => {
    const seen: (number | undefined)[] = [];
    const spy = {
      id: 'api',
      async fetchLatest(_signal?: AbortSignal, ctx?: { timeoutMs: number }): Promise<RateTable> {
        seen.push(ctx?.timeoutMs);
        return makeTable();
      },
    };
    await setup([spy]).service.refresh();
    await setup([spy], { fetchTimeoutMs: 1234 }).service.refresh();
    expect(seen).toEqual([8000, 1234]);
  });
});
