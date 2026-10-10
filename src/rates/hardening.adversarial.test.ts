// @vitest-environment node
// Атаки, которые модуль ВЫДЕРЖИВАЕТ (регрессионная страховка): мусор на границах, DoS-входы, обход авторизации Edge-функции.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, fail, makeTable, ok, setup, stubProvider } from './__fixtures__/testkit';
import { parseCurrencyApiJson } from './api';
import { parseNbtXml } from './nbt';
import { decodeBody, normalizeDate, parseDecimal } from './parseUtil';
import { createMemoryRateStorage } from './storage';
import * as edge from '../../supabase/functions/fetch-rates/index';

describe('парсеры: входы-убийцы не вешают и не падают с чужими ошибками', () => {
  const nasty: [string, string][] = [
    ['5 млн «<»', '<'.repeat(5_000_000)],
    ['2,5 млн «</» без «>»', '</'.repeat(2_500_000)],
    ['1 млн «<a » без закрытия', '<a '.repeat(1_000_000)],
    ['бесконечный незакрытый атрибут', '<a b="' + 'x'.repeat(4_000_000)],
    ['много <!X', '<!X'.repeat(1_500_000)],
    ['вложенность 100 тыс.', '<a>'.repeat(100_000)],
    ['200 тыс. элементов', '<a/>'.repeat(200_000)],
    ['миллиард смеха (сущности)', '<!DOCTYPE x [<!ENTITY a "' + 'A'.repeat(1000) + '"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><x>&b;&b;&b;&b;</x>'],
    ['5 млн пробелов', ' '.repeat(5_000_000) + '<a/>'],
  ];
  it.each(nasty)('NBT: %s — быстро и только RateParseError', (_n, xml) => {
    const t0 = performance.now();
    let err: unknown;
    try {
      parseNbtXml(xml, NOW);
    } catch (e) {
      err = e;
    }
    expect(performance.now() - t0).toBeLessThan(3000);
    expect((err as Error)?.name).toBe('RateParseError');
  });

  it('API: глубоко вложенный JSON и __proto__ не загрязняют Object.prototype', () => {
    const deep = '['.repeat(2_000_000);
    expect(() => parseCurrencyApiJson(deep, 'usd', NOW)).toThrow(/JSON/);
    const t = parseCurrencyApiJson('{"date":"2026-10-10","usd":{"__proto__":{"polluted":1},"tjs":9.2,"eur":0.92,"constructor":3}}', 'usd', NOW);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(t.perUnit).sort()).toEqual(['EUR', 'TJS', 'USD']);
  });

  it('числа на границах: 1e309, 2^53, строки с экспонентой и юникод-цифры не становятся курсом', () => {
    const t = parseCurrencyApiJson('{"date":"2026-10-10","usd":{"tjs":9.2,"eur":1e309,"rub":9007199254740993,"kzt":"1e5","jpy":"١٢٣","gbp":"0x10","chf":"  0,92 "}}', 'usd', NOW);
    expect(Object.keys(t.perUnit).sort()).toEqual(['CHF', 'TJS', 'USD']);
    expect(parseDecimal('9'.repeat(400))).toBeNull();
    expect(parseDecimal('-1')).toBeNull();
    expect(parseDecimal('1,2,3')).toBeNull();
  });

  it('даты: полночь UTC и граница «завтра»', () => {
    const late = new Date('2026-10-10T23:59:59.999Z');
    const x = (d: string): string => `<r Date="${d}"><V><CharCode>USD</CharCode><Value>10</Value></V></r>`;
    expect(parseNbtXml(x('11.10.2026'), late).asOf).toBe('2026-10-11');
    expect(() => parseNbtXml(x('12.10.2026'), late)).toThrow(/будущего/);
    expect(normalizeDate('31.04.2026')).toBeNull();
    expect(normalizeDate('2026-13-01')).toBeNull();
  });

  it('кодировка: неизвестная, битая и UTF-16 с BOM не бросают', () => {
    expect(() => decodeBody(new Uint8Array([0xff, 0xfe, 0x3c]), 'text/xml; charset=nope')).not.toThrow();
    expect(() => decodeBody(new Uint8Array([0xc3, 0x28]), 'text/xml; charset=utf-7')).not.toThrow();
    expect(decodeBody(new Uint8Array([0x3c, 0x61, 0x2f, 0x3e]), 'application/xml;charset="windows-1251"')).toBe('<a/>');
  });
});

describe('сервис: мусор от провайдеров и пользователя', () => {
  it.each([
    ['NaN', { perUnit: { TJS: 1, USD: NaN } }],
    ['Infinity', { perUnit: { TJS: 1, USD: Infinity } }],
    ['ноль', { perUnit: { TJS: 1, USD: 0 } }],
    ['минус', { perUnit: { TJS: 1, USD: -10 } }],
    ['TJS ≠ 1', { perUnit: { TJS: 2, USD: 10 } }],
    ['строка вместо числа', { perUnit: { TJS: 1, USD: '10.9' as unknown as number } }],
    ['дата не ISO', { asOf: '10.10.2026' }],
    ['дата из будущего', { asOf: '2027-01-01' }],
    ['курс вне границ', { perUnit: { TJS: 1, USD: 1e12 } }],
    ['код валюты в нижнем регистре', { perUnit: { TJS: 1, usd: 10.9 } }],
  ])('таблица с дефектом «%s» не принимается и не портит прежние курсы', async (_n, over) => {
    const good = stubProvider('nbt', ok());
    const { service, storage } = setup([good]);
    await service.refresh();
    const before = JSON.stringify(storage.get());
    const bad = setup([stubProvider('nbt', ok(over as never))], { storage });
    const r = await bad.service.refresh();
    expect(r.ok).toBe(false);
    expect(bad.service.getRate('USD', 'TJS')?.rate).toBe(10.95);
    expect(JSON.stringify((storage.get() as { tables: unknown }).tables)).toBe(JSON.stringify((JSON.parse(before) as { tables: unknown }).tables));
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 1e10, 1e-10, '10' as unknown as number, null as unknown as number, undefined as unknown as number])(
    'setManualRate(%s) бросает RangeError и ничего не сохраняет',
    (rate) => {
      const { service, storage } = setup([]);
      expect(() => service.setManualRate('USD', 'TJS', rate)).toThrow(RangeError);
      expect(service.getRate('USD', 'TJS')).toBeNull();
      expect(JSON.stringify(storage.get())).not.toContain('manual":{"USD');
    },
  );

  it('некорректные коды валют: getRate → null, setManualRate → RangeError, без падений', () => {
    const { service } = setup([]);
    for (const bad of ['', 'US', 'USDX', '__proto__', 'constructor', '1ab', 'тдж', null, undefined, 5, {}]) {
      expect(service.getRate(bad as never, 'TJS')).toBeNull();
      expect(service.getRate('TJS', bad as never)).toBeNull();
      expect(() => service.setManualRate(bad as never, 'TJS', 10)).toThrow(RangeError);
    }
    expect(() => service.setManualRate('TJS', 'TJS', 1)).toThrow(RangeError);
  });

  it('повреждённое хранилище (мусор, отрицательные курсы, чужая версия) не роняет сервис', async () => {
    for (const raw of ['str', 42, [], { v: 2 }, { v: 1, tables: 'x', manual: 5 }, { v: 1, tables: [{ asOf: 'x' }, null, 7], manual: { 'USD>TJS': { rate: -5, setAt: 'x' } } }]) {
      const { service } = setup([stubProvider('nbt', ok())], { storage: createMemoryRateStorage(raw) });
      expect(service.getRate('USD', 'TJS')).toBeNull();
      expect((await service.refresh()).ok).toBe(true);
    }
  });

  it('хранилище бросает при get/set — сервис работает из памяти', async () => {
    const storage = {
      get: () => {
        throw new Error('нет доступа');
      },
      set: () => {
        throw new Error('квота');
      },
    };
    const { service } = setup([stubProvider('nbt', ok())], { storage });
    expect((await service.refresh()).ok).toBe(true);
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
  });

  it('зависший провайдер даёт timeout, следующий всё равно опрашивается', async () => {
    const hang = stubProvider('server', () => new Promise(() => {}));
    const { service } = setup([hang, stubProvider('nbt', ok())], { fetchTimeoutMs: 20 });
    const r = await service.refresh();
    expect(r.failures[0]).toMatchObject({ providerId: 'server', kind: 'timeout' });
    expect(r.providerId).toBe('nbt');
  });

  it('провайдер бросает не-Error (строка, undefined, объект) — результат без исключения', async () => {
    for (const thrown of ['строка', undefined, { a: 1 }, null]) {
      const { service } = setup([stubProvider('nbt', () => Promise.reject(thrown))]);
      const r = await service.refresh();
      expect(r.ok).toBe(false);
      expect(service.getStatus().lastError).toContain('Не удалось обновить курсы');
    }
  });

  it('провайдер мутирует выданную таблицу после возврата — сохранённые курсы не меняются', async () => {
    const t = makeTable();
    const { service } = setup([stubProvider('nbt', () => t)]);
    await service.refresh();
    t.perUnit.USD = 999;
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
  });

  it('параллельные refresh делят один запрос провайдера', async () => {
    const p = stubProvider('nbt', ok());
    const { service } = setup([p]);
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    expect(p.calls).toBe(1);
  });

  it('граница «устарел»: 3 суток — свежий, 4 — устаревший', async () => {
    const { service } = setup([stubProvider('nbt', ok({ asOf: '2026-10-07' }))]);
    await service.refresh();
    expect(service.getRate('USD', 'TJS')?.stale).toBe(false);
    const old = setup([stubProvider('nbt', ok({ asOf: '2026-10-06' }))]);
    await old.service.refresh();
    expect(old.service.getRate('USD', 'TJS')?.stale).toBe(true);
  });

  it('падение всех провайдеров не стирает прежние курсы', async () => {
    const storage = createMemoryRateStorage();
    await setup([stubProvider('nbt', ok())], { storage }).service.refresh();
    const s = setup([stubProvider('nbt', fail('x')), stubProvider('api', fail('y'))], { storage });
    expect((await s.service.refresh()).ok).toBe(false);
    expect(s.service.getRate('USD', 'TJS')?.rate).toBe(10.95);
  });
});

describe('Edge-функция: доступ и утечки', () => {
  const SECRET = 'cron-secret-0123456789-abcdef';
  const KEY = 'service-role-key-XYZ-987654321';
  const BASE = 'https://proj.supabase.co';
  const ENV: Record<string, string> = { CRON_SECRET: SECRET, SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: KEY };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const call = async (auth: string | null, method = 'POST', env: Record<string, string> = ENV) => {
    const urls: string[] = [];
    const fetchImpl: edge.FetchFn = async (url) => {
      urls.push(url);
      throw new Error(`сеть недоступна, ключ ${KEY} и секрет ${SECRET}`);
    };
    const headers = new Headers();
    if (auth !== null) headers.set('authorization', auth);
    const res = await edge.handler(new Request(`${BASE}/functions/v1/fetch-rates`, { method, headers }), {
      env: (n) => env[n],
      fetchImpl,
      now: () => NOW,
    });
    return { res, urls, text: await res.text() };
  };

  it.each([
    ['без заголовка', null],
    ['пустой Bearer', 'Bearer '],
    ['чужой секрет', 'Bearer wrong'],
    ['секрет без схемы', SECRET],
    ['Basic', `Basic ${SECRET}`],
    ['секрет + хвост', `Bearer ${SECRET} x`],
    ['префикс секрета', `Bearer ${SECRET.slice(0, -1)}`],
    ['секрет + символ', `Bearer ${SECRET}x`],
    ['два токена', `Bearer ${SECRET},${SECRET}`],
  ])('%s → 401 и ни одного сетевого вызова', async (_n, auth) => {
    const { res, urls } = await call(auth);
    expect(res.status).toBe(401);
    expect(urls).toEqual([]);
  });

  it('CRON_SECRET не задан или пуст → 500 и никого не пускает (даже с «Bearer »)', async () => {
    for (const env of [{ ...ENV, CRON_SECRET: '' }, { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: KEY }]) {
      for (const auth of ['Bearer ', 'Bearer undefined', 'Bearer ']) {
        const { res, urls } = await call(auth, 'POST', env as Record<string, string>);
        expect(res.status).toBe(500);
        expect(urls).toEqual([]);
      }
    }
  });

  it('верный секрет, но не POST → 405 без сети', async () => {
    for (const m of ['GET', 'PUT', 'DELETE']) {
      const { res, urls } = await call(`Bearer ${SECRET}`, m);
      expect(res.status).toBe(405);
      expect(urls).toEqual([]);
    }
  });

  it('ошибка сети с ключом и секретом в тексте не утекает в ответ', async () => {
    const { res, text } = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(502);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(SECRET);
  });
});
