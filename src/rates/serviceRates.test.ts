// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RateTable } from '@/domain/types';
import { NOW, fail, makeTable, ok, setup, stubProvider } from './__fixtures__/testkit';
import { STALE_AFTER_DAYS, createRateService, type RateServiceOptions } from './service';
import { createMemoryRateStorage } from './storage';

describe('getRate', () => {
  async function loaded(table: Partial<RateTable> = {}, extra: Partial<RateServiceOptions> = {}) {
    const ctx = setup([stubProvider('nbt', ok(table))], extra);
    await ctx.service.refresh();
    return ctx;
  }

  it('кросс-курсы через pivot', async () => {
    const { service } = await loaded();
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
    expect(service.getRate('TJS', 'USD')?.rate).toBeCloseTo(1 / 10.95, 12);
    expect(service.getRate('USD', 'EUR')?.rate).toBeCloseTo(10.95 / 12.78, 12);
    expect(service.getRate('EUR', 'USD')?.rate).toBeCloseTo(12.78 / 10.95, 12);
  });

  it('одна и та же валюта — курс 1, источник «same», без запроса', () => {
    const { service } = setup([]);
    expect(service.getRate('USD', 'USD')).toEqual({ rate: 1, source: 'same', asOf: '2026-10-10', stale: false, manual: false });
  });

  it('неизвестная валюта, мусорные аргументы → null, без исключения; регистр и пробелы не важны', async () => {
    const { service } = await loaded();
    expect(service.getRate('USD', 'XYZ')).toBeNull();
    expect(service.getRate('', 'TJS')).toBeNull();
    expect(service.getRate(undefined as unknown as string, 5 as unknown as string)).toBeNull();
    expect(service.getRate('usd', ' tjs ')?.rate).toBe(10.95);
  });

  it('устаревание: ровно 3 суток — ещё свежий, 4 — устарел', async () => {
    expect(STALE_AFTER_DAYS).toBe(3);
    const { service } = await loaded({ asOf: '2026-10-07' });
    expect(service.getRate('USD', 'TJS')?.stale).toBe(false);
    const old = await loaded({ asOf: '2026-10-06' });
    expect(old.service.getRate('USD', 'TJS')?.stale).toBe(true);
  });

  it('stale считается от «сейчас» сервиса: тот же курс со временем устаревает', async () => {
    let now = NOW;
    const storage = createMemoryRateStorage();
    const service = createRateService({ providers: [stubProvider('nbt', ok())], storage, now: () => now });
    await service.refresh();
    expect(service.getRate('USD', 'TJS')?.stale).toBe(false);
    now = new Date('2026-10-14T00:00:00Z');
    expect(service.getRate('USD', 'TJS')?.stale).toBe(true);
  });

  it('нет TJS в таблице (api без tjs): пары с сомони недоступны, остальные работают', async () => {
    const { service } = await loaded({ source: 'api', pivot: 'USD', perUnit: { USD: 1, EUR: 1.09, RUB: 0.0105 } });
    expect(service.getRate('USD', 'TJS')).toBeNull();
    expect(service.getRate('TJS', 'USD')).toBeNull();
    expect(service.getRate('EUR', 'USD')).toMatchObject({ rate: 1.09, source: 'api' });
    expect(service.listKnownCurrencies()).toEqual(['EUR', 'RUB', 'USD']);
  });

  it('нет TJS в свежей таблице, но есть в прежней: пара с сомони берётся из прежней и честно помечается устаревшей', async () => {
    const storage = createMemoryRateStorage();
    await setup([stubProvider('nbt', ok({ asOf: '2026-10-05', perUnit: { TJS: 1, USD: 10.9, EUR: 12.7 } }))], { storage }).service.refresh();
    const { service } = setup([stubProvider('api', ok({ source: 'api', pivot: 'USD', asOf: '2026-10-10', perUnit: { USD: 1, EUR: 1.17 } }))], { storage });
    expect((await service.refresh()).ok).toBe(true);
    expect(service.getRate('EUR', 'USD')).toMatchObject({ source: 'api', asOf: '2026-10-10', stale: false });
    expect(service.getRate('USD', 'TJS')).toEqual({ rate: 10.9, source: 'nbt', asOf: '2026-10-05', stale: true, manual: false });
  });
});

describe('ручные курсы', () => {
  it('ручной курс пары приоритетнее курса из таблицы, не считается устаревшим и помечен manual', async () => {
    const { service } = setup([stubProvider('nbt', ok({ asOf: '2026-09-01' }))]);
    await service.refresh();
    service.setManualRate('USD', 'TJS', 11.2);
    expect(service.getRate('USD', 'TJS')).toEqual({ rate: 11.2, source: 'manual', asOf: '2026-10-10', stale: false, manual: true });
    // обратная пара — другая пара, ручной курс на неё не распространяется
    expect(service.getRate('TJS', 'USD')).toMatchObject({ manual: false, source: 'nbt' });
    expect(service.getRate('EUR', 'TJS')).toMatchObject({ manual: false });
  });

  it('ручной курс работает, даже когда автоматических нет совсем', () => {
    const { service } = setup([]);
    expect(service.getRate('USD', 'TJS')).toBeNull();
    service.setManualRate('usd', 'tjs', 10.5);
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.5);
    expect(service.listKnownCurrencies()).toEqual(['TJS', 'USD']);
  });

  it('новое обновление не затирает ручной курс; clearManualRate возвращает курс из таблицы', async () => {
    const { service } = setup([stubProvider('nbt', ok())]);
    service.setManualRate('USD', 'TJS', 11.2);
    await service.refresh();
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 11.2, manual: true });
    service.clearManualRate('USD', 'TJS');
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, manual: false });
    expect(() => service.clearManualRate('USD', 'TJS')).not.toThrow(); // повторно — не ошибка
  });

  it('ручной курс переживает перезагрузку', () => {
    const storage = createMemoryRateStorage();
    setup([], { storage }).service.setManualRate('USD', 'TJS', 10.5);
    expect(setup([], { storage }).service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.5, manual: true });
  });

  it.each([
    ['ноль', 0],
    ['минус', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['строка', '5' as unknown as number],
    ['null', null as unknown as number],
    ['слишком большой', 1e12],
    ['слишком маленький', 1e-12],
  ])('некорректный курс (%s) → RangeError, ничего не сохраняется', (_n, bad) => {
    const storage = createMemoryRateStorage();
    const { service } = setup([], { storage });
    expect(() => service.setManualRate('USD', 'TJS', bad)).toThrow(RangeError);
    expect(service.getRate('USD', 'TJS')).toBeNull();
    expect(storage.get()).toBeNull();
  });

  it('некорректные валюты → RangeError', () => {
    const { service } = setup([]);
    for (const [f, t] of [['USD', 'USD'], ['US', 'TJS'], ['USD', ''], ['USD1', 'TJS'], ['', '']]) {
      expect(() => service.setManualRate(f as string, t as string, 5)).toThrow(RangeError);
      expect(() => service.clearManualRate(f as string, t as string)).toThrow(RangeError);
    }
  });
});

describe('subscribe, статус, список валют', () => {
  it('слушатель вызывается после обновления (удачного и неудачного), ручного курса и его сброса; отписка работает', async () => {
    const { service } = setup([stubProvider('nbt', ok()), stubProvider('api', fail())]);
    const calls: string[] = [];
    const off = service.subscribe(() => calls.push('x'));
    await service.refresh();
    expect(calls).toHaveLength(1);
    service.setManualRate('USD', 'TJS', 11);
    service.clearManualRate('USD', 'TJS');
    expect(calls).toHaveLength(3);
    off();
    await service.refresh();
    service.setManualRate('USD', 'TJS', 12);
    expect(calls).toHaveLength(3);
  });

  it('сломанный слушатель не мешает остальным и не ломает refresh', async () => {
    const { service } = setup([stubProvider('nbt', ok())]);
    const got: number[] = [];
    service.subscribe(() => {
      throw new Error('listener bug');
    });
    service.subscribe(() => got.push(1));
    await expect(service.refresh()).resolves.toMatchObject({ ok: true });
    expect(got).toEqual([1]);
  });

  it('getStatus: попытка, успех, ошибка', async () => {
    const t0 = NOW.toISOString();
    let nowMs = NOW.getTime();
    const storage = createMemoryRateStorage();
    let shouldFail = true;
    const p = stubProvider('nbt', () => {
      if (shouldFail) throw new Error('нет сети');
      return makeTable();
    });
    const service = createRateService({ providers: [p], storage, now: () => new Date(nowMs) });
    expect(service.getStatus()).toEqual({ lastRefreshAt: null, lastAttemptAt: null, lastError: null });
    await service.refresh();
    expect(service.getStatus()).toEqual({ lastRefreshAt: null, lastAttemptAt: t0, lastError: 'Не удалось обновить курсы: Нацбанк — нет сети' });
    nowMs += 3_600_000;
    shouldFail = false;
    await service.refresh();
    const t1 = new Date(nowMs).toISOString();
    expect(service.getStatus()).toEqual({ lastRefreshAt: t1, lastAttemptAt: t1, lastError: null });
  });

  it('listKnownCurrencies: уникальные коды из всех таблиц и ручных курсов, по алфавиту', async () => {
    const { service } = setup([stubProvider('nbt', ok({ perUnit: { TJS: 1, USD: 10, EUR: 12 } }))]);
    await service.refresh();
    service.setManualRate('GBP', 'USD', 1.3);
    expect(service.listKnownCurrencies()).toEqual(['EUR', 'GBP', 'TJS', 'USD']);
  });
});
