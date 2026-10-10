// @vitest-environment node
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crossRate } from '@/domain/rates';
import { API_GARBAGE, API_HTML, API_WITHOUT_TJS, API_WITH_TJS } from './__fixtures__/api.fixtures';
import { NOW, failResponse, okResponse, routeFetch } from './__fixtures__/testkit';
import type { ResponseLike } from './http';
import { API_MIRRORS, apiProvider, parseCurrencyApiJson } from './api';
import { RateParseError, isRateValue } from './parseUtil';

const parse = (json: unknown, base = 'usd') => parseCurrencyApiJson(json, base, NOW);

describe('parseCurrencyApiJson', () => {
  it('есть tjs: таблица приводится к pivot TJS', () => {
    const t = parse(API_WITH_TJS);
    expect(t.pivot).toBe('TJS');
    expect(t.source).toBe('api');
    expect(t.asOf).toBe('2026-10-10');
    expect(t.fetchedAt).toBe(NOW.toISOString());
    expect(t.perUnit.TJS).toBe(1);
    expect(t.perUnit.USD).toBe(9.2);
    expect(t.perUnit.EUR).toBeCloseTo(10, 10); // 9.2 / 0.92
    expect(t.perUnit.RUB).toBeCloseTo(9.2 / 95.5, 12);
    expect(t.perUnit.KZT).toBeCloseTo(9.2 / 500, 12);
    expect(t.perUnit.JPY).toBeCloseTo(9.2 / 150, 12);
    expect(t.warnings).toEqual([]);
  });

  it('«1inch» и прочие не-валютные ключи отбрасываются молча', () => {
    expect(Object.keys(parse(API_WITH_TJS).perUnit)).not.toContain('1INCH');
  });

  it('кросс-курсы по такой таблице согласованы: EUR→USD = (9.2/0.92)/9.2', () => {
    const t = parse(API_WITH_TJS);
    expect(crossRate(t, 'EUR', 'USD')).toBeCloseTo(1 / 0.92, 10);
    expect(crossRate(t, 'USD', 'TJS')).toBeCloseTo(9.2, 12);
  });

  it('нет tjs: pivot остаётся базовой валютой, сомони по таблице недоступны, есть предупреждение', () => {
    const t = parse(API_WITHOUT_TJS);
    expect(t.pivot).toBe('USD');
    expect(t.perUnit.USD).toBe(1);
    expect(t.perUnit.EUR).toBeCloseTo(1 / 0.92, 12);
    expect(t.perUnit.TJS).toBeUndefined();
    expect(crossRate(t, 'USD', 'TJS')).toBeNull();
    expect(t.warnings.some((w) => w.includes('нет tjs'))).toBe(true);
  });

  it('база — сама сомони: {"tjs": {"usd": 0.1087}}', () => {
    const t = parse({ date: '2026-10-10', tjs: { usd: 0.1087, eur: 0.0978 } }, 'TJS');
    expect(t.pivot).toBe('TJS');
    expect(t.perUnit.USD).toBeCloseTo(1 / 0.1087, 10);
    expect(t.warnings).toEqual([]);
  });

  it('мусор: ноль, минус, текст, null отбрасываются; число-строка с запятой принимается; дубль в другом регистре — первая запись', () => {
    const t = parse(API_GARBAGE);
    expect(Object.keys(t.perUnit).sort()).toEqual(['CNY', 'EUR', 'RUB', 'TJS', 'USD']);
    expect(t.perUnit.RUB).toBeCloseTo(9.2 / 95.5, 12);
    expect(t.perUnit.CNY).toBeCloseTo(9.2 / 7, 12);
    const w = t.warnings.join('\n');
    for (const code of ['KZT', 'JPY', 'GBP', 'CHF']) expect(w).toContain(code);
    expect(w).toContain('Дубль CNY');
  });

  it('NaN, Infinity, огромные и крошечные значения отбрасываются', () => {
    const t = parse({ date: '2026-10-10', usd: { tjs: 9.2, eur: NaN, rub: Infinity, kzt: 1e30, jpy: 1e-30, gbp: 0.8 } });
    expect(Object.keys(t.perUnit).sort()).toEqual(['GBP', 'TJS', 'USD']);
  });

  it('tjs с мусорным значением = «tjs нет»', () => {
    const t = parse({ date: '2026-10-10', usd: { tjs: 0, eur: 0.92 } });
    expect(t.pivot).toBe('USD');
    expect(t.warnings.some((w) => w.includes('TJS'))).toBe(true);
  });

  it('принимает и объект, и JSON-строку (с BOM)', () => {
    expect(parse(JSON.parse(API_WITH_TJS)).perUnit.EUR).toBe(parse(API_WITH_TJS).perUnit.EUR);
    expect(parse(`﻿${API_WITH_TJS}`).pivot).toBe('TJS');
  });

  it('регистр базы не важен', () => {
    expect(parse(API_WITH_TJS, 'USD').pivot).toBe('TJS');
    expect(parse(API_WITH_TJS, ' usd ').pivot).toBe('TJS');
  });

  it.each([
    ['HTML вместо JSON', API_HTML, /не является JSON/],
    ['пустая строка', '', /не является JSON/],
    ['массив', '[1,2,3]', /не является JSON-объектом/],
    ['число', '42', /не является JSON-объектом/],
    ['null', 'null', /не является JSON-объектом/],
    ['нет даты', '{"usd":{"tjs":9.2}}', /нет корректной даты/],
    ['дата не строка', '{"date":20261010,"usd":{"tjs":9.2}}', /нет корректной даты/],
    ['нечитаемая дата', '{"date":"вчера","usd":{"tjs":9.2}}', /нет корректной даты/],
    ['дата из будущего', '{"date":"2036-10-10","usd":{"tjs":9.2}}', /из будущего/],
    ['нет раздела usd', '{"date":"2026-10-10","eur":{"tjs":10}}', /нет раздела/],
    ['раздел usd — не объект', '{"date":"2026-10-10","usd":[1]}', /нет раздела/],
    ['пустой раздел', '{"date":"2026-10-10","usd":{}}', /ни одного корректного курса/],
    ['все значения негодные', '{"date":"2026-10-10","usd":{"eur":0,"rub":-1}}', /ни одного корректного курса/],
  ])('%s → RateParseError', (_name, json, re) => {
    expect(() => parse(json)).toThrow(RateParseError);
    expect(() => parse(json)).toThrow(re);
  });

  it('некорректная база → RateParseError', () => {
    for (const base of ['', 'us', 'usdt', '12$', 5 as unknown as string]) {
      expect(() => parse(API_WITH_TJS, base)).toThrow(RateParseError);
    }
  });

  it('слишком большая строка → RateParseError', () => {
    expect(() => parse(' '.repeat(5_000_001))).toThrow(/слишком большой/);
  });

  it('свойство: на любом JSON-подобном вводе — только RateParseError или корректная таблица', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        try {
          const t = parse(v);
          expect(Object.values(t.perUnit).every(isRateValue)).toBe(true);
          expect(t.perUnit[t.pivot]).toBe(1);
        } catch (e) {
          expect(e).toBeInstanceOf(RateParseError);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('свойство: любой набор нормальных курсов превращается в таблицу, где кросс-курс туда-обратно даёт 1', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 50, noNaN: true }),
        fc.double({ min: 0.001, max: 1000, noNaN: true }),
        (tjs, eur) => {
          const t = parse({ date: '2026-10-10', usd: { tjs, eur } });
          const there = crossRate(t, 'EUR', 'USD');
          const back = crossRate(t, 'USD', 'EUR');
          expect(there).not.toBeNull();
          expect((there as number) * (back as number)).toBeCloseTo(1, 9);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('apiProvider', () => {
  const opts = { now: () => NOW };

  it('id «api»; зеркала по умолчанию — jsdelivr, затем pages.dev', () => {
    expect(apiProvider(routeFetch(() => okResponse(API_WITH_TJS))).id).toBe('api');
    expect(API_MIRRORS[0]).toContain('cdn.jsdelivr.net');
    expect(API_MIRRORS[1]).toContain('currency-api.pages.dev');
  });

  it('первое зеркало отвечает — второе не трогаем', async () => {
    const fetchImpl = routeFetch(() => okResponse(API_WITH_TJS, 'application/json'));
    const ctrl = new AbortController();
    const t = await apiProvider(fetchImpl, opts).fetchLatest(ctrl.signal);
    expect(t.pivot).toBe('TJS');
    expect(fetchImpl.calls.map((c) => c.url)).toEqual([API_MIRRORS[0]]);
    expect(fetchImpl.calls[0]?.init).toMatchObject({ signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
  });

  it('первое зеркало упало (HTTP 500 / нет сети / HTML) — берём второе', async () => {
    for (const first of [() => failResponse(500), () => okResponse(API_HTML, 'text/html'), () => { throw new TypeError('Failed to fetch'); }]) {
      const fetchImpl = routeFetch((url) => (url === API_MIRRORS[0] ? first() : okResponse(API_WITH_TJS)));
      const t = await apiProvider(fetchImpl, opts).fetchLatest();
      expect(t.perUnit.USD).toBe(9.2);
      expect(fetchImpl.calls.map((c) => c.url)).toEqual([API_MIRRORS[0], API_MIRRORS[1]]);
    }
  });

  it('упали все зеркала — одна ошибка с причиной по каждому', async () => {
    const fetchImpl = routeFetch((url) => (url === API_MIRRORS[0] ? failResponse(404) : okResponse(API_HTML)));
    const run = () => apiProvider(fetchImpl, opts).fetchLatest();
    await expect(run()).rejects.toThrow('cdn.jsdelivr.net: HTTP 404');
    await expect(run()).rejects.toThrow(/latest\.currency-api\.pages\.dev/);
  });

  it('пустой список зеркал — ошибка, а не пустая таблица', async () => {
    await expect(apiProvider(routeFetch(() => okResponse(API_WITH_TJS)), { mirrors: [] }).fetchLatest()).rejects.toThrow(/список зеркал пуст/);
  });

  it('отмена прекращает перебор: второе зеркало не опрашивается', async () => {
    const ctrl = new AbortController();
    const fetchImpl = routeFetch(() => {
      ctrl.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(apiProvider(fetchImpl, opts).fetchLatest(ctrl.signal)).rejects.toThrow();
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('другая база и свои зеркала', async () => {
    const fetchImpl = routeFetch(() => okResponse('{"date":"2026-10-10","eur":{"tjs":10.5,"usd":1.09}}'));
    const t = await apiProvider(fetchImpl, { ...opts, base: 'eur', mirrors: ['https://m.test/eur.json'] }).fetchLatest();
    expect(t.perUnit.EUR).toBe(10.5);
    expect(fetchImpl.calls[0]?.url).toBe('https://m.test/eur.json');
  });
});

describe('apiProvider: время на зеркала делится (context.timeoutMs)', () => {
  const opts = { now: () => NOW };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Запрос, который висит, пока его не отменят. */
  const hang = (init?: { signal?: AbortSignal }) =>
    new Promise<ResponseLike>((_res, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')));
    });

  it('зависшее первое зеркало отпускается на половине времени, второе успевает ответить', async () => {
    const fetchImpl = routeFetch((url, init) => (url === API_MIRRORS[0] ? hang(init) : okResponse(API_WITH_TJS, 'application/json')));
    const pending = apiProvider(fetchImpl, opts).fetchLatest(undefined, { timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchImpl.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).pivot).toBe('TJS');
    expect(fetchImpl.calls.map((c) => c.url)).toEqual([...API_MIRRORS]);
    expect(vi.getTimerCount()).toBe(0); // таймеры попыток не текут
  });

  it('первое зеркало упало быстро — второму достаётся всё оставшееся время, а не половина', async () => {
    const fetchImpl = routeFetch((url, init) => (url === API_MIRRORS[0] ? failResponse(500) : hang(init)));
    const pending = apiProvider(fetchImpl, opts).fetchLatest(undefined, { timeoutMs: 1000 });
    const assertion = expect(pending).rejects.toThrow(/latest\.currency-api\.pages\.dev: нет ответа за 1 с/);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('зависли оба — в ошибке причина по каждому, по времени укладываемся в общий лимит', async () => {
    const fetchImpl = routeFetch((_url, init) => hang(init));
    const pending = apiProvider(fetchImpl, opts).fetchLatest(undefined, { timeoutMs: 200 });
    const assertion = expect(pending).rejects.toThrow(/jsdelivr\.net: нет ответа за 100 мс.*pages\.dev: нет ответа за 100 мс/);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
  });

  it('без context лимита на зеркало нет: висит, пока не отменят снаружи; отмена снаружи не маскируется под таймаут', async () => {
    const fetchImpl = routeFetch((_url, init) => hang(init));
    const ctrl = new AbortController();
    const pending = apiProvider(fetchImpl, opts).fetchLatest(ctrl.signal);
    const assertion = expect(pending).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl.calls).toHaveLength(1);
    ctrl.abort();
    await assertion;
    expect(fetchImpl.calls).toHaveLength(1); // второе зеркало после отмены не опрашивается
  });

  it('отмена снаружи во время попытки с лимитом — перебор прекращается', async () => {
    const fetchImpl = routeFetch((_url, init) => hang(init));
    const ctrl = new AbortController();
    const pending = apiProvider(fetchImpl, opts).fetchLatest(ctrl.signal, { timeoutMs: 8000 });
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10);
    ctrl.abort();
    await assertion;
    expect(fetchImpl.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
